// P0 student learning-loop verification.
// Drives a real browser against a deployed or local app and checks the minimum
// 408 loop: login -> today plan -> practice -> wrong detail/redo -> catalog.
//
// Usage:
//   LOGIN_EMAIL=... LOGIN_PASSWORD=... npm run verify:p0-student
// Env:
//   APP_URL defaults to http://43.128.30.191/
//   OUT_DIR defaults to assets/p0-student-loop-check
//   CHROME_PATH defaults to the Windows Chrome install path.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import os from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = process.env.APP_URL ?? 'http://43.128.30.191/';
const LOGIN_EMAIL = process.env.LOGIN_EMAIL ?? '';
const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD ?? '';
const OUT_DIR = path.resolve(process.env.OUT_DIR ?? 'assets/p0-student-loop-check');

const checks = [];
const consoleErrors = [];
let chromeProcess = null;
let socket = null;
let messageId = 0;
const pending = new Map();

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(ok ? 'PASS' : 'FAIL', name, detail ?? '');
}

function appUrlWithCacheBust() {
  const parsed = new URL(APP_URL);
  parsed.searchParams.set('p0', String(Date.now()));
  return parsed.toString();
}

async function waitForDebuggingPort(port) {
  const url = `http://127.0.0.1:${port}/json`;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // Chrome is still starting.
    }
    await wait(250);
  }
  throw new Error('Could not connect to Chrome debugging port');
}

async function createDevToolsSocket(webSocketUrl) {
  const parsed = new URL(webSocketUrl);
  const sock = connect(Number(parsed.port), parsed.hostname);
  const listeners = new Set();
  let buffer = Buffer.alloc(0);
  sock.on('error', () => {});

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
        '',
        '',
      ].join('\r\n'));
      const onData = (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;
        const header = buffer.subarray(0, headerEnd).toString('utf8');
        if (!header.startsWith('HTTP/1.1 101')) {
          reject(new Error('CDP upgrade failed: ' + header));
          return;
        }
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
    on(event, listener) {
      if (event === 'message') listeners.add(listener);
    },
    send(payload) {
      sock.write(encodeFrame(JSON.stringify(payload)));
    },
    close() {
      sock.end();
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
      length = buffer.readUInt32BE(offset + 2) * 2 ** 32 + buffer.readUInt32BE(offset + 6);
      headerLength = 10;
    }
    const frameEnd = offset + headerLength + length;
    if (frameEnd > buffer.length) break;
    if ((buffer[offset] & 0x0f) === 1) {
      const message = JSON.parse(buffer.subarray(offset + headerLength, frameEnd).toString('utf8'));
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

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++messageId;
    pending.set(id, { resolve, reject });
    socket.send({ id, method, params });
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    throw new Error('Page error: ' + JSON.stringify(result.exceptionDetails).slice(0, 500));
  }
  return result.result.value;
}

async function waitFor(expression, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await evaluate(expression);
      if (value) return value;
    } catch {
      // The app may still be rendering.
    }
    await wait(500);
  }
  throw new Error('Timed out waiting for ' + label);
}

async function screenshot(name) {
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(path.join(OUT_DIR, `${name}.png`), Buffer.from(shot.data, 'base64'));
}

const fillInput = (selector, value) => `(() => {
  const element = document.querySelector(${JSON.stringify(selector)});
  if (!element) return false;
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(element, ${JSON.stringify(value)});
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`;

const clickRoleNav = (label) => `(() => {
  const button = [...document.querySelectorAll('nav.role-navigation button')]
    .find((node) => node.textContent?.includes(${JSON.stringify(label)}));
  if (!button || button.disabled) return false;
  button.click();
  return true;
})()`;

const clickAnyRoleNav = (labels) => `(() => {
  const labels = ${JSON.stringify(labels)};
  const button = [...document.querySelectorAll('nav.role-navigation button')]
    .find((node) => labels.some((label) => node.textContent?.includes(label)) && !node.disabled);
  if (!button) return false;
  button.click();
  return true;
})()`;

const clickAnyButton = (labels) => `(() => {
  const labels = ${JSON.stringify(labels)};
  const button = [...document.querySelectorAll('button')]
    .find((node) => labels.some((label) => node.textContent?.includes(label)) && !node.disabled);
  if (!button) return false;
  button.click();
  return true;
})()`;

async function answerVisiblePracticeQuestion() {
  await waitFor(`document.querySelectorAll('.options button, .exam-question-area button').length > 0`, 30000, 'practice-session options');
  await evaluate(`(() => {
    const option = document.querySelector('.options button, .exam-question-area button');
    if (!option || option.disabled) return false;
    option.click();
    return true;
  })()`);
  await wait(1200);
  await submitReasonPromptIfPresent();
  await wait(900);
}

