// Deployment smoke check for the unified "next learning step" feature.
// Drives a headless Chrome via CDP (no external dependencies), logs in with a
// real student account, and verifies the next-step card on the five student
// loop surfaces plus primary-button navigation and mobile stacking.
//
// Usage:
//   LOGIN_EMAIL=... LOGIN_PASSWORD=... APP_URL=http://... npm run verify:deployed
//
// Env options:
//   CHROME_PATH       Chrome/Edge executable (default system Chrome)
//   APP_URL           deployed app URL (default http://43.128.30.191/)
//   LOGIN_EMAIL       student login email (required)
//   LOGIN_PASSWORD    student login password (required)
//   OUT_DIR           screenshot/report output dir (default assets/deployed-check)
//   PRACTICE_ANSWER   "true" answers one practice question to verify feedback card

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
const OUT_DIR = path.resolve(process.env.OUT_DIR ?? 'assets/deployed-check');
const PRACTICE_ANSWER = (process.env.PRACTICE_ANSWER ?? 'true') === 'true';

const checks = [];
let chromeProcess = null;
let socket = null;

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(ok ? 'PASS' : 'FAIL', name, detail ?? '');
}

const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'deployed-check-'));
const remotePort = 9700 + Math.floor(Math.random() * 200);

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

const extractCards = `(() => {
  const cards = [];
  for (const card of document.querySelectorAll('.next-learning-step-card')) {
    const h4 = card.querySelector('h4');
    const reasonP = card.querySelector('.next-learning-step-copy p:last-of-type');
    const span = reasonP ? reasonP.querySelector('span') : null;
    cards.push({
      ariaLabel: card.getAttribute('aria-label'),
      title: h4 ? h4.textContent.trim() : null,
      reason: reasonP ? reasonP.textContent.slice(span ? span.textContent.length : 0).trim() : null,
      primary: card.querySelector('.primary-action') ? card.querySelector('.primary-action').textContent.trim() : null,
      secondary: card.querySelector('.secondary-action') ? card.querySelector('.secondary-action').textContent.trim() : null,
    });
  }
  return cards;
})()`;

const VALID_TARGETS = ['#/dashboard', '#/plan', '#/question', '#/wrong-book', '#/report'];

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
  await send('Page.navigate', { url: APP_URL + '?t=' + Date.now() });
  await waitFor(`document.querySelector('input[name="email"]') != null`, 60000, 'login form');

  await evaluate(`(() => {
    const tab = [...document.querySelectorAll('[role="tablist"] button')].find((b) => b.textContent?.trim() === '登录');
    if (tab) tab.click();
    return !!tab;
  })()`);
  await wait(400);
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
  await waitFor(`document.body.innerText.includes('学习中控台')`, 90000, 'dashboard overview');
  await wait(800);

  const dashboardCards = await evaluate(extractCards);
  check('dashboard-next-step-card', dashboardCards.length === 1, JSON.stringify(dashboardCards[0] ?? null));
  if (dashboardCards.length !== 1) throw new Error('Dashboard next-step card missing or duplicated');
  const dashboardCard = dashboardCards[0];
  check('dashboard-card-title', typeof dashboardCard.title === 'string' && dashboardCard.title.startsWith('下一步：'), dashboardCard.title);
  check('dashboard-card-reason', typeof dashboardCard.reason === 'string' && dashboardCard.reason.length > 0, dashboardCard.reason);
  check('dashboard-card-buttons', Boolean(dashboardCard.primary && dashboardCard.secondary), `${dashboardCard.primary} / ${dashboardCard.secondary}`);
  check('dashboard-card-aria', dashboardCard.ariaLabel === '首页下一步', dashboardCard.ariaLabel);
  await screenshot('01-dashboard');

  const navClicked = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('.next-learning-step-card button')].find((b) => b.textContent?.trim() === ${JSON.stringify(dashboardCard.primary)});
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  check('dashboard-primary-click', navClicked, dashboardCard.primary);
  await wait(1200);
  const hash = await evaluate('location.hash');
  check('dashboard-primary-target', VALID_TARGETS.includes(hash), hash);
  await screenshot('02-dashboard-nav');

  const sections = [
    { key: 'plan', nav: '今日计划', wait: `!!document.querySelector('#plan')`, shot: '03-plan' },
    { key: 'wrong-book', nav: '错题复盘', wait: `!!document.querySelector('#wrong-book')`, shot: '05-wrong-book' },
    { key: 'report', nav: '提分报告', wait: `!!document.querySelector('#report-summary') || !!document.querySelector('.report-summary-panel')`, shot: '06-report' },
  ];

  for (const section of sections) {
    await evaluate(navClick(section.nav));
    await waitFor(section.wait, 30000, section.key + ' panel');
    await wait(1200);
    const cards = await evaluate(extractCards);
    check(section.key + '-next-step-card', cards.length === 1, JSON.stringify(cards[0] ?? null));
    await screenshot(section.shot);
  }

  await evaluate(navClick('题库训练'));
  await waitFor(`!!document.querySelector('#question')`, 30000, 'question panel');
  await wait(1000);
  await screenshot('04-question');
  const practice = await evaluate(`(() => ({
    hasOptions: !!document.querySelector('.options button'),
    hasAnswerResult: !!document.querySelector('.answer-result'),
  }))()`);

  if (practice.hasAnswerResult) {
    const cards = await evaluate(extractCards);
    check('practice-answer-next-step-card', cards.length === 1, JSON.stringify(cards[0] ?? null));
  } else if (practice.hasOptions && PRACTICE_ANSWER) {
    await evaluate(`(() => { const btn = document.querySelector('.options button'); if (btn) btn.click(); return !!btn; })()`);
    await waitFor(`!!document.querySelector('.answer-result')`, 30000, 'answer feedback');
    await wait(800);
    const cards = await evaluate(extractCards);
    check('practice-answer-next-step-card', cards.length === 1, JSON.stringify(cards[0] ?? null));
    await screenshot('07-answer-feedback');
  } else {
    check('practice-answer-next-step-card', true, 'skipped: no answerable question or PRACTICE_ANSWER=false');
  }

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await wait(800);
  const mobile = await evaluate(`(() => {
    const card = document.querySelector('.next-learning-step-card');
    if (!card) return { flexDirection: null, scrollWidth: 0, viewportWidth: 0 };
    return {
      flexDirection: getComputedStyle(card).flexDirection,
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    };
  })()`);
  check('mobile-card-stacks', mobile.flexDirection === 'column', JSON.stringify(mobile));
  check('mobile-no-overflow', mobile.scrollWidth <= mobile.viewportWidth, JSON.stringify(mobile));
  await screenshot('08-mobile');
  await send('Emulation.clearDeviceMetricsOverride');

  await writeFile(path.join(OUT_DIR, 'report.json'), JSON.stringify({ appUrl: APP_URL, checks }, null, 2));
  console.log('SUMMARY', JSON.stringify({ appUrl: APP_URL, pass: checks.filter((item) => item.ok).length, fail: checks.filter((item) => !item.ok).length, outDir: OUT_DIR }, null, 2));
  if (checks.some((item) => !item.ok)) process.exitCode = 1;
} catch (error) {
  console.error('FATAL', error && error.stack ? error.stack : error);
  try { await screenshot('99-fatal'); } catch {}
  try { await writeFile(path.join(OUT_DIR, 'report.json'), JSON.stringify({ appUrl: APP_URL, checks, fatal: String(error) }, null, 2)); } catch {}
  process.exitCode = 1;
} finally {
  try { socket?.close(); } catch {}
  try { chromeProcess?.kill(); } catch {}
  await wait(300);
  await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
}
