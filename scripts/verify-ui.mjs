import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, rm, stat } from 'node:fs/promises';
import { connect } from 'node:net';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const chrome = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const appUrl = process.env.APP_URL ?? 'http://localhost:4173';
const checkedUrl = withCacheBust(appUrl);
const desktopScreenshot = resolve('assets/render-desktop.png');
const mobileScreenshot = resolve('assets/render-mobile.png');
let serverProcess = null;

await mkdir('assets', { recursive: true });
await ensureAppIsRunning();
await rm(desktopScreenshot, { force: true });
await rm(mobileScreenshot, { force: true });

const baseArgs = ['--headless', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=1500'];

try {
  const dom = await run(chrome, [...baseArgs, '--dump-dom', checkedUrl], { maxBuffer: 5_000_000 });

  await run(chrome, [
    ...baseArgs,
    '--window-size=1440,1000',
    `--screenshot=${desktopScreenshot}`,
    checkedUrl,
  ]);

  await run(chrome, [
    ...baseArgs,
    '--window-size=390,1000',
    `--screenshot=${mobileScreenshot}`,
    checkedUrl,
  ]);

  await stat(desktopScreenshot);
  await stat(mobileScreenshot);

  const requiredText = [
    '计算机考研 408 提分系统',
    '学生工作区',
    '登录后载入个人学习数据',
    '账号与角色权限',
    '邮箱',
    '密码',
    '注册账号',
  ];

  const missing = requiredText.filter((text) => !dom.stdout.includes(text));
  const browserResult = await runInteractionChecks();

  console.log(JSON.stringify({
    appUrl,
    renderedTextChecks: requiredText.length - missing.length,
    missing,
    browserResult,
    desktopScreenshot,
    mobileScreenshot,
  }, null, 2));

  if (missing.length > 0 || browserResult.errors.length > 0) {
    process.exitCode = 1;
  }
} finally {
  serverProcess?.kill();
}

async function ensureAppIsRunning() {
  if (await isReachable(appUrl)) return;

  serverProcess = spawn(process.execPath, ['server.js'], {
    stdio: 'ignore',
    windowsHide: true,
  });

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await wait(250);
    if (await isReachable(appUrl)) return;
  }

  throw new Error(`Could not start local app at ${appUrl}`);
}

async function isReachable(url) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function runInteractionChecks() {
  const userDataDir = `${process.cwd()}\\.tmp-chrome-profile-${Date.now()}`;
  const remotePort = 9222 + Math.floor(Math.random() * 1000);
  const chromeProcess = spawn(chrome, [
    '--headless',
    '--disable-gpu',
    '--no-sandbox',
    '--window-size=390,1000',
    `--remote-debugging-port=${remotePort}`,
    `--user-data-dir=${userDataDir}`,
    checkedUrl,
  ], {
    stdio: 'ignore',
    windowsHide: true,
  });

  try {
    const tabs = await waitForDebuggingPort(remotePort);
    const pageTarget = tabs.find((tab) => tab.type === 'page') ?? tabs[0];
    const socket = await createDevToolsSocket(pageTarget.webSocketDebuggerUrl);

    let id = 0;
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const messageId = ++id;
      const onMessage = (message) => {
        if (message.id !== messageId) return;
        socket.off('message', onMessage);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      };
      socket.on('message', onMessage);
      socket.send({ id: messageId, method, params });
    });

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: checkedUrl });
    await wait(1000);

    const evaluation = await send('Runtime.evaluate', {
      returnByValue: true,
      awaitPromise: true,
      expression: `
        (async () => {
          const errors = [];
          const seen = [];
          const expectText = (label, expected) => {
            const text = document.body.innerText;
            if (text.includes(expected)) seen.push(label);
            else errors.push('missing text ' + expected);
          };
          const registerButton = [...document.querySelectorAll('button')]
            .find((node) => node.textContent?.trim() === '注册账号');
          if (!registerButton) errors.push('missing register button');
          else registerButton.click();
          await new Promise((resolve) => setTimeout(resolve, 100));
          expectText('register-mode', '创建学生账号');
          if (!document.querySelector('input[name="name"]')) errors.push('missing registration name field');
          if (!document.querySelector('input[name="email"]')) errors.push('missing email field');
          if (!document.querySelector('input[name="password"]')) errors.push('missing password field');
          if (!document.querySelector('#root')?.children.length) errors.push('React root is empty');
          if (document.documentElement.scrollWidth > document.documentElement.clientWidth) {
            errors.push('page has horizontal overflow');
          }

          return {
            errors,
            seen,
            title: document.title,
            length: document.body.innerText.length,
            viewportWidth: document.documentElement.clientWidth,
            contentWidth: document.documentElement.scrollWidth,
          };
        })()
      `,
    });
    socket.close();
    return evaluation.result.value;
  } finally {
    chromeProcess.kill();
    await wait(300);
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function waitForDebuggingPort(port) {
  const url = `http://127.0.0.1:${port}/json`;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // keep waiting
    }
    await wait(200);
  }
  throw new Error('Could not connect to Chrome debugging port');
}