async function submitReasonPromptIfPresent() {
  const submitted = await evaluate(`(() => {
    const dialog = [...document.querySelectorAll('.error-reason-overlay, .overlay, [role="dialog"]')]
      .find((node) => /错因自评|为什么做错|错误原因|选择错误原因|提交错因/.test(
        (node.getAttribute('aria-label') ?? '') + ' ' + (node.textContent ?? ''),
      ));
    if (!dialog) return false;

    const radio = dialog.querySelector('input[type="radio"]:not(:checked)');
    if (!dialog.querySelector('input[type="radio"]:checked') && radio) {
      radio.click();
    }

    const submit = [...dialog.querySelectorAll('button')]
      .find((node) => /确认|提交|继续|提交错因|提交重做结果/.test(node.textContent ?? '') && !node.disabled);
    if (!submit) return false;
    submit.click();
    return true;
  })()`);

  if (submitted) {
    await waitFor(`![...document.querySelectorAll('.error-reason-overlay, [role="dialog"]')]
      .some((node) => /错因自评|为什么做错|提交错因/.test(
        (node.getAttribute('aria-label') ?? '') + ' ' + (node.textContent ?? ''),
      ))`, 20000, 'reason prompt to close');
  }
  check('reason-prompt-submit', true, submitted ? 'reason prompt submitted' : 'no reason prompt shown');
}

