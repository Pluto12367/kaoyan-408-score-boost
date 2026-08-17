// Deep-interaction browser verification for the student flows that the
// surface check only touched: today-plan task launch, wrong-book detail/redo,
// report trend, score-center generation, stage assessment, mock exam,
// AI tutor panel, learning calendar/reminders. Drives headless Chrome via CDP.
//
// Usage:
//   LOGIN_EMAIL=... LOGIN_PASSWORD=... npm run verify:deep-interactions
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
const OUT_DIR = path.resolve(process.env.OUT_DIR ?? 'assets/deep-interactions-check');

const checks = [];
const consoleErrors = [];
let chromeProcess = null;
let socket = null;

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(ok ? 'PASS' : 'FAIL', name, detail ?? '');
}

const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'deep-interactions-'));
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

const clickButton = (label) => `(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === ${JSON.stringify(label)} || b.textContent?.trim().includes(${JSON.stringify(label)}));
  if (!btn || btn.disabled) return false;
  btn.click();
  return true;
})()`;

async function answerAndAdvance() {
  await waitFor(`document.querySelectorAll('.options button').length > 0`, 20000, 'question options');
  await evaluate(`(() => { const o = document.querySelector('.options button'); if (o) o.click(); return !!o; })()`);
  await wait(1400);
  await evaluate(`(() => {
    const overlay = [...document.querySelectorAll('.overlay, [role="dialog"]')].find((el) => el.textContent?.includes('错误原因') || el.textContent?.includes('选择错误原因'));
    if (!overlay) return false;
    const submit = overlay.querySelector('button[type="submit"], .primary-action');
    if (submit) submit.click();
    return true;
  })()`);
  await wait(800);
}

async function answerExamQuestion() {
  await waitFor(`document.querySelectorAll('.exam-question-area button').length > 0`, 20000, 'exam question options');
  await evaluate(`(() => {
    const option = document.querySelector('.exam-question-area button');
    if (option) option.click();
    return !!option;
  })()`);
  await wait(900);
}