async function createDevToolsSocket(webSocketUrl) {
  const parsed = new URL(webSocketUrl);
  const socket = connect(Number(parsed.port), parsed.hostname);
  const listeners = new Set();
  let buffer = Buffer.alloc(0);

  socket.on('error', () => {});

  await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.once('connect', () => {
      const key = randomBytes(16).toString('base64');
      socket.write([
        `GET ${parsed.pathname}${parsed.search} HTTP/1.1`,
        `Host: ${parsed.host}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '',
        '',
      ].join('\r\n'));
      const onData = (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        const header = buffer.subarray(0, headerEnd).toString('utf8');
        if (!header.startsWith('HTTP/1.1 101')) {
          reject(new Error(`Chrome DevTools websocket upgrade failed: ${header}`));
          return;
        }
        socket.off('data', onData);
        socket.off('error', reject);
        buffer = buffer.subarray(headerEnd + 4);
        socket.on('data', (data) => {
          buffer = Buffer.concat([buffer, data]);
          buffer = readFrames(buffer, listeners);
        });
        if (buffer.length > 0) buffer = readFrames(buffer, listeners);
        resolve();
      };
      socket.on('data', onData);
    });
  });

  return {
    on(event, listener) {
      if (event === 'message') listeners.add(listener);
    },
    off(event, listener) {
      if (event === 'message') listeners.delete(listener);
    },
    send(payload) {
      socket.write(encodeFrame(JSON.stringify(payload)));
    },
    close() {
      socket.end();
    },
  };
}

function readFrames(buffer, listeners) {
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const second = buffer[offset + 1];
    let length = second & 0x7f;
    let headerLength = 2;
    if (length === 126) {
      if (offset + 4 > buffer.length) break;
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (offset + 10 > buffer.length) break;
      const high = buffer.readUInt32BE(offset + 2);
      const low = buffer.readUInt32BE(offset + 6);
      length = high * 2 ** 32 + low;
      headerLength = 10;
    }

    const frameEnd = offset + headerLength + length;
    if (frameEnd > buffer.length) break;

    const opcode = buffer[offset] & 0x0f;
    const payload = buffer.subarray(offset + headerLength, frameEnd);
    if (opcode === 1) {
      const message = JSON.parse(payload.toString('utf8'));
      for (const listener of listeners) listener(message);
    }
    offset = frameEnd;
  }
  return buffer.subarray(offset);
}

function encodeFrame(text) {
  const payload = Buffer.from(text);
  const mask = randomBytes(4);
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, 0x80 | payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 0x80 | 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(payload.length, 6);
  }
  const masked = Buffer.alloc(payload.length);
  for (let index = 0; index < payload.length; index += 1) {
    masked[index] = payload[index] ^ mask[index % 4];
  }
  return Buffer.concat([header, mask, masked]);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withCacheBust(url) {
  const parsed = new URL(url);
  parsed.searchParams.set('verify', String(Date.now()));
  return parsed.toString();
}
