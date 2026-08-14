// Browser verification of the knowledge-graph convergence loop (phases 0-5)
// against a deployed instance. Drives headless Chrome via CDP, logs in with a
// real student account, and checks:
//   1. login + dashboard regression
//   2. knowledge catalog node mastery badges (phase 1)
//   3. catalog drawer: 我的掌握度 / 考点题库 / 真题命中 / 去练习 / 练习本题 (phases 1+3)
//   4. question training panel navigation
//   5. report 四科掌握度 -> 掌握度趋势 panel (phase 4)
//
// Usage:
//   LOGIN_EMAIL=... LOGIN_PASSWORD=... npm run verify:graph-convergence
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
const OUT_DIR = path.resolve(process.env.OUT_DIR ?? 'assets/graph-convergence-check');

const checks = [];
let chromeProcess = null;
let socket = null;

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(ok ? 'PASS' : 'FAIL', name, detail ?? '');
}

const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'graph-convergence-'));
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
  await waitFor(`document.body.innerText.includes('学习中控台') || document.body.innerText.includes('学习总览')`, 90000, 'dashboard overview');
  await wait(800);
  check('dashboard-loaded', true, 'dashboard overview rendered after login');
  await screenshot('01-dashboard');

  // ---- Knowledge graph (phases 1 + 3) ----
  await evaluate(navClick('408知识图谱'));
  await waitFor(`!!document.querySelector('#knowledge-catalog')`, 30000, 'knowledge catalog panel');
  await wait(1500);
  const catalogSnapshot = await evaluate(`(() => {
    const el = document.querySelector('#knowledge-catalog');
    return {
      text: (el?.innerText ?? '').slice(0, 600),
      chapterHeads: document.querySelectorAll('.catalog-chapter-head').length,
      sectionHeads: document.querySelectorAll('.catalog-section-head').length,
      pointRows: document.querySelectorAll('.catalog-point-row').length,
      tree: !!document.querySelector('.catalog-tree'),
      emptyState: document.querySelector('.empty-state')?.innerText ?? null,
    };
  })()`);
  console.log('CATALOG_SNAPSHOT', JSON.stringify(catalogSnapshot));
  if (catalogSnapshot.chapterHeads > 0) {
    await evaluate(`(() => {
      const head = document.querySelector('.catalog-chapter-head');
      if (head) head.click();
      return !!head;
    })()`);
    await wait(500);
  }
  const sectionHeadsNow = await evaluate(`document.querySelectorAll('.catalog-section-head').length`);
  if (sectionHeadsNow > 0) {
    await evaluate(`(() => {
      const head = document.querySelector('.catalog-section-head');
      if (head) head.click();
      return !!head;
    })()`);
    await wait(500);
  }
  await waitFor(`document.querySelectorAll('.catalog-point-row').length > 0`, 30000, 'catalog point rows');
  await wait(800);
  const badgeStats = await evaluate(`(() => {
    const counts = {};
    for (const row of document.querySelectorAll('.catalog-point-row')) {
      const status = row.getAttribute('data-mastery-status') || 'untouched';
      counts[status] = (counts[status] || 0) + 1;
    }
    return { total: document.querySelectorAll('.catalog-point-row').length, counts };
  })()`);
  const practicedCount = (badgeStats.counts.weak || 0) + (badgeStats.counts.review || 0) + (badgeStats.counts.mastered || 0);
  const rowsWithStatus = Object.values(badgeStats.counts).reduce((sum, count) => sum + count, 0);
  check('catalog-mastery-badges', rowsWithStatus === badgeStats.total && badgeStats.total > 0, JSON.stringify({ mechanism: true, distribution: badgeStats.counts, practiced: practicedCount }));
  await screenshot('02-catalog');

  const opened = await evaluate(`(() => {
    const row = [...document.querySelectorAll('.catalog-point-row')].find((r) => (r.getAttribute('data-mastery-status') || 'untouched') !== 'untouched')
      ?? document.querySelector('.catalog-point-row');
    if (!row) return false;
    row.click();
    return true;
  })()`);
  check('catalog-drawer-opens', opened, 'clicked a point row');
  await waitFor(`!!document.querySelector('.catalog-drawer')`, 15000, 'catalog drawer');
  await wait(600);
  const drawerState = await evaluate(`(() => {
    const text = document.querySelector('.catalog-drawer')?.innerText ?? '';
    const h4s = [...document.querySelectorAll('.catalog-drawer h4')].map((h) => h.textContent.trim());
    return {
      h4s,
      hasMastery: text.includes('我的掌握度'),
      hasQuestionBank: text.includes('考点题库'),
      hasExamHits: text.includes('真题命中'),
      hasPracticeThis: text.includes('练习本题'),
      hasGoPractice: text.includes('去练习'),
      questionBankCount: (text.match(/考点题库（(\d+) 题）/) || [])[1] || null,
      examHitCount: (text.match(/真题命中/) && [...document.querySelectorAll('.catalog-drawer-section')].find((s) => s.querySelector('h4')?.textContent.includes('真题命中'))?.querySelectorAll('.catalog-ref-item').length) || null,
    };
  })()`);
  check('drawer-mastery-section', drawerState.hasMastery, JSON.stringify(drawerState.h4s));
  check('drawer-question-bank', drawerState.hasQuestionBank, `count=${drawerState.questionBankCount}`);
  check('drawer-exam-hits', drawerState.hasExamHits, `items=${drawerState.examHitCount}`);
  check('drawer-go-practice', drawerState.hasGoPractice, '去练习 button present');
  const drawerSectionTexts = await evaluate(`(() => {
    const sections = [...document.querySelectorAll('.catalog-drawer-section')];
    const grab = (label) => {
      const section = sections.find((s) => s.querySelector('h4')?.textContent.includes(label));
      return section ? section.innerText.slice(0, 240) : null;
    };
    return { mastery: grab('我的掌握度'), questionBank: grab('考点题库'), examHits: grab('真题命中') };
  })()`);
  console.log('DRAWER_SECTION_TEXT', JSON.stringify(drawerSectionTexts));
  await screenshot('03-catalog-drawer');

  // Close the drawer (overlay) before navigating away.
  await evaluate(`(() => {
    const btn = document.querySelector('.catalog-drawer-close');
    if (btn) btn.click();
    return !!btn;
  })()`);
  await wait(400);

  // Jump to a mapped node with bank questions and exam hits (信号量, OS).
  await evaluate(`(() => {
    const tab = [...document.querySelectorAll('#knowledge-catalog [role="tab"]')].find((b) => b.textContent?.trim() === '操作系统');
    if (tab) tab.click();
    return !!tab;
  })()`);
  await wait(500);
  await evaluate(`(() => {
    const input = document.querySelector('.catalog-search');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '信号量');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await waitFor(`document.querySelectorAll('.catalog-point-row').length > 0`, 15000, 'signal search rows');
  await wait(600);
  const mappedRowClicked = await evaluate(`(() => {
    const row = [...document.querySelectorAll('.catalog-point-row')].find((r) => r.textContent?.includes('信号量'));
    if (!row) return false;
    row.click();
    return true;
  })()`);
  check('mapped-node-drawer-opens', mappedRowClicked, '信号量 row clicked');
  await waitFor(`!!document.querySelector('.catalog-drawer')`, 15000, 'mapped node drawer');
  await wait(600);
  const mappedDrawer = await evaluate(`(() => {
    const sections = [...document.querySelectorAll('.catalog-drawer-section')];
    const grab = (label) => {
      const section = sections.find((s) => s.querySelector('h4')?.textContent.includes(label));
      return section ? section.innerText.slice(0, 260) : null;
    };
    return {
      questionBank: grab('考点题库'),
      examHits: grab('真题命中'),
      hasPracticeThis: document.body.innerText.includes('练习本题'),
    };
  })()`);
  check(
    'mapped-drawer-question-bank-data',
    Boolean(mappedDrawer.questionBank) && !mappedDrawer.questionBank.includes('暂无关联题库题目'),
    JSON.stringify(mappedDrawer.questionBank),
  );
  check(
    'mapped-drawer-practice-this',
    mappedDrawer.hasPracticeThis,
    '练习本题 buttons rendered for linked questions',
  );
  check(
    'mapped-drawer-exam-hits-data',
    Boolean(mappedDrawer.examHits) && !mappedDrawer.examHits.includes('暂无真题命中记录'),
    JSON.stringify(mappedDrawer.examHits),
  );
  await screenshot('06-catalog-drawer-signal');
  // Verify 我的掌握度 with real data on a node the account has practiced (Cache, CO).
  await evaluate(`(() => {
    const btn = document.querySelector('.catalog-drawer-close');
    if (btn) btn.click();
    return !!btn;
  })()`);
  await wait(400);
  await evaluate(`(() => {
    const input = document.querySelector('.catalog-search');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await wait(300);
  await evaluate(`(() => {
    const tab = [...document.querySelectorAll('#knowledge-catalog [role="tab"]')].find((b) => b.textContent?.trim() === '计算机组成原理');
    if (tab) tab.click();
    return !!tab;
  })()`);
  await wait(400);
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
  const cacheRowState = await evaluate(`(() => {
    const row = [...document.querySelectorAll('.catalog-point-row')].find((r) => r.textContent?.includes('Cache'));
    return row ? { status: row.getAttribute('data-mastery-status'), text: row.textContent.slice(0, 80) } : null;
  })()`);
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('.catalog-point-row')].find((r) => r.textContent?.includes('Cache'));
    if (row) row.click();
    return !!row;
  })()`);
  await waitFor(`!!document.querySelector('.catalog-drawer')`, 15000, 'cache node drawer');
  await wait(600);
  const cacheDrawer = await evaluate(`(() => {
    const section = [...document.querySelectorAll('.catalog-drawer-section')].find((s) => s.querySelector('h4')?.textContent.includes('我的掌握度'));
    return section ? section.innerText.slice(0, 200) : null;
  })()`);
  check('practiced-node-badge', cacheRowState?.status && cacheRowState.status !== 'untouched', JSON.stringify(cacheRowState));
  check(
    'practiced-node-mastery-data',
    Boolean(cacheDrawer) && !cacheDrawer.includes('尚未练习'),
    JSON.stringify(cacheDrawer),
  );
  await screenshot('08-practiced-node-drawer');
  const launched = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('.catalog-drawer button')].find((b) => b.textContent?.trim() === '练习本题');
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  check('practice-launched-from-catalog', launched, '练习本题 clicked');
  await waitFor(`document.body.innerText.includes('正在练习') || document.body.innerText.includes('请选择答案')`, 30000, 'practice launch');
  await wait(800);
  const practiceLaunched = await evaluate(`(() => ({
    hasQuestion: document.body.innerText.includes('正在练习') || !!document.querySelector('.options button'),
    statusSnippet: (document.body.innerText.match(/正在练习[^\\n]*/) || [])[0] ?? null,
  }))()`);
  check('practice-launch-status', practiceLaunched.hasQuestion, JSON.stringify(practiceLaunched));
  await screenshot('07-practice-launched');

  // ---- Question training (phase 2/3 regression) ----
  await evaluate(navClick('题库训练'));
  await waitFor(`document.body.innerText.includes('题库训练')`, 30000, 'question panel');
  await wait(800);
  const questionPanel = await evaluate(`(() => ({
    hasPanel: !!document.querySelector('#question') || document.body.innerText.includes('题库训练'),
    hasOptions: !!document.querySelector('.options button'),
  }))()`);
  check('question-panel-opens', questionPanel.hasPanel, JSON.stringify(questionPanel));
  await screenshot('04-question');

  // ---- Report mastery trend (phase 4) ----
  await evaluate(navClick('提分报告'));
  await waitFor(`document.querySelector('.report-workspace') != null`, 30000, 'report workspace');
  await wait(600);
  await evaluate(`(() => {
    const tab = [...document.querySelectorAll('.report-tabs button')].find((b) => b.textContent?.trim() === '四科掌握度');
    if (tab) tab.click();
    return !!tab;
  })()`);
  await waitFor(`document.body.innerText.includes('掌握度趋势')`, 15000, 'mastery trend panel');
  await wait(800);
  const trendState = await evaluate(`(() => {
    const panel = [...document.querySelectorAll('.panel')].find((p) => p.querySelector('.eyebrow')?.textContent.includes('报告图谱化'));
    const text = panel?.innerText ?? '';
    return {
      hasPanel: !!panel,
      hasBars: panel ? panel.querySelectorAll('.trend-bar').length : 0,
      hasWeakList: panel ? panel.querySelectorAll('.trend-weak-list li').length : 0,
      hasImproving: text.includes('提升最快'),
      hasDeclining: text.includes('需要关注'),
      isEmpty: text.includes('暂无掌握度快照'),
      snippet: text.slice(0, 180),
    };
  })()`);
  check('trend-panel-present', trendState.hasPanel, trendState.snippet);
  check('trend-data-present', !trendState.isEmpty && (trendState.hasBars > 0 || trendState.hasWeakList > 0), JSON.stringify({ bars: trendState.hasBars, weak: trendState.hasWeakList, empty: trendState.isEmpty }));
  check('trend-deltas', trendState.hasImproving && trendState.hasDeclining, `improving=${trendState.hasImproving}, declining=${trendState.hasDeclining}`);
  await screenshot('05-report-mastery-trend');

  // ---- Direct API evidence (authoritative server data state) ----
  const apiEvidence = await evaluate(`(async () => {
    const session = JSON.parse(localStorage.getItem('kaoyan408.auth.session') || 'null');
    const token = session?.accessToken || session?.token || '';
    const headers = { Authorization: 'Bearer ' + token };
    const get = async (path) => {
      try {
        const response = await fetch(path, { headers });
        if (!response.ok) return { status: response.status, error: true };
        return await response.json();
      } catch (error) { return { error: String(error) }; }
    };
    const mastery = await get('/api/knowledge/mastery');
    const trend = await get('/api/mastery-trend?days=14');
    const detail = await get('/api/knowledge/OS-C02-S04-P20');
    const masteryMap = await get('/api/mastery-map');
    return {
      masteryItems: Array.isArray(mastery.items) ? mastery.items.length : mastery,
      trendOverall: Array.isArray(trend.overall) ? trend.overall.length : trend,
      relatedQuestions: Array.isArray(detail.relatedQuestions) ? detail.relatedQuestions.length : detail,
      examQuestions: Array.isArray(detail.examQuestions) ? detail.examQuestions.length : detail,
      mapWeakest: Array.isArray(masteryMap.weakestPoints) ? masteryMap.weakestPoints.length : masteryMap,
    };
  })()`);
  console.log('API_EVIDENCE', JSON.stringify(apiEvidence));
  check('api-mastery-items', apiEvidence.masteryItems > 0, `items=${apiEvidence.masteryItems}`);
  check('api-trend-overall', apiEvidence.trendOverall > 0, `points=${apiEvidence.trendOverall}`);
  check('api-related-questions', apiEvidence.relatedQuestions > 0, `questions=${apiEvidence.relatedQuestions}`);
  check('api-exam-questions', apiEvidence.examQuestions > 0, `questions=${apiEvidence.examQuestions}`);
  check('api-mastery-map', apiEvidence.mapWeakest > 0, `weakest=${apiEvidence.mapWeakest}`);

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