async function run() {
  if (!LOGIN_EMAIL || !LOGIN_PASSWORD) {
    throw new Error('LOGIN_EMAIL and LOGIN_PASSWORD environment variables are required');
  }

  await mkdir(OUT_DIR, { recursive: true });
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'p0-student-loop-'));
  const remotePort = 9800 + Math.floor(Math.random() * 300);
  chromeProcess = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--window-size=1440,1000',
    `--remote-debugging-port=${remotePort}`,
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true });

  try {
    const tabs = await waitForDebuggingPort(remotePort);
    const pageTarget = tabs.find((tab) => tab.type === 'page') ?? tabs[0];
    socket = await createDevToolsSocket(pageTarget.webSocketDebuggerUrl);
    socket.on('message', (message) => {
      const handler = pending.get(message.id);
      if (handler) {
        pending.delete(message.id);
        if (message.error) handler.reject(new Error(message.error.message));
        else handler.resolve(message.result);
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
        const text = (message.params.args ?? []).map((arg) => arg.value ?? arg.description ?? '').join(' ');
        if (text && !text.includes('favicon')) consoleErrors.push(text.slice(0, 240));
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const text = message.params?.exceptionDetails?.text ?? '';
        if (text) consoleErrors.push('exception: ' + text.slice(0, 240));
      }
    });

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: appUrlWithCacheBust() });
    await waitFor(`document.querySelector('input[name="email"]') != null`, 60000, 'login form');
    await evaluate(fillInput('form input[name="email"]', LOGIN_EMAIL));
    await evaluate(fillInput('form input[name="password"]', LOGIN_PASSWORD));
    const submitted = await evaluate(`(() => {
      const form = document.querySelector('form');
      if (!form) return false;
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.querySelector('button[type="submit"]')?.click();
      return true;
    })()`);
    check('login-form-submit', submitted, 'login form submitted');
    await waitFor(`!!document.querySelector('nav.role-navigation')`, 60000, 'post-login navigation');
    await waitFor(`document.body.innerText.includes('学习中枢') || document.body.innerText.includes('学习总览')`, 90000, 'login-dashboard');
    check('login-dashboard', true, 'student workspace loaded');
    await screenshot('01-login-dashboard');

    const todayNav = await evaluate(clickRoleNav('今日计划'));
    check('today-plan-nav-click', todayNav, 'navigate to today plan');
    await waitFor(`document.body.innerText.includes('今日计划')`, 30000, 'today-plan');
    const todayPlan = await evaluate(`(() => ({
      hasTodayPlan: document.body.innerText.includes('今日计划'),
      hasTask: /开始|继续|复习|练习/.test(document.body.innerText),
      primaryButtons: [...document.querySelectorAll('button')].filter((node) => /开始|继续|复习|练习/.test(node.textContent ?? '') && !node.disabled).length,
    }))()`);
    check('today-plan', todayPlan.hasTodayPlan && todayPlan.hasTask, JSON.stringify(todayPlan));
    await screenshot('02-today-plan');

    let practiceStarted = await evaluate(clickAnyButton(['开始练习', '开始复习', '继续练习', '继续学习', '开始今日任务']));
    if (!practiceStarted) {
      await evaluate(clickRoleNav('题库训练'));
      await wait(1000);
      practiceStarted = await evaluate(clickAnyButton(['开始练习', '继续练习', '进入练习']));
    }
    const practiceReady = await evaluate(`document.querySelectorAll('.options button, .exam-question-area button').length > 0`);
    check('practice-session-launch', practiceStarted || practiceReady, practiceStarted ? 'practice entry clicked' : 'practice-session-ready');
    await answerVisiblePracticeQuestion();
    const practiceState = await evaluate(`(() => {
      const text = document.body.innerText;
      return {
        hasFeedback: /解析|正确答案|答题结果|错因|下一步/.test(text),
        optionCount: document.querySelectorAll('.options button, .exam-question-area button').length,
      };
    })()`);
    check('practice-session', practiceState.hasFeedback, JSON.stringify(practiceState));
    await screenshot('03-practice-session');

    await evaluate(clickRoleNav('错题复盘'));
    await waitFor(`document.body.innerText.includes('错题') || document.body.innerText.includes('复盘')`, 30000, 'wrong-book');
    await waitFor(`!document.body.innerText.includes('正在加载错题复盘')`, 60000, 'wrong-book loaded');
    const wrongBook = await evaluate(`(() => ({
      hasWrongBook: /错题|复盘/.test(document.body.innerText),
      hasDetailAction: [...document.querySelectorAll('button')].some((node) => /详情|解析|笔记/.test(node.textContent ?? '')),
      hasRedoAction: [...document.querySelectorAll('button')].some((node) => /重做|再练/.test(node.textContent ?? '')),
    }))()`);
    check('wrong-book', wrongBook.hasWrongBook, JSON.stringify(wrongBook));
    await screenshot('04-wrong-book');

    const detailOpened = await evaluate(clickAnyButton(['详情与笔记', '查看解析', '详情']));
    check('wrong-detail-open-click', detailOpened, 'wrong detail action clicked');
    if (detailOpened) {
      await waitFor(`document.body.innerText.includes('解析') || document.body.innerText.includes('错因') || document.body.innerText.includes('证据')`, 20000, 'wrong-detail');
      const detail = await evaluate(`(() => ({
        hasAnalysis: /解析|错因/.test(document.body.innerText),
        hasEvidence: /知识|证据|真题|掌握度/.test(document.body.innerText),
      }))()`);
      check('wrong-detail', detail.hasAnalysis, JSON.stringify(detail));
      await screenshot('05-wrong-detail');
    }

    const redoClicked = await evaluate(clickAnyButton(['重做', '再练']));
    check('wrong-redo-click', redoClicked, 'wrong redo action clicked');
    if (redoClicked) {
      await waitFor(`document.querySelectorAll('.options button, .exam-question-area button').length > 0`, 20000, 'wrong-redo');
      check('wrong-redo', true, 'redo practice opened');
      await screenshot('06-wrong-redo');
    }

    const catalogNavClicked = await evaluate(clickAnyRoleNav(['408知识图谱', '知识体系']));
    check('knowledge-catalog-nav-click', catalogNavClicked, '408知识图谱 navigation clicked');
    await waitFor(`!document.body.innerText.includes('正在加载408知识图谱')`, 60000, 'knowledge-catalog loaded');
    await waitFor(`!!document.querySelector('.catalog-search') || document.querySelectorAll('.catalog-point-row').length > 0`, 60000, 'knowledge-catalog content');
    const catalog = await evaluate(`(() => ({
      hasCatalog: document.body.innerText.includes('知识体系') || document.body.innerText.includes('知识图谱') || !!document.querySelector('#knowledge-catalog'),
      hasSearch: !!document.querySelector('.catalog-search, input[type="search"]'),
      pointRows: document.querySelectorAll('.catalog-point-row').length,
    }))()`);
    check('knowledge-catalog', catalog.hasCatalog && (catalog.hasSearch || catalog.pointRows > 0), JSON.stringify(catalog));
    await screenshot('07-knowledge-catalog');

    check('no-console-errors', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 5)));
    const summary = {
      appUrl: APP_URL,
      pass: checks.filter((item) => item.ok).length,
      fail: checks.filter((item) => !item.ok).length,
      checks,
      consoleErrors,
      outDir: OUT_DIR,
    };
    await writeFile(path.join(OUT_DIR, 'report.json'), JSON.stringify(summary, null, 2));
    console.log('SUMMARY', JSON.stringify(summary, null, 2));
    if (summary.fail > 0) process.exitCode = 1;
  } finally {
    try { socket?.close(); } catch {}
    try { chromeProcess?.kill(); } catch {}
    await wait(300);
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
}

run().catch(async (error) => {
  console.error('FATAL', error && error.stack ? error.stack : error);
  try {
    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(path.join(OUT_DIR, 'report.json'), JSON.stringify({
      appUrl: APP_URL,
      checks,
      consoleErrors,
      fatal: String(error),
    }, null, 2));
  } catch {}
  process.exitCode = 1;
});
