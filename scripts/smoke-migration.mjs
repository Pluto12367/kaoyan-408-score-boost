import { spawn } from 'node:child_process';
import { once } from 'node:events';

const root = process.cwd();
const apiUrl = 'http://127.0.0.1:3100';
const webUrl = 'http://127.0.0.1:5174';
const processes = [];

async function main() {
  const api = start('api', process.execPath, ['dist/main.js'], {
    cwd: `${root}/apps/api`,
    env: {
      ...process.env,
      PORT: '3100',
      WEB_ORIGIN: webUrl,
      DATABASE_URL: '',
    },
  });

  await waitForJson(`${apiUrl}/health`, (data) => data.status === 'ok');
  const overview = await waitForJson(`${apiUrl}/dashboard/overview`, (data) => data.source === 'memory-api');
  assert(overview.report?.weakPoints?.length > 0, 'dashboard overview should include weak points');
  assert(overview.plan?.dailyTasks?.length > 0, 'dashboard overview should include daily tasks');

  const web = start('web', process.execPath, ['../../node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5174', '--strictPort'], {
    cwd: `${root}/apps/web`,
    env: {
      ...process.env,
      VITE_API_BASE_URL: apiUrl,
    },
  });

  const html = await waitForText(webUrl, (text) => text.includes('<div id="root">'));
  assert(html.includes('/src/main.tsx'), 'web entry should point at the React app');

  console.log(JSON.stringify({
    ok: true,
    api: `${apiUrl}/dashboard/overview`,
    web: webUrl,
    weakPoint: overview.report.weakPoints[0].title,
    processIds: {
      api: api.pid,
      web: web.pid,
    },
  }, null, 2));
}

function start(name, command, args, options) {
  const child = spawn(command, args, {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  processes.push(child);

  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.once('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[${name}] exited with code ${code}`);
      console.error(output.trim());
    }
  });

  return child;
}

async function waitForJson(url, predicate) {
  const response = await waitForResponse(url, async (res) => {
    if (!res.ok) return null;
    const data = await res.json();
    return predicate(data) ? data : null;
  });
  return response;
}

async function waitForText(url, predicate) {
  return waitForResponse(url, async (res) => {
    if (!res.ok) return null;
    const text = await res.text();
    return predicate(text) ? text : null;
  });
}

async function waitForResponse(url, mapper) {
  const deadline = Date.now() + 30_000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const result = await mapper(await fetch(url));
      if (result) return result;
    } catch (error) {
      lastError = error;
    }

    await delay(500);
  }

  throw new Error(`Timed out waiting for ${url}: ${lastError?.message ?? 'no matching response'}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cleanup() {
  await Promise.all(processes.map(async (child) => {
    if (child.exitCode !== null || child.killed) return;
    child.kill();
    await Promise.race([once(child, 'exit'), delay(1500)]);
    if (child.exitCode === null && !child.killed) {
      child.kill('SIGKILL');
    }
  }));
}

process.on('SIGINT', () => {
  void cleanup().then(() => process.exit(130));
});

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => cleanup());
