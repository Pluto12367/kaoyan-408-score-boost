/**
 * PHASE 7 — Forgetting Risk real PG + HTTP E2E.
 *
 * "会了但快忘了" over the canonical mastery SoT:
 *
 *   • node-stale : seeded canonical row, last reviewed 10d ago, schedule
 *                  overdue → overdue risk, retention = exp(-10/2) via the
 *                  SHARED formula
 *   • node-live  : driven through the REAL review path (wrong practice then a
 *                  successful redo report) → healthy, retention ≈ 1
 *   • node-weak  : mastery 0.3 → outside forgetting scope (diagnosis domain)
 *   • node-unknown: no review history → counted as insufficient data, never
 *                  claimed at-risk
 *   • student B  : no evidence → EMPTY ; anonymous → 401
 *
 * Prerequisite: docker compose -f compose.test.yml up -d --wait
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
const jwtSecret = 'integration-forgetting-risk-secret-0123456789';
process.env.DATABASE_URL = databaseUrl;

const runId = randomUUID().slice(0, 8);
const DAY = 86_400_000;
const password = 'Forgetting-Risk-Integration-Password-1';

const ids = {
  admin: `fr-admin-${runId}`,
  nodeStale: `fr-node-stale-${runId}`,
  nodeLive: `fr-node-live-${runId}`,
  nodeWeak: `fr-node-weak-${runId}`,
  nodeUnknown: `fr-node-unknown-${runId}`,
  pointLive: `fr-point-live-${runId}`,
};
let qLive;

const steps = [];
function record(step, detail) {
  steps.push(`${step}: ${detail}`);
  console.log(`  ✓ ${step} — ${detail}`);
}

let activeApi = null;
let prisma = null;

async function seedBeforeBoot() {
  const migrate = spawnSync(npx, ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
    cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8', shell: process.platform === 'win32',
  });
  assert.equal(migrate.status, 0, `migrate deploy failed: ${migrate.stderr || migrate.stdout}`);
  prisma = new PrismaClient({ datasourceUrl: databaseUrl });

  await prisma.user.upsert({
    where: { id: ids.admin },
    update: { passwordHash: await hashPassword(password), role: 'ADMIN', accountStatus: 'ACTIVE', trialStatus: 'ACTIVE' },
    create: {
      id: ids.admin, email: `${ids.admin}@integration.test`, name: 'Forgetting Admin', role: 'ADMIN',
      passwordHash: await hashPassword(password), trialStatus: 'ACTIVE', accountStatus: 'ACTIVE',
    },
  });

  for (const [nodeId, label] of [
    [ids.nodeStale, '陈旧节点'], [ids.nodeLive, '活跃节点'], [ids.nodeWeak, '弱节点'], [ids.nodeUnknown, '未知节点'],
  ]) {
    await prisma.knowledgeNode.create({
      data: { id: nodeId, subject: 'OPERATING_SYSTEM', nodeType: 'knowledge_point', name: `${label} ${runId}`, importance: 4, difficulty: 3, syllabusVersion: 'test' },
    });
  }
  await prisma.knowledgePoint.create({
    data: {
      id: ids.pointLive, subject: 'OPERATING_SYSTEM', chapter: 'P7', title: '遗忘防线考点',
      importance: 4, frequency: 4, prerequisites: [],
      nodeMaps: { create: { knowledgeNodeId: ids.nodeLive, mappingType: 'PRIMARY', confidence: 1 } },
    },
  });
  qLive = `fr-q-${runId}`;
  await prisma.questionFamily.create({ data: { id: `fr-fam-${qLive}` } });
  await prisma.question.create({
    data: {
      id: qLive, familyId: `fr-fam-${qLive}`, versionNumber: 1, contentFingerprint: `fp-${qLive}`,
      stem: 'P7 fixture', options: ['A', 'B', 'C', 'D'], answer: 'A', analysis: 'x',
      difficulty: 'MEDIUM', type: 'SINGLE_CHOICE', source: 'integration', expectedTimeSec: 60,
      questionSubtype: 'OS_PV', maxScore: 2,
    },
  });
  await prisma.questionKnowledgePoint.create({ data: { questionId: qLive, knowledgePointId: ids.pointLive } });
}

function startApi() {
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: `${root}/apps/api`,
    env: {
      ...process.env, PORT: '3270', WEB_ORIGIN: 'http://127.0.0.1:5173',
      DATABASE_URL: databaseUrl, JWT_SECRET: jwtSecret, ALLOW_DEMO_AUTH: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  child.getOutput = () => output;
  return child;
}

async function waitForHealth(child) {
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`API exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${apiUrl}/health`);
      if (response.ok) return;
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('API did not become healthy in time');
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`POST ${url} failed (${response.status}): ${text.slice(0, 300)}`);
  }
  return response.json();
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`GET ${url} failed (${response.status}): ${text.slice(0, 300)}`);
  }
  return response.json();
}

async function createStudent(tag) {
  const invite = randomBytes(18).toString('base64url');
  await prisma.invitationCode.create({
    data: {
      codeHash: createHmac('sha256', jwtSecret).update(invite.trim()).digest('hex'),
      codePrefix: invite.slice(0, 6), label: `p7 ${tag}`,
      maxUses: 5, startsAt: new Date(Date.now() - 60_000), expiresAt: new Date(Date.now() + DAY),
      createdById: ids.admin,
    },
  });
  const email = `fr-${tag}-${runId}@integration.test`;
  const registered = await postJson(`${apiUrl}/auth/register`, { email, password, name: `遗忘学生${tag}`, inviteCode: invite });
  const userId = registered?.user?.id ?? registered?.id;
  await prisma.user.update({ where: { id: userId }, data: { trialStatus: 'ACTIVE', accountStatus: 'ACTIVE' } });
  const token = (await postJson(`${apiUrl}/auth/login`, { email, password })).accessToken;
  return { userId, headers: { authorization: `Bearer ${token}` } };
}

async function verifyAfterBoot() {
  const student = await createStudent('a');
  const studentB = await createStudent('b');

  // Canonical mastery fixtures (the same rows the writer maintains).
  const now = Date.now();
  await prisma.userKnowledgeMastery.create({
    data: {
      userId: student.userId, knowledgeNodeId: ids.nodeStale, mastery: 0.8, accuracy: 0.8, recentAccuracy: 0.8,
      attempts: 5, correctCount: 4, wrongCount: 1, stabilityDays: 2,
      lastReviewedAt: new Date(now - 10 * DAY), nextReviewAt: new Date(now - 5 * DAY),
    },
  });
  await prisma.userKnowledgeMastery.create({
    data: {
      userId: student.userId, knowledgeNodeId: ids.nodeWeak, mastery: 0.3, accuracy: 0.3, recentAccuracy: 0.3,
      attempts: 4, correctCount: 1, wrongCount: 3,
    },
  });
  await prisma.userKnowledgeMastery.create({
    data: {
      userId: student.userId, knowledgeNodeId: ids.nodeUnknown, mastery: 0.6, accuracy: 0.6, recentAccuracy: 0.6,
      attempts: 3, correctCount: 2, wrongCount: 1,
    },
  });
  record('seed', 'stale (10d, overdue) / weak (0.3) / unknown-history (0.6, no review) mastery rows');

  // node-live through the REAL path: wrong practice → successful redo report.
  await postJson(`${apiUrl}/practice-records`, {
    questionId: qLive, knowledgePointId: ids.pointLive, selectedAnswer: 'X', timeSpentSec: 60,
  }, { ...student.headers, 'idempotency-key': `fr-practice-${runId}` });
  await postJson(`${apiUrl}/wrong-questions/${qLive}/reason`, {
    controlledReason: 'method_error', redoCorrect: true, timeSpentSec: 30,
    isReview: true, idempotencyKey: `fr-review-${runId}`,
  }, student.headers);
  const liveRow = await prisma.userKnowledgeMastery.findUnique({
    where: { userId_knowledgeNodeId: { userId: student.userId, knowledgeNodeId: ids.nodeLive } },
    select: { retention: true, stabilityDays: true, lastReviewedAt: true },
  });
  assert.ok(liveRow?.lastReviewedAt, 'the real review path stamped lastReviewedAt');
  record('review-path', 'node-live reviewed through the real redo path (applyReview wrote the canonical state)');

  const result = await getJson(`${apiUrl}/coach/forgetting-risk`, student.headers);
  assert.equal(result.storeAvailable, true);
  assert.equal(result.dataStatus, 'OK');

  const byNode = (nodeId) => result.rows.find((row) => row.nodeId === nodeId);
  assert.equal(byNode(ids.nodeWeak), undefined, 'weak node is outside forgetting scope');

  const stale = byNode(ids.nodeStale);
  assert.ok(stale, 'stale node is in scope');
  assert.equal(stale.risk, 'overdue', 'schedule overdue outranks decay');
  assert.ok(Math.abs(stale.retention - Math.exp(-5)) < 1e-6, `retention=${stale.retention} (shared formula)`);
  assert.equal(stale.learnedStage, 'mastered');

  const live = byNode(ids.nodeLive);
  assert.ok(live, 'live node is in scope after the real review');
  assert.equal(live.risk, 'healthy');
  assert.ok(live.retention > 0.9, `retention≈1, got ${live.retention}`);
  assert.equal(live.learnedStage, 'review');

  const unknown = byNode(ids.nodeUnknown);
  assert.ok(unknown, 'unknown-history node is in scope');
  assert.equal(unknown.retention, null, 'no fabricated retention');
  assert.equal(unknown.risk, 'healthy', 'unknown decay is not a risk claim');

  assert.equal(result.summary.learnedNodes, 3);
  assert.equal(result.summary.overdueCount, 1);
  assert.equal(result.summary.atRiskCount, 1);
  assert.equal(result.summary.insufficientDataCount, 1);
  assert.equal(result.rows[0].nodeId, ids.nodeStale, 'overdue ranks first');
  record('projection', `overdue first; 3 in scope (weak excluded); insufficientData=${result.summary.insufficientDataCount}`);

  const emptyB = await getJson(`${apiUrl}/coach/forgetting-risk`, studentB.headers);
  assert.equal(emptyB.dataStatus, 'EMPTY');
  assert.deepEqual(emptyB.rows, []);
  record('empty', 'evidence-free student → EMPTY (no fabrication)');

  const anon = await fetch(`${apiUrl}/coach/forgetting-risk`);
  assert.equal(anon.status, 401);
  record('guards', 'unauthenticated read → 401');
}

(async () => {
  activeApi = null;
  try {
    const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:api'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
    assert.equal(build.status, 0, `build:api failed: ${(build.stderr || build.stdout).slice(-500)}`);
    await seedBeforeBoot();
    activeApi = startApi();
    await waitForHealth(activeApi);
    await verifyAfterBoot();
    console.log(`\nPHASE 7 Forgetting Risk integration PASSED (${steps.length} steps)`);
    process.exit(0);
  } catch (error) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    console.error('\nPHASE 7 Forgetting Risk integration FAILED:', error?.message ?? error);
    if (activeApi?.getOutput) console.error(activeApi.getOutput().slice(-8000));
    process.exit(1);
  } finally {
    try {
      if (prisma && !process.env.KEEP_FIXTURES) {
        await prisma.user.deleteMany({ where: { email: { endsWith: `${runId}@integration.test` } } }).catch(() => {});
        await prisma.user.deleteMany({ where: { id: ids.admin } }).catch(() => {});
        await prisma.question.deleteMany({ where: { id: qLive } }).catch(() => {});
        await prisma.knowledgePoint.deleteMany({ where: { id: ids.pointLive } }).catch(() => {});
        await prisma.knowledgeNode.deleteMany({ where: { id: { in: [ids.nodeStale, ids.nodeLive, ids.nodeWeak, ids.nodeUnknown] } } }).catch(() => {});
        await prisma.questionFamily.deleteMany({ where: { id: { startsWith: 'fr-fam-' } } }).catch(() => {});
        await prisma.$disconnect();
      }
      if (activeApi) { await new Promise((r) => setTimeout(r, 800)); activeApi.kill(); }
    } catch {
      // cleanup is best-effort
    }
  }
})();
