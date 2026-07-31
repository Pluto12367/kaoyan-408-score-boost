import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const composeFile = join(root, 'compose.production.yml');
const projectName = `smoke-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const startedAt = Date.now();
const requestIds = [];
const temporaryRoot = await mkdtemp(join(tmpdir(), `${projectName}-`));
const backupDirectory = join(temporaryRoot, 'backups');
const envFile = join(temporaryRoot, '.env.production');
const overrideFile = join(temporaryRoot, 'compose.smoke.yml');
const adminEmail = `admin-${randomUUID()}@example.invalid`;
const studentEmail = `student-${randomUUID()}@example.invalid`;
const adminPassword = secret(24);
const studentPassword = secret(24);
let composeStarted = false;
let status = 'PASS';

const composePrefix = [
  'compose',
  '--env-file', envFile,
  '-f', composeFile,
  '-f', overrideFile,
  '-p', projectName,
];

try {
  await mkdir(backupDirectory, { mode: 0o777 });
  await writeFile(envFile, [
    'POSTGRES_USER=smoke_user',
    `POSTGRES_PASSWORD=${secret(24)}`,
    'POSTGRES_DB=smoke_db',
    `JWT_SECRET=${secret(48)}`,
    'PUBLIC_IP=1.1.1.1',
    'WEB_ORIGIN=http://1.1.1.1',
    'ALLOW_INSECURE_HTTP_IP=true',
    'BACKUP_RETENTION_DAYS=1',
    '',
  ].join('\n'), { mode: 0o600 });
  await writeFile(overrideFile, [
    'services:',
    '  backup:',
    '    volumes:',
    `      - "${composePath(join(root, 'deploy/tencent-ip/backup.sh'))}:/usr/local/bin/backup.sh:ro"`,
    `      - "${composePath(backupDirectory)}:/backups"`,
    '',
  ].join('\n'), { mode: 0o600 });

  await docker([...composePrefix, 'config'], 'compose-config');
  composeStarted = true;
  await docker([...composePrefix, 'up', '-d', '--build', '--wait'], 'compose-up', 8 * 60_000);

  await waitForHealth();
  const homepage = await request('http://127.0.0.1/');
  ensure(homepage.status === 200, 'homepage');

  const rejected = await request('http://127.0.0.1/api/auth/register', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      email: studentEmail,
      password: studentPassword,
      name: 'Production Smoke Student',
    }),
  });
  ensure(rejected.status === 400, 'missing-invitation');

  await provisionAdmin();
  const adminSession = await postJson('/api/auth/login', {
    email: adminEmail,
    password: adminPassword,
  }, 'admin-login');
  assertSession(adminSession, 'admin');

  const invitation = await postJson('/api/admin/invitations', {
    label: 'Production Compose Smoke',
    maxUses: 1,
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  }, 'invitation-create', authHeaders(adminSession.accessToken));
  ensure(typeof invitation.code === 'string' && invitation.code.length >= 6, 'invitation-create');

  const registration = await postJson('/api/auth/register', {
    inviteCode: invitation.code,
    email: studentEmail,
    password: studentPassword,
    name: 'Production Smoke Student',
  }, 'student-register');
  assertSession(registration, 'student');

  const refreshed = await postJson('/api/auth/refresh', {
    refreshToken: registration.refreshToken,
  }, 'session-refresh');
  assertSession(refreshed, 'student');
  await postJson('/api/auth/logout', {
    refreshToken: refreshed.refreshToken,
  }, 'session-logout');
  const relogin = await postJson('/api/auth/login', {
    email: studentEmail,
    password: studentPassword,
  }, 'student-relogin');
  assertSession(relogin, 'student');

  await docker([...composePrefix, 'restart', 'postgres', 'app', 'gateway'], 'compose-restart');
  await waitForHealth();
  const persisted = await postJson('/api/auth/login', {
    email: studentEmail,
    password: studentPassword,
  }, 'persistence-login');
  assertSession(persisted, 'student');

  await docker([...composePrefix, '--profile', 'tools', 'run', '--rm', 'backup'], 'backup');
  const backupName = (await readdir(backupDirectory)).find((name) => name.endsWith('.dump'));
  ensure(Boolean(backupName), 'backup');
  await verifyRestore(join(backupDirectory, backupName));

} catch {
  status = 'FAIL';
} finally {
  try {
    if (composeStarted) {
      await docker(
        [...composePrefix, 'down', '--volumes', '--remove-orphans'],
        'cleanup',
        2 * 60_000,
      );
    }
  } catch {
    status = 'FAIL';
  }
  try {
    await rm(temporaryRoot, { recursive: true, force: true });
  } catch {
    status = 'FAIL';
  }
  printSummary(status);
  if (status === 'FAIL') process.exitCode = 1;
}

async function provisionAdmin() {
  const source = [
    "const { PrismaClient } = require('@prisma/client');",
    "const { hashPassword } = require('./apps/api/dist/auth/password.js');",
    'const prisma = new PrismaClient();',
    '(async () => {',
    '  const passwordHash = await hashPassword(process.env.SMOKE_ADMIN_PASSWORD);',
    '  await prisma.user.upsert({',
    '    where: { email: process.env.SMOKE_ADMIN_EMAIL },',
    '    create: { email: process.env.SMOKE_ADMIN_EMAIL, name: "Smoke Admin", passwordHash, role: "ADMIN", trialStatus: "ACTIVE", accountStatus: "ACTIVE", mustChangePassword: false },',
    '    update: { passwordHash, role: "ADMIN", trialStatus: "ACTIVE", accountStatus: "ACTIVE", mustChangePassword: false },',
    '  });',
    '})().finally(() => prisma.$disconnect());',
  ].join('\n');
  await docker(
    [...composePrefix, 'exec', '-T', '-e', 'SMOKE_ADMIN_EMAIL', '-e', 'SMOKE_ADMIN_PASSWORD', 'app', 'node', '-e', source],
    'admin-provision',
    60_000,
    false,
    { SMOKE_ADMIN_EMAIL: adminEmail, SMOKE_ADMIN_PASSWORD: adminPassword },
  );
}

async function verifyRestore(backupPath) {
  await docker([
    'run', '--rm',
    '-v', '/var/run/docker.sock:/var/run/docker.sock',
    '-v', `${root}:/workspace:ro`,
    '-v', `${dirname(backupPath)}:/smoke-backups:ro`,
    'docker:cli',
    'sh', '/workspace/deploy/tencent-ip/verify-restore.sh',
    `/smoke-backups/${backupPath.split(/[\\/]/).at(-1)}`,
  ], 'restore-verify', 3 * 60_000);
}

async function waitForHealth() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const response = await request('http://127.0.0.1/health', {}, false);
      if (response.ok) {
        const health = await response.json();
        if (health.status === 'ok' && health.checks?.database === 'connected') return;
      }
    } catch {
      // The bounded retry loop handles startup races without exposing response data.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
  }
  throw new Error('health');
}

async function postJson(path, body, stage, headers = jsonHeaders()) {
  const response = await request(`http://127.0.0.1${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  ensure(response.ok, stage);
  try {
    return await response.json();
  } catch {
    throw new Error(stage);
  }
}

