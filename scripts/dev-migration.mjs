import { spawn } from 'node:child_process';

const root = process.cwd();
const node = process.execPath;
const children = [];

start('api', node, ['dist/main.js'], {
  cwd: `${root}/apps/api`,
  env: {
    ...process.env,
    PORT: process.env.PORT ?? '3000',
    WEB_ORIGIN: process.env.WEB_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173',
  },
});

start('web', node, ['../../node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173'], {
  cwd: `${root}/apps/web`,
  env: {
    ...process.env,
    VITE_API_BASE_URL: process.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:3000',
  },
});

console.log('\n408 migration dev servers are starting...');
console.log('Web: http://127.0.0.1:5173/');
console.log('API: http://127.0.0.1:3000/health');
console.log('Press Ctrl+C to stop both servers.\n');

function start(name, command, args, options) {
  const child = spawn(command, args, {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);

  child.stdout.on('data', (chunk) => {
    prefix(name, chunk);
  });
  child.stderr.on('data', (chunk) => {
    prefix(name, chunk);
  });
  child.on('exit', (code, signal) => {
    if (code !== 0 && signal !== 'SIGTERM') {
      console.error(`[${name}] exited with code ${code ?? signal}`);
      shutdown(code ?? 1);
    }
  });

  return child;
}

function prefix(name, chunk) {
  for (const line of chunk.toString().split(/\r?\n/).filter(Boolean)) {
    console.log(`[${name}] ${line}`);
  }
}

function shutdown(code = 0) {
  for (const child of children) {
    if (child.exitCode === null && !child.killed) {
      child.kill();
    }
  }
  process.exit(typeof code === 'number' ? code : 0);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