async function exitSessionIfOpen() {
  const exited = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '退出');
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  await wait(1200);
  if (exited) {
    await evaluate(`(() => {
      const confirmBtn = [...document.querySelectorAll('.overlay button, [role="dialog"] button')].find((b) => /确认|退出|继续/.test(b.textContent?.trim() ?? ''));
      if (confirmBtn && document.querySelector('.overlay, [role="dialog"]')) confirmBtn.click();
      return !!confirmBtn;
    })()`);
    await wait(1200);
  }
  return exited;
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
  await evaluate(`(() => { const f = document.querySelector('form'); f.requestSubmit(); return true; })()`);
  await waitFor(`!!document.querySelector('nav.role-navigation')`, 60000, 'post-login nav');
  await waitFor(`!document.body.innerText.includes('正在加载学习总览')`, 45000, 'dashboard overview loaded');
  await wait(1000);
  check('login-dashboard', true, 'login + dashboard overview loaded');

  // ---- Dashboard: learning calendar / reminders / mock exam entry ----
  const dash = await evaluate(`(() => {
    const text = document.body.innerText;
    return {
      hasStreak: /连续学习\\s*\\d+\\s*天/.test(text),
      hasWrongPending: /待复盘错题\\s*\\d+/.test(text),
      hasExamEntry: [...document.querySelectorAll('button')].some((b) => (b.textContent?.trim() ?? '').includes('生成并开始考试')),
    };
  })()`);
  check('dashboard-calendar-streak', dash.hasStreak, '连续学习 N 天 present');
  check('dashboard-reminders-wrong-pending', dash.hasWrongPending, '待复盘错题 stat present');
  check('dashboard-exam-entry', dash.hasExamEntry, '模拟考试 entry button present');
  await screenshot('01-dashboard');

  // ---- Mock exam: start, verify session, exit ----
  const examStarted = await evaluate(clickButton('生成并开始考试'));
  check('mock-exam-start-clicked', examStarted, '生成并开始考试 clicked');
  if (examStarted) {
    await waitFor(`!!document.querySelector('.exam-session, [class*="exam-session"]')`, 30000, 'exam session');
    await wait(1200);
    const examState = await evaluate(`(() => {
      const text = document.body.innerText;
      return {
        hasSession: !!document.querySelector('.exam-session, [class*="exam-session"]'),
        hasQuestion: document.querySelectorAll('.exam-question-area button').length > 0,
        optionLabels: [...document.querySelectorAll('.exam-question-area button')].map((b) => b.textContent?.trim()).slice(0, 4),
      };
    })()`);
    check('mock-exam-session-opens', examState.hasSession && examState.hasQuestion, JSON.stringify(examState));
    await screenshot('02-mock-exam');
    await answerExamQuestion();
    await exitSessionIfOpen();
  }

  // ---- Today plan: task launch + stage assessment ----
  await evaluate(navClick('今日计划'));
  await waitFor(`document.body.innerText.includes('今日计划')`, 30000, 'today plan');
  await wait(1800);
  const planState = await evaluate(`(() => {
    const text = document.body.innerText;
    const completed = [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === '已完成' && !b.disabled);
    const reviewButtons = [...document.querySelectorAll('button')].filter((b) => (b.textContent?.trim() ?? '').includes('开始复习')).length;
    return {
      hasPlan: text.includes('今日计划'),
      hasCalendar: text.includes('学习日历') && /连续学习\\s*\\d+\\s*天/.test(text),
      hasCompletedTask: completed || text.includes('已完成 1/1') || text.includes('1/1 已完成'),
      reviewButtons,
    };
  })()`);
  check('today-plan-content', planState.hasPlan && planState.hasCalendar, JSON.stringify(planState));
  check('today-plan-completed-task', planState.hasCompletedTask, 'completed task status present');
  check('today-plan-review-buttons', planState.reviewButtons >= 1, `review buttons=${planState.reviewButtons}`);
  await screenshot('03-today-plan');
  const reviewClicked = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent?.trim() ?? '').includes('开始复习'));
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  })()`);
  check('review-task-launch-clicked', reviewClicked, '开始复习 clicked');
  if (reviewClicked) {
    await waitFor(`document.body.innerText.includes('错题') || document.body.innerText.includes('复盘')`, 20000, 'review flow');
    await wait(1000);
    check('review-task-launch-flow', true, 'review flow opened');
    await screenshot('03b-review-launch');
  }

  await evaluate(navClick('今日计划'));
  await wait(1500);
  const stageEntry = await evaluate(`(() => {
    const text = document.body.innerText;
    const hasStart = [...document.querySelectorAll('button')].some((b) => (b.textContent?.trim() ?? '').includes('开始阶段测评'));
    return { hasPanel: text.includes('阶段测评'), hasStart };
  })()`);
  check('stage-assessment-panel', stageEntry.hasPanel && stageEntry.hasStart, JSON.stringify(stageEntry));
  if (stageEntry.hasStart) {
    await evaluate(clickButton('开始阶段测评'));
    await waitFor(`!!document.querySelector('.exam-session, [class*="exam-session"]')`, 30000, 'stage assessment session');
    await wait(1200);
    const stageSession = await evaluate(`(() => ({
      hasSession: !!document.querySelector('.exam-session, [class*="exam-session"]'),
      hasQuestion: document.querySelectorAll('.exam-question-area button').length > 0,
      title: (document.body.innerText.match(/阶段测评[^\\n]*/) || [])[0] ?? null,
    }))()`);
    check('stage-assessment-session-opens', stageSession.hasSession && stageSession.hasQuestion, JSON.stringify(stageSession));
    await screenshot('04-stage-assessment');
    await answerExamQuestion();
    await exitSessionIfOpen();
  }

  // ---- Wrong book: detail + redo ----
  await evaluate(navClick('错题复盘'));
  await waitFor(`document.body.innerText.includes('待复盘')`, 30000, 'wrong book');
  await wait(1500);
  const detailOpened = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent?.trim() ?? '').includes('详情与笔记'));
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  check('wrong-detail-opens', detailOpened, '详情与笔记 clicked');
  if (detailOpened) {
    await waitFor(`document.body.innerText.includes('错因') || document.body.innerText.includes('相似题') || document.body.innerText.includes('复习')`, 20000, 'wrong detail content');
    await wait(800);
    const detail = await evaluate(`(() => {
      const text = document.body.innerText;
      return {
        hasAnalysis: text.includes('错因') || text.includes('解析'),
        hasSimilar: text.includes('相似题'),
        hasReviewPlan: text.includes('复习计划') || text.includes('下次复习'),
      };
    })()`);
    check('wrong-detail-content', detail.hasAnalysis, JSON.stringify(detail));
    await screenshot('05-wrong-detail');
    await evaluate(`(() => { const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent?.trim() ?? '').includes('关闭')); if (btn) btn.click(); return !!btn; })()`);
    await wait(600);
  }
  const redoClicked = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '重做' && !b.disabled);
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  check('wrong-redo-clicked', redoClicked, '重做 clicked');
  if (redoClicked) {
    await waitFor(`document.querySelectorAll('.options button').length > 0`, 20000, 'redo practice');
    check('wrong-redo-practice-opens', true, 'redo practice panel with options');
    await screenshot('06-wrong-redo');
    await answerAndAdvance();
  }

  // ---- Report: mastery trend tab + actions ----
  await evaluate(navClick('提分报告'));
  await waitFor(`!!document.querySelector('.report-workspace')`, 30000, 'report workspace');
  await wait(1200);
  await evaluate(`(() => {
    const tab = [...document.querySelectorAll('.report-tabs button')].find((b) => b.textContent?.trim() === '四科掌握度');
    if (tab) tab.click();
    return !!tab;
  })()`);
  await waitFor(`document.body.innerText.includes('掌握度趋势')`, 20000, 'mastery trend');
  await wait(800);
  const report = await evaluate(`(() => {
    const text = document.body.innerText;
    const actionButtons = [...document.querySelectorAll('button')].filter((b) => /去练习|去错题本|开始练习/.test(b.textContent?.trim() ?? ''));
    return {
      hasTrend: text.includes('掌握度趋势'),
      hasImproving: text.includes('提升最快'),
      hasDeclining: text.includes('需要关注'),
      actionButtons: actionButtons.length,
    };
  })()`);
  check('report-trend-data', report.hasTrend && (report.hasImproving || report.hasDeclining), JSON.stringify(report));
  check('report-action-buttons', report.actionButtons >= 1, `actions=${report.actionButtons}`);
  await screenshot('07-report-trend');

  // ---- Score center: generate plan ----
  await evaluate(navClick('今日提分'));
  await waitFor(`document.body.innerText.includes('今日提分')`, 30000, 'score center');
  await wait(1200);
  const generated = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent?.trim() ?? '').includes('生成'));
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  })()`);
  check('score-center-generate-clicked', generated, '生成 clicked');
  if (generated) {
    await waitFor(`document.body.innerText.includes('今日计划') || document.body.innerText.includes('推荐') || document.body.innerText.includes('分钟')`, 40000, 'plan generation result');
    await wait(1500);
    const planResult = await evaluate(`(() => {
      const text = document.body.innerText;
      return {
        hasTasks: /\\d+\\s*分钟|任务|推荐/.test(text),
        hasItems: document.querySelectorAll('.score-center-item, [class*="score-center"] li, .recommendation-card').length,
      };
    })()`);
    check('score-center-plan-generated', planResult.hasTasks, JSON.stringify(planResult));
    await screenshot('08-score-center-plan');
  }

  // ---- AI tutor panel surface ----
  await evaluate(navClick('AI 答疑'));
  await waitFor(`document.body.innerText.includes('AI') || document.body.innerText.includes('答疑') || document.body.innerText.includes('讲解')`, 30000, 'ai tutor panel');
  await wait(1200);
  const ai = await evaluate(`(() => {
    const text = document.body.innerText;
    return {
      hasTutorPanel: text.includes('AI') && (text.includes('讲解') || text.includes('提问') || text.includes('答疑')),
      snippet: text.slice(0, 200),
    };
  })()`);
  check('ai-tutor-panel', ai.hasTutorPanel, ai.snippet);
  await screenshot('09-ai-tutor');

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