async function request(url, init = {}, recordRequestId = true) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  const requestId = response.headers.get('x-request-id');
  if (recordRequestId && requestId) requestIds.push(requestId);
  return response;
}

function docker(args, stage, timeoutMs = 2 * 60_000, ignoreFailure = false, extraEnv = {}) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn('docker', args, {
      cwd: root,
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: AbortSignal.timeout(timeoutMs),
      windowsHide: true,
    });
    let outputBytes = 0;
    child.stdout.on('data', (chunk) => { outputBytes += chunk.length; });
    child.stderr.on('data', (chunk) => { outputBytes += chunk.length; });
    child.on('error', () => {
      if (ignoreFailure) resolveCommand();
      else rejectCommand(new Error(stage));
    });
    child.on('close', (code) => {
      if (code === 0 || ignoreFailure) resolveCommand();
      else rejectCommand(new Error(`${stage}-${code}-${outputBytes > 0 ? 'output' : 'silent'}`));
    });
  });
}

function assertSession(session, role) {
  ensure(Boolean(session?.accessToken), 'session');
  ensure(Boolean(session?.refreshToken), 'session');
  ensure(session?.user?.role === role, 'session');
}

function authHeaders(token) {
  return jsonHeaders({ Authorization: `Bearer ${token}` });
}

function jsonHeaders(extra = {}) {
  return { 'content-type': 'application/json; charset=utf-8', ...extra };
}

function ensure(condition, stage) {
  if (!condition) throw new Error(stage);
}

function secret(bytes) {
  return randomBytes(bytes).toString('base64url');
}

function composePath(path) {
  return path.replaceAll('\\', '/').replaceAll('"', '\\"');
}

function printSummary(status) {
  const summary = {
    status,
    elapsedMs: Date.now() - startedAt,
    requestIds: [...new Set(requestIds)],
  };
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}
