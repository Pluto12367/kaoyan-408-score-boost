/**
 * DIAGNOSTIC PROBE — daily plan state for a clean account.
 *
 * Boots the real API on the test DB, registers one clean student, completes
 * onboarding, then dumps the persisted plan/task/date state next to the
 * endpoint's answer. Used to disambiguate "the system produced nothing" from
 * "the client read the wrong field" (the 2026-09-18 investigation: the
 * endpoint's field is `priorityTasks`; the plan was complete all along).
 * Changes no product code; cleans up after itself.
 */

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

const require = createRequire(import.meta.url);
const { hashPassword } = require('../apps/api/dist/auth/password.js');

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const root = process.cwd();
const apiUrl = 'http://127.0.0.1:3270';
const databaseUrl = process.env.TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:55432/kaoyan408_test?schema=public';
const jwtSecret = 'diagnostic-probe-secret-0123456789';
process.env.DATABASE_URL = databaseUrl;

const runId = randomUUID().slice(0, 8);
const password = 'Diagnostic-Probe-Password-1';
const ids = { admin: `probe-admin-${runId}`, point: `probe-point-${runId}` };

let activeApi = null;
let prisma = null;

function studyDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

async function seed() {
  spawnSync(npx, ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
    cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8', shell: process.platform === 'win32',
  });
  prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  await prisma.user.upsert({
    where: { id: ids.admin },
    update: { passwordHash: await hashPassword(password), role: 'ADMIN', accountStatus: 'ACTIVE', trialStatus: 'ACTIVE' },
    create: {
      id: ids.admin, email: `${ids.admin}@integration.test`, name: 'Probe Admin', role: 'ADMIN',
      passwordHash: await hashPassword(password), trialStatus: 'ACTIVE', accountStatus: 'ACTIVE',
    },
  });
  // A minimal content base so dailyTasks has something to work with.
  await prisma.knowledgePoint.create({
    data: { id: ids.point, subject: 'OPERATING_SYSTEM', chapter: 'PROBE', title: '探针考点', importance: 4, frequency: 4, prerequisites: [] },
  });
}

function startApi() {
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: `${root}/apps/api`,
    env: { ...process.env, PORT: '3270', WEB_ORIGIN: 'http://127.0.0.1:5173', DATABASE_URL: databaseUrl, JWT_SECRET: jwtSecret, ALLOW_DEMO_AUTH: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (c) => { output += c.toString(); });
  child.stderr.on('data', (c) => { output += c.toString(); });
  child.getOutput = () => output;
  return child;
}

async function waitForHealth(child) {
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`API exited with ${child.exitCode}`);
    try { const r = await fetch(`${apiUrl}/health`); if (r.ok) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('API did not become healthy');
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`POST ${url} → ${response.status}: ${(await response.text().catch(() => '')).slice(0, 200)}`);
  return response.json();
}
async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`GET ${url} → ${response.status}: ${(await response.text().catch(() => '')).slice(0, 200)}`);
  return response.json();
}

(async () => {
  try {
    assert.equal(spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:api'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' }).status, 0);
    await seed();
    activeApi = startApi();
    await waitForHealth(activeApi);

    const invite = randomBytes(18).toString('base64url');
    await prisma.invitationCode.create({
      data: {
        codeHash: createHmac('sha256', jwtSecret).update(invite.trim()).digest('hex'),
        codePrefix: invite.slice(0, 6), label: 'probe', maxUses: 2,
        startsAt: new Date(Date.now() - 60_000), expiresAt: new Date(Date.now() + 86_400_000), createdById: ids.admin,
      },
    });
    const email = `probe-student-${runId}@integration.test`;
    const registered = await postJson(`${apiUrl}/auth/register`, { email, password, name: '探针学生', inviteCode: invite });
    const student = registered?.user?.id ?? registered?.id;
    await prisma.user.update({ where: { id: student }, data: { trialStatus: 'ACTIVE', accountStatus: 'ACTIVE' } });
    const headers = { authorization: `Bearer ${(await postJson(`${apiUrl}/auth/login`, { email, password })).accessToken}` };

    const onboarding = await postJson(`${apiUrl}/onboarding/complete`, {
      examYear: 2027, targetScore: 110, currentScore: 60, remainingDays: 120, dailyHours: 3, weakestSubject: '操作系统',
    }, headers);

    console.log('\n=== PROBE RESULTS ===');
    console.log('todayKey(Asia/Shanghai) =', studyDateKey(), '| now =', new Date().toISOString());
    console.log('onboarding.sevenDayPlan.days (returned):');
    for (const day of onboarding?.sevenDayPlan?.days ?? []) {
      console.log(`   ${day.date}  taskCount=${day.taskCount}  focus=${String(day.focusTitle).slice(0, 24)}`);
    }

    const todayPlan = await getJson(`${apiUrl}/today/plan`, headers);
    console.log('GET /today/plan → top-level keys:', Object.keys(todayPlan ?? {}).join(','));
    console.log('GET /today/plan → raw (first 700 chars):', JSON.stringify(todayPlan).slice(0, 700));

    const plans = await prisma.studyPlan.findMany({ where: { userId: student }, include: { tasks: true }, orderBy: { createdAt: 'desc' } });
    console.log('DB plans:', plans.length);
    for (const plan of plans) {
      console.log(`   plan ${plan.id} status=${plan.status} created=${plan.createdAt.toISOString()} tasks=${plan.tasks.length}`);
      const byDate = new Map();
      for (const task of plan.tasks) byDate.set(task.scheduledDate, (byDate.get(task.scheduledDate) ?? 0) + 1);
      console.log('     tasks by scheduledDate:', [...byDate.entries()].sort().map(([d, n]) => `${d}×${n}`).join('  '));
    }
    const studentRow = await prisma.user.findUnique({ where: { id: student }, select: { onboardingCompletedAt: true } });
    console.log('onboardingCompletedAt:', studentRow?.onboardingCompletedAt?.toISOString() ?? null);
    console.log('=== END PROBE ===\n');
  } catch (error) {
    console.error('PROBE FAILED:', error?.message ?? error);
    if (activeApi?.getOutput) console.error(activeApi.getOutput().slice(-4000));
  } finally {
    try {
      if (prisma) {
        await prisma.invitationRedemption.deleteMany({ where: { user: { email: { endsWith: `${runId}@integration.test` } } } }).catch(() => {});
        await prisma.invitationRedemption.deleteMany({ where: { user: { id: ids.admin } } }).catch(() => {});
        await prisma.invitationCode.deleteMany({ where: { createdBy: { id: ids.admin } } }).catch(() => {});
        await prisma.user.deleteMany({ where: { email: { endsWith: `${runId}@integration.test` } } }).catch(() => {});
        await prisma.user.deleteMany({ where: { id: ids.admin } }).catch(() => {});
        await prisma.knowledgePoint.deleteMany({ where: { id: ids.point } }).catch(() => {});
        await prisma.$disconnect();
      }
      if (activeApi) { await new Promise((r) => setTimeout(r, 500)); activeApi.kill(); }
    } catch { /* best effort */ }
    process.exit(0);
  }
})();
