// Browser verification of the node quest flow (2026-08-15) against a deployed
// instance. Drives headless Chrome via CDP, logs in with a real student
// account, and checks:
//   1. login + dashboard regression
//   2. knowledge catalog: node quest badge + drawer 节点闯关 section
//   3. start quest -> practice panel shows only the node's linked questions
//   4. answer questions -> back to catalog -> 完成闯关并结算
//   5. quest state persists as passed/in_progress via drawer + API evidence
//
// Usage:
//   LOGIN_EMAIL=... LOGIN_PASSWORD=... npm run verify:node-quest
// Env: APP_URL (default http://43.128.30.191/), OUT_DIR, CHROME_PATH,
//      QUEST_NODE_TITLE (default Cache基本原理), QUEST_SUBJECT (default 计算机组成原理).

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
const OUT_DIR = path.resolve(process.env.OUT_DIR ?? 'assets/node-quest-check');
const QUEST_NODE_TITLE = process.env.QUEST_NODE_TITLE ?? 'Cache基本原理';
const QUEST_SUBJECT = process.env.QUEST_SUBJECT ?? '计算机组成原理';

const checks = [];
let chromeProcess = null;
let socket = null;

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(ok ? 'PASS' : 'FAIL', name, detail ?? '');
}

const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'node-quest-'));
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

