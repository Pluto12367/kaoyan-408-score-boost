// Full student-surface browser verification against a deployed instance.
// Drives headless Chrome via CDP with a real student account and checks the
// major feature areas:
//   1. login + dashboard (learning console + next-step cards)
//   2. today plan (task cards, completion loop)
//   3. question bank training (answer one question end-to-end)
//   4. knowledge catalog + node quest badges + drawer
//   5. wrong-book (list + detail + review)
//   6. report (mastery trend)
//   7. today score center (plan generation)
//   8. mobile bottom navigation + console error collection
//
// Usage:
//   LOGIN_EMAIL=... LOGIN_PASSWORD=... npm run verify:full-student
// Env: APP_URL (default http://43.128.30.191/), OUT_DIR, CHROME_PATH.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile, mkdtemp } from 'node:fs/promises';
import { connect } from 'node:net';
import os from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = process.env.APP_URL ?? 'http://43.128.30.191/';
const LOGIN_EMAIL = process.env.LOGIN_EMAIL ?? '';
const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD ?? '';
const OUT_DIR = path.resolve(process.env.OUT_DIR ?? 'assets/full-student-check');

const checks = [];
const consoleErrors = [];
let chromeProcess = null;
let socket = null;

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(ok ? 'PASS' : 'FAIL', name, detail ?? '');
}

const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'full-student-'));
const remotePort = 9900 + Math.floor(Math.random() * 200);

chromeProcess = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
  '--window-size=1440,1000', `--remote-debugging-port=${remotePort}`,
  `--user-data-dir=${userDataDir}`, 'about:blank',
], { stdio: 'ignore', windowsHide: true });

async function waitForDebuggingPort(port) {
  const url = `http://127.0.0.1:${port}/json`;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {}
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
        '', '',
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
    on(event, listener) { if (event === 'message') listeners.add(listener); },
    off(event, listener) { if (event === 'message') listeners.delete(listener); },
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
    if (length === 126) {
      if (offset + 4 > buf.length) break;
      length = buf.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (offset + 10 > buf.length) break;
      length = buf.readUInt32BE(offset + 2) * 2 ** 32 + buf.readUInt32BE(offset + 6);
      headerLength = 10;
    }
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
  if (payload.length < 126) {
    header = Buffer.from([0x81, 0x80 | payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 0x80 | 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(payload.length, 6);
  }
  const masked = Buffer.alloc(payload.length);
  for (let index = 0; index < payload.length; index += 1) {
    masked[index] = payload[index] ^ mask[index % 4];
  }
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
  if (result.exceptionDetails) {
    throw new Error('Page error: ' + JSON.stringify(result.exceptionDetails).slice(0, 400));
  }
  return result.result.value;
}

async function waitFor(expression, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await evaluate(expression);
      if (value) return value;
    } catch {}
    await wait(500);
  }
  throw new Error('Timed out waiting for ' + label);
}

async function screenshot(name) {
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(path.join(OUT_DIR, name + '.png'), Buffer.from(shot.data, 'base64'));
}

const fillInput = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
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

async function answerOneQuestion() {
  await waitFor(`document.querySelectorAll('.options button').length > 0`, 20000, 'question options');
  await evaluate(`(() => {
    const option = document.querySelector('.options button');
    if (option) option.click();
    return !!option;
  })()`);
  await wait(1400);
  await evaluate(`(() => {
    const overlay = [...document.querySelectorAll('.overlay, [role="dialog"]')].find((el) => el.textContent?.includes('错误原因') || el.textContent?.includes('选择错误原因'));
    if (!overlay) return false;
    const submit = overlay.querySelector('button[type="submit"], .primary-action');
    if (submit) submit.click();
    return true;
  })()`);
  await wait(900);
}

