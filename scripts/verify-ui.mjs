import { execFile, spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);
const chrome = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const appUrl = process.env.APP_URL ?? 'http://localhost:4173';
let serverProcess = null;

await mkdir('assets', { recursive: true });
await ensureAppIsRunning();

const baseArgs = ['--headless', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=1500'];

try {
  const dom = await run(chrome, [...baseArgs, '--dump-dom', appUrl], { maxBuffer: 5_000_000 });

  await run(chrome, [
    ...baseArgs,
    '--window-size=1440,1000',
    '--screenshot=assets/render-desktop.png',
    appUrl,
  ]);

  await run(chrome, [
    ...baseArgs,
    '--window-size=390,1000',
    '--screenshot=assets/render-mobile.png',
    appUrl,
  ]);

  const requiredText = [
    '学生工作台',
    '学习计划',
    '408知识图谱',
    '题库训练',
    '错题本',
    '提分报告',
    '教研后台',
    '管理看板',
  ];

  const missing = requiredText.filter((text) => !dom.stdout.includes(text));

  console.log(JSON.stringify({
    appUrl,
    renderedTextChecks: requiredText.length - missing.length,
    missing,
    desktopScreenshot: 'assets/render-desktop.png',
    mobileScreenshot: 'assets/render-mobile.png',
  }, null, 2));

  if (missing.length > 0) {
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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
