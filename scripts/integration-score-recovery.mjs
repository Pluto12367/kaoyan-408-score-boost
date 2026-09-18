/**
 * PHASE 9 — Score Recovery real PG + HTTP E2E.
 *
 * Chain: paper submission (real ScoreLoss derivation) → later re-attempts
 * (real single-question practice) → GET /coach/score-recovery.
 *
 * Fixture outcomes (all through real endpoints):
 *   qA priced wrong  → later correct practice   → recovered (2 OBSERVED recovered)
 *   qB priced wrong  → no re-attempt            → awaiting_reattempt
 *   qE priced wrong  → later wrong practice     → not_recovered (relapse)
 *   qD unpriced wrong→ counted, never priced (NULL ≠ 0)
 *   qC priced correct → no loss row at all
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
const jwtSecret = 'integration-score-recovery-secret-0123456789';
process.env.DATABASE_URL = databaseUrl;

const runId = randomUUID().slice(0, 8);
const DAY = 86_400_000;
const password = 'Score-Recovery-Integration-Password-1';

const ids = {
  admin: `sr-admin-${runId}`,
  node: `sr-node-${runId}`,
  point: `sr-point-${runId}`,
  paper: `sr-paper-${runId}`,
};
let qA; let qB; let qC; let qD; let qE;

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
      id: ids.admin, email: `${ids.admin}@integration.test`, name: 'Recovery Admin', role: 'ADMIN',
      passwordHash: await hashPassword(password), trialStatus: 'ACTIVE', accountStatus: 'ACTIVE',
    },
  });
  await prisma.knowledgeNode.create({
    data: { id: ids.node, subject: 'OPERATING_SYSTEM', nodeType: 'knowledge_point', name: `恢复节点 ${runId}`, importance: 4, difficulty: 3, syllabusVersion: 'test' },
  });
  await prisma.knowledgePoint.create({
    data: {
      id: ids.point, subject: 'OPERATING_SYSTEM', chapter: 'P9', title: '恢复考点',
      importance: 4, frequency: 4, prerequisites: [],
      nodeMaps: { create: { knowledgeNodeId: ids.node, mappingType: 'PRIMARY', confidence: 1 } },
    },
  });

  qA = `sr-q-a-${runId}`; qB = `sr-q-b-${runId}`; qC = `sr-q-c-${runId}`;
  qD = `sr-q-d-${runId}`; qE = `sr-q-e-${runId}`;
  const question = (id, overrides = {}) => ({
    id, familyId: `sr-fam-${id}`, versionNumber: 1, contentFingerprint: `fp-${id}`,
    stem: `P9 fixture ${id}`, options: ['A', 'B', 'C', 'D'], answer: 'A', analysis: 'x',
    difficulty: 'MEDIUM', type: 'SINGLE_CHOICE', source: 'integration', expectedTimeSec: 60,
    questionSubtype: 'OS_PV', maxScore: 2, ...overrides,
  });
  for (const [id, overrides] of [[qA, {}], [qB, {}], [qC, {}], [qD, { maxScore: null }], [qE, {}]]) {
    await prisma.questionFamily.create({ data: { id: `sr-fam-${id}` } });
    await prisma.question.create({ data: question(id, overrides) });
    await prisma.questionKnowledgePoint.create({ data: { questionId: id, knowledgePointId: ids.point } });
  }
  await prisma.paper.create({
    data: {
      id: ids.paper, title: 'P9 恢复卷', paperType: '模拟卷', questionCount: 5,
      knowledgePointIds: [ids.point],
      questions: [qA, qB, qC, qD, qE].map((id, index) => ({
        id, stem: `P9 fixture ${id}`, type: '单选题', options: ['A', 'B', 'C', 'D'],
        answer: index === 3 ? 'B' : 'A', analysis: 'x',
      })),
      estimatedMinutes: 15, createdBy: ids.admin,
    },
  });
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
    try { const r = await fetch(`${apiUrl}/health`); if (r.ok) return; } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('API did not become healthy in time');
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

let studentId = null;
let studentHeaders = {};

async function practice(questionId, selectedAnswer) {
  return postJson(`${apiUrl}/practice-records`, {
    questionId, knowledgePointId: ids.point, selectedAnswer, timeSpentSec: 60,
  }, { ...studentHeaders, 'idempotency-key': `sr-${runId}-${questionId}-${randomUUID().slice(0, 8)}` });
}

async function runJourney() {
  const invite = randomBytes(18).toString('base64url');
  await prisma.invitationCode.create({
    data: {
      codeHash: createHmac('sha256', jwtSecret).update(invite.trim()).digest('hex'),
      codePrefix: invite.slice(0, 6), label: 'p9 recovery', maxUses: 5,
      startsAt: new Date(Date.now() - 60_000), expiresAt: new Date(Date.now() + DAY), createdById: ids.admin,
    },
  });
  const email = `sr-student-${runId}@integration.test`;
  const registered = await postJson(`${apiUrl}/auth/register`, { email, password, name: '恢复学生', inviteCode: invite });
  studentId = registered?.user?.id ?? registered?.id;
  await prisma.user.update({ where: { id: studentId }, data: { trialStatus: 'ACTIVE', accountStatus: 'ACTIVE' } });
  studentHeaders = { authorization: `Bearer ${(await postJson(`${apiUrl}/auth/login`, { email, password })).accessToken}` };
  record('seed', `student=${studentId}; bank = qA/qB/qC/qE priced(2) + qD unpriced, one paper`);

  // Real loss derivation: paper with qA/qB/qD/qE wrong, qC correct.
  const submission = await postJson(`${apiUrl}/papers/${ids.paper}/submit`, {
    answers: [
      { questionId: qA, selectedAnswer: 'X', timeSpentSec: 30 },
      { questionId: qB, selectedAnswer: 'X', timeSpentSec: 30 },
      { questionId: qC, selectedAnswer: 'A', timeSpentSec: 30 },
      { questionId: qD, selectedAnswer: 'X', timeSpentSec: 30 },
      { questionId: qE, selectedAnswer: 'X', timeSpentSec: 30 },
    ],
  }, studentHeaders);
  assert.equal(submission.syncedPracticeRecordCount, 5);
  const lossRows = await prisma.scoreLossItem.findMany({ where: { userId: studentId } });
  assert.equal(lossRows.length, 4, `four loss rows (qC correct has none), got ${lossRows.length}`);
  assert.ok(lossRows.filter((row) => row.lostScore != null).length === 3, 'three priced losses');
  record('loss', 'paper → 4 loss rows: 3 priced (2 each) + 1 unpriced');

  // Re-attempts after the loss: qA correct (recovered), qE wrong (relapse).
  await practice(qA, 'A');
  await practice(qE, 'X');
  record('reattempt', 'qA answered correctly again (recovered evidence), qE answered wrong again (relapse)');

  const recovery = await getJson(`${apiUrl}/coach/score-recovery?days=30`, studentHeaders);
  assert.equal(recovery.storeAvailable, true);
  assert.equal(recovery.dataStatus, 'OK');
  assert.equal(recovery.summary.questions, 4, 'four questions carry loss evidence');
  assert.equal(recovery.summary.observedLostScore, 6, 'three priced losses of 2');
  assert.equal(recovery.summary.observedLossWithReattemptSuccess, 2, 'only the recovered question counts');
  assert.equal(recovery.summary.observedLossOutstanding, 4, 'awaiting + relapse remain outstanding');
  assert.equal(recovery.summary.recoveredQuestions, 1);
  assert.equal(recovery.summary.notRecoveredQuestions, 1);
  assert.equal(recovery.summary.unpricedQuestions, 1);

  const row = (questionId) => recovery.rows.find((item) => item.questionId === questionId);
  assert.equal(row(qA).status, 'recovered');
  assert.equal(row(qA).latestReattemptCorrect, true);
  assert.equal(row(qA).reattemptSources.join(','), 'practice');
  assert.equal(row(qA).observedLossWithReattemptSuccess, 2);
  assert.equal(row(qB).status, 'awaiting_reattempt');
  assert.equal(row(qB).reattemptCount, 0);
  assert.equal(row(qE).status, 'not_recovered');
  assert.equal(row(qE).latestReattemptCorrect, false);
  assert.equal(row(qE).observedLossOutstanding, 2);
  assert.equal(row(qD).priced, false, 'unpriced loss counted, never priced');
  assert.equal(row(qD).observedLostScore, 0);
  // qB and qE tie on outstanding (2): deterministic tie-break by questionId.
  assert.equal(recovery.rows[0].questionId, qB, 'outstanding-first ordering; tie broken by questionId');
  assert.deepEqual(recovery.rows.map((item) => item.priorityRank), recovery.rows.map((_, index) => index + 1));
  const nodeRow = recovery.nodes.find((item) => item.nodeId === ids.node);
  assert.ok(nodeRow && nodeRow.questions === 4, 'node rollup aggregates all four questions');
  assert.equal(nodeRow.observedLossWithReattemptSuccess, 2);
  assert.equal(nodeRow.observedLossOutstanding, 4);
  record('recovery', `recovered=1/awaiting=1/relapse=1/unpriced=1; recovered 2pts, outstanding 4pts (OBSERVED only)`);

  // Determinism + honest absence.
  const second = await getJson(`${apiUrl}/coach/score-recovery?days=30`, studentHeaders);
  assert.deepEqual(second.rows, recovery.rows, 'projection is deterministic');
  // Honest absence: a second account with no evidence gets EMPTY, not zeros.
  const inviteB = randomBytes(18).toString('base64url');
  await prisma.invitationCode.create({
    data: {
      codeHash: createHmac('sha256', jwtSecret).update(inviteB.trim()).digest('hex'),
      codePrefix: inviteB.slice(0, 6), label: 'p9 recovery b', maxUses: 2,
      startsAt: new Date(Date.now() - 60_000), expiresAt: new Date(Date.now() + DAY), createdById: ids.admin,
    },
  });
  const emailB = `sr-studentb-${runId}@integration.test`;
  const registeredB = await postJson(`${apiUrl}/auth/register`, { email: emailB, password, name: '恢复学生B', inviteCode: inviteB });
  const studentB = registeredB?.user?.id ?? registeredB?.id;
  await prisma.user.update({ where: { id: studentB }, data: { trialStatus: 'ACTIVE', accountStatus: 'ACTIVE' } });
  const headersB = { authorization: `Bearer ${(await postJson(`${apiUrl}/auth/login`, { email: emailB, password })).accessToken}` };
  const emptyB = await getJson(`${apiUrl}/coach/score-recovery?days=30`, headersB);
  assert.equal(emptyB.dataStatus, 'EMPTY', 'evidence-free account yields EMPTY, not fabricated zeros');
  assert.deepEqual(emptyB.rows, []);

  const anon = await fetch(`${apiUrl}/coach/score-recovery`);
  assert.equal(anon.status, 401);
  record('guards', 'determinism + evidence-free EMPTY + 401 verified');
}

async function runCleanup() {
  try {
    if (prisma && !process.env.KEEP_FIXTURES) {
      await prisma.invitationRedemption.deleteMany({ where: { user: { email: { endsWith: `${runId}@integration.test` } } } }).catch(() => {});
      await prisma.invitationRedemption.deleteMany({ where: { user: { id: ids.admin } } }).catch(() => {});
      await prisma.invitationCode.deleteMany({ where: { createdBy: { id: ids.admin } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { email: { endsWith: `${runId}@integration.test` } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: ids.admin } }).catch(() => {});
      await prisma.question.deleteMany({ where: { id: { contains: runId } } }).catch(() => {});
      await prisma.paper.deleteMany({ where: { id: ids.paper } }).catch(() => {});
      await prisma.knowledgePoint.deleteMany({ where: { id: ids.point } }).catch(() => {});
      await prisma.knowledgeNode.deleteMany({ where: { id: ids.node } }).catch(() => {});
      await prisma.questionFamily.deleteMany({ where: { id: { startsWith: 'sr-fam-' } } }).catch(() => {});
      await prisma.$disconnect();
    }
    if (activeApi) { await new Promise((r) => setTimeout(r, 800)); activeApi.kill(); }
  } catch { /* best effort */ }
}

(async () => {
  activeApi = null;
  try {
    const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:api'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
    assert.equal(build.status, 0, `build:api failed: ${(build.stderr || build.stdout).slice(-500)}`);
    await seedBeforeBoot();
    activeApi = startApi();
    await waitForHealth(activeApi);
    await runJourney();
    console.log(`\nPHASE 9 Score Recovery integration PASSED (${steps.length} steps)`);
    await runCleanup();
    process.exit(0);
  } catch (error) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    console.error('\nPHASE 9 Score Recovery integration FAILED:', error?.message ?? error);
    if (activeApi?.getOutput) console.error(activeApi.getOutput().slice(-6000));
    await runCleanup();
    process.exit(1);
  }
})();