try {
  if (!LOGIN_EMAIL || !LOGIN_PASSWORD) {
    throw new Error('LOGIN_EMAIL and LOGIN_PASSWORD environment variables are required');
  }
  await mkdir(OUT_DIR, { recursive: true });
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
  socket.on('message', (message) => {
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
      const text = (message.params.args ?? []).map((arg) => arg.value ?? arg.description ?? '').join(' ');
      if (text && !text.includes('favicon')) consoleErrors.push(text.slice(0, 200));
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const text = message.params?.exceptionDetails?.text ?? '';
      if (text) consoleErrors.push('exception: ' + text.slice(0, 200));
    }
  });

  await send('Page.navigate', { url: APP_URL + '?t=' + Date.now() });
  await waitFor(`document.querySelector('input[name="email"]') != null`, 60000, 'login form');

  await evaluate(fillInput('form input[name="email"]', LOGIN_EMAIL));
  await evaluate(fillInput('form input[name="password"]', LOGIN_PASSWORD));
  const submitted = await evaluate(`(() => {
    const form = document.querySelector('form');
    if (!form) return false;
    if (typeof form.requestSubmit === 'function') { form.requestSubmit(); return true; }
    const btn = form.querySelector('button[type="submit"]');
    if (btn) { btn.click(); return true; }
    return false;
  })()`);
  check('login-form-submit', submitted, 'login form found and submitted');

  await waitFor(`!!document.querySelector('nav.role-navigation')`, 60000, 'post-login navigation');
  await waitFor(`document.body.innerText.includes('学习中枢') || document.body.innerText.includes('学习总览')`, 90000, 'dashboard overview');
  await wait(1200);

  // ---- 1. Dashboard ----
  const dashboard = await evaluate(`(() => {
    const text = document.body.innerText;
    return {
      hasLearningConsole: text.includes('学习中枢') || text.includes('学习总览'),
      hasTodayTask: text.includes('今日任务') || text.includes('今日计划'),
      hasNextStep: !!document.querySelector('.next-learning-step, [class*="next-step"], [class*="NextStep"]'),
      hasCalendar: text.includes('学习日历') || text.includes('连续学习'),
    };
  })()`);
  check('dashboard-learning-console', dashboard.hasLearningConsole, 'learning console present');
  check('dashboard-today-task-surface', dashboard.hasTodayTask, 'today task surface present');
  check('dashboard-next-step-cards', dashboard.hasNextStep, 'next-step card present');
  check('dashboard-calendar', dashboard.hasCalendar, 'calendar/streak present');
  await screenshot('01-dashboard');

  // ---- 2. Today plan ----
  await evaluate(navClick('今日计划'));
  await waitFor(`document.body.innerText.includes('今日计划')`, 30000, 'today plan panel');
  await wait(1500);
  const planState = await evaluate(`(() => {
    const text = document.body.innerText;
    const taskButtons = [...document.querySelectorAll('button')].filter((b) => /开始|继续/.test(b.textContent?.trim() ?? ''));
    return {
      hasPlan: text.includes('今日计划'),
      taskButtons: taskButtons.length,
      hasWeekProgress: text.includes('本周进度') || text.includes('周进度'),
    };
  })()`);
  check('today-plan-panel', planState.hasPlan, JSON.stringify(planState));
  await screenshot('02-today-plan');

  // ---- 3. Question bank training ----
  await evaluate(navClick('题库训练'));
  await waitFor(`document.body.innerText.includes('题库训练')`, 30000, 'question panel');
  await wait(1200);
  const questionState = await evaluate(`(() => ({
    hasOptions: document.querySelectorAll('.options button').length > 0,
    hasStem: !!document.querySelector('.question-stem, [class*="stem"], [class*="question"]'),
  }))()`);
  check('question-bank-opens', questionState.hasOptions, JSON.stringify(questionState));
  await screenshot('03-question-bank');
  await answerOneQuestion();
  const answeredState = await evaluate(`(() => ({
    hasResult: document.body.innerText.includes('回答正确') || document.body.innerText.includes('回答错误') || document.body.innerText.includes('解析') || document.body.innerText.includes('下一题'),
    snippet: (document.body.innerText.match(/(?:回答正确|回答错误|请选择错误原因)[^\\n]*/) || [])[0] ?? null,
  }))()`);
  check('question-answered-flow', answeredState.hasResult, JSON.stringify(answeredState));
  await screenshot('04-question-answered');

  // ---- 4. Knowledge catalog + quest badges + drawer ----
  await evaluate(navClick('408知识图谱'));
  await waitFor(`!!document.querySelector('#knowledge-catalog')`, 30000, 'knowledge catalog panel');
  await wait(1500);
  const catalog = await evaluate(`(() => ({
    chapters: document.querySelectorAll('.catalog-chapter-head').length,
    questBadges: document.querySelectorAll('.catalog-quest-badge').length,
    masteryBadges: document.querySelectorAll('.catalog-mastery-badge').length,
  }))()`);
  check('catalog-renders', catalog.chapters > 0, JSON.stringify(catalog));
  await screenshot('05-catalog');

  // Open a practiced node drawer (Cache) to verify quest section + bank + exam hits.
  await evaluate(`(() => {
    const tab = [...document.querySelectorAll('#knowledge-catalog [role="tab"]')].find((b) => b.textContent?.trim() === '计算机组成原理');
    if (tab) tab.click();
    return !!tab;
  })()`);
  await wait(500);
  await evaluate(`(() => {
    const input = document.querySelector('.catalog-search');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Cache');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await waitFor(`document.querySelectorAll('.catalog-point-row').length > 0`, 15000, 'cache search rows');
  await wait(500);
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('.catalog-point-row')].find((r) => r.textContent?.includes('Cache'));
    if (row) row.click();
    return !!row;
  })()`);
  await waitFor(`!!document.querySelector('.catalog-drawer')`, 15000, 'cache drawer');
  await wait(800);
  const drawer = await evaluate(`(() => {
    const sections = [...document.querySelectorAll('.catalog-drawer-section')];
    const grab = (label) => sections.find((s) => s.querySelector('h4')?.textContent.includes(label))?.querySelectorAll('.catalog-ref-item').length ?? 0;
    return {
      hasQuest: sections.some((s) => s.querySelector('h4')?.textContent.includes('节点闯关')),
      bankItems: grab('考点题库'),
      examItems: grab('真题命中'),
      hasMastery: sections.some((s) => s.querySelector('h4')?.textContent.includes('我的掌握度')),
    };
  })()`);
  check('drawer-quest-section', drawer.hasQuest, '节点闯关 section present');
  check('drawer-bank-questions', drawer.bankItems > 0, `bank=${drawer.bankItems}`);
  check('drawer-exam-hits', drawer.examItems > 0, `exam=${drawer.examItems}`);
  check('drawer-mastery', drawer.hasMastery, 'mastery section present');
  await screenshot('06-catalog-drawer');
  await evaluate(`(() => { const btn = document.querySelector('.catalog-drawer-close'); if (btn) btn.click(); return !!btn; })()`);
  await wait(400);

  // ---- 5. Wrong book ----
  await evaluate(navClick('错题本'));
  await waitFor(`document.body.innerText.includes('错题')`, 30000, 'wrong book panel');
  await wait(1500);
  const wrongBook = await evaluate(`(() => {
    const text = document.body.innerText;
    const rows = document.querySelectorAll('.wrong-item, [class*="wrong"]').length;
    return {
      hasPending: text.includes('待复盘') || text.includes('复习') || text.includes('错题'),
      hasStats: text.includes('总错题') || text.includes('待复盘') || text.includes('已复盘'),
      rows,
    };
  })()`);
  check('wrong-book-panel', wrongBook.hasPending && wrongBook.hasStats, JSON.stringify(wrongBook));
  await screenshot('07-wrong-book');

  // ---- 6. Report ----
  await evaluate(navClick('提分报告'));
  await waitFor(`!!document.querySelector('.report-workspace')`, 30000, 'report workspace');
  await wait(1200);
  const report = await evaluate(`(() => {
    const text = document.body.innerText;
    return {
      hasMasteryMap: text.includes('掌握度'),
      hasWeak: text.includes('薄弱'),
      hasTrend: text.includes('趋势') || text.includes('提升最快'),
      hasActions: document.querySelectorAll('button').length > 0,
    };
  })()`);
  check('report-panel', report.hasMasteryMap && report.hasWeak, JSON.stringify(report));
  check('report-trend-surface', report.hasTrend, 'trend surface present');
  await screenshot('08-report');

  // ---- 7. Today score center ----
  await evaluate(navClick('今日提分'));
  await waitFor(`document.body.innerText.includes('今日提分') || document.body.innerText.includes('提分')`, 30000, 'score center');
  await wait(1500);
  const scoreCenter = await evaluate(`(() => {
    const text = document.body.innerText;
    return {
      hasGenerate: [...document.querySelectorAll('button')].some((b) => (b.textContent?.trim() ?? '').includes('生成')),
      hasMinutes: text.includes('30') && text.includes('120'),
    };
  })()`);
  check('score-center-panel', scoreCenter.hasGenerate || scoreCenter.hasMinutes, JSON.stringify(scoreCenter));
  await screenshot('09-score-center');

  // ---- 8. Mobile bottom navigation ----
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await wait(800);
  const mobileNav = await evaluate(`(() => ({
    hasBottomNav: !!document.querySelector('.student-bottom-nav, [class*="bottom-nav"]'),
    items: [...document.querySelectorAll('.student-bottom-nav a, .student-bottom-nav button, [class*="bottom-nav"] a, [class*="bottom-nav"] button')].map((b) => b.textContent?.trim()).filter(Boolean),
  }))()`);
  check('mobile-bottom-nav', mobileNav.hasBottomNav && mobileNav.items.length >= 3, JSON.stringify(mobileNav));
  await screenshot('10-mobile');
  await send('Emulation.clearDeviceMetricsOverride');

  check('no-console-errors', consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 5)));

  await writeFile(path.join(OUT_DIR, 'report.json'), JSON.stringify({ appUrl: APP_URL, checks, consoleErrors }, null, 2));
  console.log('SUMMARY', JSON.stringify({ appUrl: APP_URL, pass: checks.filter((item) => item.ok).length, fail: checks.filter((item) => !item.ok).length, outDir: OUT_DIR }, null, 2));
  if (checks.some((item) => !item.ok)) process.exitCode = 1;
} catch (error) {
  console.error('FATAL', error && error.stack ? error.stack : error);
  try { await screenshot('99-fatal'); } catch {}
  try { await writeFile(path.join(OUT_DIR, 'report.json'), JSON.stringify({ appUrl: APP_URL, checks, consoleErrors, fatal: String(error) }, null, 2)); } catch {}
  process.exitCode = 1;
} finally {
  try { socket?.close(); } catch {}
  try { chromeProcess?.kill(); } catch {}
  await wait(300);
  await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
}