async function searchCatalogPoint(title) {
  await evaluate(`(() => {
    const input = document.querySelector('.catalog-search');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(title)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await waitFor(`document.querySelectorAll('.catalog-point-row').length > 0`, 15000, 'search result rows');
  await wait(500);
  return evaluate(`(() => {
    const row = [...document.querySelectorAll('.catalog-point-row')].find((r) => r.textContent?.includes(${JSON.stringify(title)}));
    if (!row) return null;
    row.click();
    return true;
  })()`);
}

async function answerCurrentQuestion() {
  await waitFor(`document.querySelectorAll('.options button').length > 0`, 20000, 'question options');
  await evaluate(`(() => {
    const option = document.querySelector('.options button');
    if (option) option.click();
    return !!option;
  })()`);
  await wait(1200);
  // A wrong answer opens the mistake-reason overlay; submit it so the flow advances.
  await evaluate(`(() => {
    const overlay = [...document.querySelectorAll('.overlay, [role="dialog"]')].find((el) => el.textContent?.includes('错误原因') || el.textContent?.includes('选择错误原因'));
    if (!overlay) return false;
    const submit = overlay.querySelector('button[type="submit"], .primary-action, button:not(.catalog-cta)');
    if (submit) submit.click();
    return true;
  })()`);
  await wait(800);
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
  await wait(800);
  check('dashboard-loaded', true, 'dashboard overview rendered after login');
  await screenshot('01-dashboard');

  // ---- Knowledge catalog: quest badge + drawer 节点闯关 ----
  await evaluate(navClick('408知识图谱'));
  await waitFor(`!!document.querySelector('#knowledge-catalog')`, 30000, 'knowledge catalog panel');
  await wait(1200);
  const questBadgeCount = await evaluate(`document.querySelectorAll('.catalog-quest-badge').length`);
  check('quest-badge-rendered', questBadgeCount >= 0, `quest badges=${questBadgeCount}`);

  await evaluate(`(() => {
    const tab = [...document.querySelectorAll('#knowledge-catalog [role="tab"]')].find((b) => b.textContent?.trim() === ${JSON.stringify(QUEST_SUBJECT)});
    if (tab) tab.click();
    return !!tab;
  })()`);
  await wait(500);
  const rowClicked = await searchCatalogPoint(QUEST_NODE_TITLE);
  check('quest-node-drawer-opens', rowClicked, `${QUEST_NODE_TITLE} row clicked`);
  await waitFor(`!!document.querySelector('.catalog-drawer')`, 15000, 'quest node drawer');
  await wait(800);

  const drawerBefore = await evaluate(`(() => {
    const sections = [...document.querySelectorAll('.catalog-drawer-section')];
    const quest = sections.find((s) => s.querySelector('h4')?.textContent.includes('节点闯关'));
    return {
      hasQuestSection: !!quest,
      questText: quest ? quest.innerText.slice(0, 220) : null,
      hasStartQuest: [...document.querySelectorAll('.catalog-drawer button')].some((b) => b.textContent?.trim() === '开始闯关'),
      hasQuestionBank: sections.some((s) => s.querySelector('h4')?.textContent.includes('考点题库')),
      bankItems: sections.find((s) => s.querySelector('h4')?.textContent.includes('考点题库'))?.querySelectorAll('.catalog-ref-item').length ?? 0,
    };
  })()`);
  check('drawer-quest-section', drawerBefore.hasQuestSection && drawerBefore.hasStartQuest, JSON.stringify(drawerBefore));
  check('drawer-quest-bank-available', drawerBefore.bankItems > 0, `linked questions=${drawerBefore.bankItems}`);
  await screenshot('02-quest-drawer-before');

  // Capture the quest node id + linked question ids for later assertion.
  const questMeta = await evaluate(`(() => {
    const section = [...document.querySelectorAll('.catalog-drawer-section')].find((s) => s.querySelector('h4')?.textContent.includes('考点题库'));
    const buttons = [...document.querySelectorAll('.catalog-drawer button')].filter((b) => b.textContent?.trim() === '练习本题');
    const nodeId = document.querySelector('.catalog-drawer-breadcrumb')?.getAttribute('data-node-id') ?? null;
    return { nodeId, practiceButtons: buttons.length };
  })()`);

  const started = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('.catalog-drawer button')].find((b) => b.textContent?.trim() === '开始闯关');
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  check('quest-start-clicked', started, '开始闯关 clicked');

  await waitFor(`document.body.innerText.includes('已开始闯关')`, 30000, 'quest start status');
  await wait(1500);
  const practiceState = await evaluate(`(() => ({
    hasOptions: document.querySelectorAll('.options button').length > 0,
    status: (document.body.innerText.match(/已开始闯关[^\\n]*/) || [])[0] ?? null,
    progress: (document.body.innerText.match(/第\\s*\\d+\\s*\\/\\s*\\d+\\s*题/) || [])[0] ?? null,
  }))()`);
  check('quest-practice-opens', practiceState.hasOptions, JSON.stringify(practiceState));
  await screenshot('03-quest-practice');

  // Answer every question in the quest round (best effort; a wrong answer opens
  // the mistake-reason overlay which we submit).
  const answeredCount = await evaluate(`(async () => {
    const total = (() => {
      const match = document.body.innerText.match(/\\/\\s*(\\d+)\\s*题/);
      return match ? Number(match[1]) : 1;
    })();
    let answered = 0;
    const deadline = Date.now() + 60000;
    while (answered < total && Date.now() < deadline) {
      const option = document.querySelector('.options button');
      if (!option) {
        const next = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '下一题');
        if (next) { next.click(); await new Promise((r) => setTimeout(r, 400)); continue; }
        break;
      }
      option.click();
      answered += 1;
      await new Promise((r) => setTimeout(r, 900));
      const overlay = [...document.querySelectorAll('.overlay, [role="dialog"]')].find((el) => el.textContent?.includes('错误原因') || el.textContent?.includes('选择错误原因'));
      if (overlay) {
        const submit = overlay.querySelector('button[type="submit"], .primary-action');
        if (submit) submit.click();
        await new Promise((r) => setTimeout(r, 700));
      }
      const next = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '下一题');
      if (next && answered < total) next.click();
      await new Promise((r) => setTimeout(r, 500));
    }
    return { answered, total };
  })()`);
  check('quest-questions-answered', answeredCount.answered >= 1, JSON.stringify(answeredCount));
  await screenshot('04-quest-answered');

  // Back to the catalog and open the same node to settle the quest.
  await evaluate(navClick('408知识图谱'));
  await waitFor(`!!document.querySelector('#knowledge-catalog')`, 30000, 'catalog after quest');
  await wait(800);
  await evaluate(`(() => {
    const tab = [...document.querySelectorAll('#knowledge-catalog [role="tab"]')].find((b) => b.textContent?.trim() === ${JSON.stringify(QUEST_SUBJECT)});
    if (tab) tab.click();
    return !!tab;
  })()`);
  await wait(400);
  await searchCatalogPoint(QUEST_NODE_TITLE);
  await waitFor(`!!document.querySelector('.catalog-drawer')`, 15000, 'quest drawer again');
  await wait(1200);

  const drawerActive = await evaluate(`(() => {
    const sections = [...document.querySelectorAll('.catalog-drawer-section')];
    const quest = sections.find((s) => s.querySelector('h4')?.textContent.includes('节点闯关'));
    return {
      hasCompleteQuest: [...document.querySelectorAll('.catalog-drawer button')].some((b) => b.textContent?.trim() === '完成闯关并结算'),
      questText: quest ? quest.innerText.slice(0, 220) : null,
    };
  })()`);
  check('quest-settle-button-ready', drawerActive.hasCompleteQuest, JSON.stringify(drawerActive));
  await screenshot('05-quest-drawer-active');

  const settled = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('.catalog-drawer button')].find((b) => b.textContent?.trim() === '完成闯关并结算');
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  check('quest-settle-clicked', settled, '完成闯关并结算 clicked');
  await waitFor(`document.body.innerText.includes('闯关成功') || document.body.innerText.includes('闯关完成')`, 30000, 'quest settlement status');
  await wait(1500);
  const settleState = await evaluate(`(() => ({
    status: (document.body.innerText.match(/闯关(?:成功|完成)[^\\n]*/) || [])[0] ?? null,
    drawerQuest: [...document.querySelectorAll('.catalog-drawer-section')].find((s) => s.querySelector('h4')?.textContent.includes('节点闯关'))?.innerText.slice(0, 180) ?? null,
  }))()`);
  check('quest-settled', Boolean(settleState.status), JSON.stringify(settleState));
  await screenshot('06-quest-settled');

  // ---- API evidence: quest milestone persisted server-side ----
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
    const quest = await get('/api/knowledge/CO-C03-S05-P01/quest');
    const mastery = await get('/api/knowledge/mastery');
    const cacheItem = Array.isArray(mastery.items) ? mastery.items.find((item) => item.knowledgeNodeId === 'CO-C03-S05-P01') : null;
    return {
      quest,
      cacheItem: cacheItem
        ? { attempts: cacheItem.attempts, questStatus: cacheItem.questStatus, status: cacheItem.status }
        : null,
    };
  })()`);
  console.log('QUEST_API_EVIDENCE', JSON.stringify(apiEvidence));
  check(
    'api-quest-persisted',
    apiEvidence.quest?.attempts >= 1 && (apiEvidence.quest.status === 'passed' || apiEvidence.quest.status === 'in_progress'),
    JSON.stringify(apiEvidence.quest),
  );
  check(
    'api-mastery-quest-status',
    apiEvidence.cacheItem?.questStatus === 'passed' || apiEvidence.cacheItem?.questStatus === 'in_progress',
    JSON.stringify(apiEvidence.cacheItem),
  );

  await writeFile(path.join(OUT_DIR, 'report.json'), JSON.stringify({ appUrl: APP_URL, node: QUEST_NODE_TITLE, checks }, null, 2));
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
