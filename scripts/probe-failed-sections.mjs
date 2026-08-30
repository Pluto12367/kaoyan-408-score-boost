// Diagnostic probe for the three failing full-student checks: dashboard
// next-step/calendar and wrong-book. Logs in, navigates, and prints the real
// innerText + candidate class names so we can tell functional gaps from
// over-strict test selectors.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { connect } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = process.env.APP_URL ?? 'http://43.128.30.191/';
const LOGIN_EMAIL = process.env.LOGIN_EMAIL ?? '';
const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD ?? '';

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'probe-'));
const remotePort = 9900 + Math.floor(Math.random() * 200);
const chromeProcess = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
  '--window-size=1440,1000', `--remote-debugging-port=${remotePort}`,
  `--user-data-dir=${userDataDir}`, 'about:blank',
], { stdio: 'ignore', windowsHide: true });

async function waitForDebuggingPort(port) {
  const url = `http://127.0.0.1:${port}/json`;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try { const r = await fetch(url); if (r.ok) return r.json(); } catch {}
    await wait(250);
  }
  throw new Error('no debugging port');
}

async function createDevToolsSocket(webSocketUrl) {
  const parsed = new URL(webSocketUrl);
  const sock = connect(Number(parsed.port), parsed.hostname);
  const listeners = new Set();
  let buffer = Buffer.alloc(0);
  await new Promise((resolve, reject) => {
    sock.once('error', reject);
    sock.once('connect', () => {
      const key = randomBytes(16).toString('base64');
      sock.write([
        `GET ${parsed.pathname}${parsed.search} HTTP/1.1`,
        `Host: ${parsed.host}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '', '',
      ].join('\r\n'));
      const onData = (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        const header = buffer.subarray(0, headerEnd).toString('utf8');
        if (!header.startsWith('HTTP/1.1 101')) { reject(new Error('upgrade failed')); return; }
        sock.off('data', onData);
        sock.off('error', reject);
        buffer = buffer.subarray(headerEnd + 4);
        sock.on('data', (data) => {
          buffer = Buffer.concat([buffer, data]);
          buffer = readFrames(buffer, listeners);
        });
        if (buffer.length > 0) buffer = readFrames(buffer, listeners);
        resolve();
      };
      sock.on('data', onData);
    });
  });
  return {
    on(event, listener) { if (event === 'message') listeners.add(listener); },
    send(payload) { sock.write(encodeFrame(JSON.stringify(payload))); },
    close() { sock.end(); },
  };
}

function readFrames(buf, listeners) {
  let offset = 0;
  while (offset + 2 <= buf.length) {
    const second = buf[offset + 1];
    let length = second & 0x7f;
    let headerLength = 2;
    if (length === 126) { if (offset + 4 > buf.length) break; length = buf.readUInt16BE(offset + 2); headerLength = 4; }
    else if (length === 127) { if (offset + 10 > buf.length) break; length = buf.readUInt32BE(offset + 2) * 2 ** 32 + buf.readUInt32BE(offset + 6); headerLength = 10; }
    const frameEnd = offset + headerLength + length;
    if (frameEnd > buf.length) break;
    if ((buf[offset] & 0x0f) === 1) {
      const message = JSON.parse(buf.subarray(offset + headerLength, frameEnd).toString('utf8'));
      for (const listener of listeners) listener(message);
    }
    offset = frameEnd;
  }
  return buf.subarray(offset);
}

function encodeFrame(text) {
  const payload = Buffer.from(text);
  const mask = randomBytes(4);
  let header;
  if (payload.length < 126) header = Buffer.from([0x81, 0x80 | payload.length]);
  else if (payload.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(payload.length, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 0x80 | 127; header.writeUInt32BE(0, 2); header.writeUInt32BE(payload.length, 6); }
  const masked = Buffer.alloc(payload.length);
  for (let index = 0; index < payload.length; index += 1) masked[index] = payload[index] ^ mask[index % 4];
  return Buffer.concat([header, mask, masked]);
}

let msgId = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    socket.send({ id, method, params });
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails).slice(0, 300));
  return result.result.value;
}

async function waitFor(expression, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const value = await evaluate(expression); if (value) return value; } catch {}
    await wait(500);
  }
  throw new Error('Timed out waiting for ' + label);
}

const fillInput = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`;

const navClick = (label) => `(() => {
  const btn = [...document.querySelectorAll('nav.role-navigation button')].find((b) => b.textContent?.trim().includes(${JSON.stringify(label)}));
  if (!btn) return false;
  btn.click();
  return true;
})()`;

let socket;
try {
  const tabs = await waitForDebuggingPort(remotePort);
  const pageTarget = tabs.find((tab) => tab.type === 'page') ?? tabs[0];
  socket = await createDevToolsSocket(pageTarget.webSocketDebuggerUrl);
  socket.on('message', (message) => {
    const handler = pending.get(message.id);
    if (!handler) return;
    pending.delete(message.id);
    if (message.error) handler.reject(new Error(message.error.message));
    else handler.resolve(message.result);
  });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  const failedRequests = [];
  const consoleErrors = [];
  socket.on('message', (message) => {
    if (message.method === 'Network.responseReceived') {
      const response = message.params?.response;
      if (response && response.status >= 400) {
        failedRequests.push({ url: response.url.slice(0, 120), status: response.status });
      }
    }
    if (message.method === 'Network.loadingFailed') {
      failedRequests.push({ url: message.params?.requestId, error: message.params?.errorText });
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
      const text = (message.params.args ?? []).map((arg) => arg.value ?? arg.description ?? '').join(' ');
      if (text) consoleErrors.push(text.slice(0, 200));
    }
  });
  await send('Page.navigate', { url: APP_URL + '?t=' + Date.now() });
  await waitFor(`document.querySelector('input[name="email"]') != null`, 60000, 'login form');
  await evaluate(fillInput('form input[name="email"]', LOGIN_EMAIL));
  await evaluate(fillInput('form input[name="password"]', LOGIN_PASSWORD));
  await evaluate(`(() => { const f = document.querySelector('form'); f.requestSubmit(); return true; })()`);
  await waitFor(`!!document.querySelector('nav.role-navigation')`, 60000, 'post-login nav');
  await waitFor(`document.body.innerText.includes('学习中枢') || document.body.innerText.includes('学习总览')`, 90000, 'dashboard');
  await waitFor(`!document.body.innerText.includes('正在加载学习总览')`, 30000, 'dashboard overview loaded');
  await wait(1000);

  console.log('=== DASHBOARD ===');
  const perf = await evaluate(`(() => {
    const entries = performance.getEntriesByType('resource').map((e) => ({ name: e.name.slice(0, 120), duration: Math.round(e.duration) }));
    return { apiEntries: entries.filter((e) => /api\\//.test(e.name)).slice(0, 20), total: entries.length };
  })()`);
  console.log('PERF', JSON.stringify(perf, null, 1));
  console.log('FAILED_REQUESTS', JSON.stringify(failedRequests, null, 1));
  console.log('CONSOLE_ERRORS', JSON.stringify(consoleErrors, null, 1));
  const dash = await evaluate(`(() => {
    const text = document.body.innerText;
    return {
      classes: [...document.querySelectorAll('section, article, div')].map((el) => el.className).filter((c) => typeof c === 'string' && /next|calendar|streak|today|task/i.test(c)).slice(0, 25),
      snippet: text.slice(0, 1200),
    };
  })()`);
  console.log(JSON.stringify(dash, null, 1));

  await evaluate(navClick('错题本'));
  await waitFor(`document.body.innerText.includes('错题')`, 30000, 'wrong book');
  await wait(2500);
  console.log('=== WRONG BOOK ===');
  const wrong = await evaluate(`(() => {
    const text = document.body.innerText;
    return {
      classes: [...document.querySelectorAll('section, article, div')].map((el) => el.className).filter((c) => typeof c === 'string' && /wrong|mistake|review|book/i.test(c)).slice(0, 25),
      snippet: text.slice(0, 1400),
    };
  })()`);
  console.log(JSON.stringify(wrong, null, 1));
} catch (error) {
  console.error('PROBE_FATAL', error && error.stack ? error.stack : error);
  process.exitCode = 1;
} finally {
  try { socket?.close(); } catch {}
  try { chromeProcess?.kill(); } catch {}
  await wait(300);
  await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
}
