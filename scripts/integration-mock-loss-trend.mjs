/**
 * PHASE 11 — mock-exam loss trend over real PG + HTTP.
 *
 * The join path under test is the one the WRITERS actually produce:
 *   paper session (sessionId, resourceId = paperId)
 *     → ScoreAssessment (originId = 'paper:<paperId>')
 *       → ScoreLossItem (scoreEntryKind='assessment', scoreEntryId = assessment id)
 *
 * Two papers are submitted: the second loses fewer observed points than the
 * first, so the trend must say "较上次少丢 N 分"; a third session with no
 * evidence must keep null loss (unknown ≠ 0) and refuse a delta.
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
const jwtSecret = 'integration-mock-loss-trend-secret-0123456789';
process.env.DATABASE_URL = databaseUrl;

const runId = randomUUID().slice(0, 8);
const DAY = 86_400_000;
const password = 'Mock-Loss-Trend-Password-1';

const ids = { admin: `mlt-admin-${runId}`, node: `mlt-node-${runId}`, point: `mlt-point-${runId}`, paperA: `mlt-paper-a-${runId}`, paperB: `mlt-paper-b-${runId}` };

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
      id: ids.admin, email: `${ids.admin}@integration.test`, name: 'MLT Admin', role: 'ADMIN',
      passwordHash: await hashPassword(password), trialStatus: 'ACTIVE', accountStatus: 'ACTIVE',
    },
  });
  await prisma.knowledgeNode.create({
    data: { id: ids.node, subject: 'OPERATING_SYSTEM', nodeType: 'knowledge_point', name: `MLT 节点 ${runId}`, importance: 4, difficulty: 3, syllabusVersion: 'test' },
  });
  await prisma.knowledgePoint.create({
    data: {
      id: ids.point, subject: 'OPERATING_SYSTEM', chapter: 'P11', title: 'MLT 考点',
      importance: 4, frequency: 4, prerequisites: [],
      nodeMaps: { create: { knowledgeNodeId: ids.node, mappingType: 'PRIMARY', confidence: 1 } },
    },
  });
  // Four priced questions (2 pts each); both papers use them.
  const questions = ['a', 'b', 'c', 'd'].map((suffix) => `mlt-q-${suffix}-${runId}`);
  for (const [index, id] of questions.entries()) {
    await prisma.questionFamily.create({ data: { id: `mlt-fam-${id}` } });
    await prisma.question.create({
      data: {
        id, familyId: `mlt-fam-${id}`, versionNumber: 1, contentFingerprint: `fp-${id}`,
        stem: `MLT fixture ${index}`, options: ['A', 'B', 'C', 'D'], answer: 'A', analysis: 'x',
        difficulty: 'MEDIUM', type: 'SINGLE_CHOICE', source: 'integration', expectedTimeSec: 60,
        questionSubtype: 'OS_PV', maxScore: 2,
      },
    });
    await prisma.questionKnowledgePoint.create({ data: { questionId: id, knowledgePointId: ids.point } });
  }
  for (const paperId of [ids.paperA, ids.paperB]) {
    await prisma.paper.create({
      data: {
        id: paperId, title: `MLT 卷 ${paperId.slice(-1)}`, paperType: '模拟卷', questionCount: 4,
        knowledgePointIds: [ids.point],
        questions: questions.map((id, index) => ({ id, stem: `MLT fixture ${index}`, type: '单选题', options: ['A', 'B', 'C', 'D'], answer: 'A', analysis: 'x' })),
        estimatedMinutes: 10, createdBy: ids.admin,
      },
    });
  }
  return questions;
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

async function runJourney(questions) {
  const invite = randomBytes(18).toString('base64url');
  await prisma.invitationCode.create({
    data: {
      codeHash: createHmac('sha256', jwtSecret).update(invite.trim()).digest('hex'),
      codePrefix: invite.slice(0, 6), label: 'p11 mlt', maxUses: 5,
      startsAt: new Date(Date.now() - 60_000), expiresAt: new Date(Date.now() + DAY), createdById: ids.admin,
    },
  });
  const email = `mlt-student-${runId}@integration.test`;
  const registered = await postJson(`${apiUrl}/auth/register`, { email, password, name: '模考趋势学生', inviteCode: invite });
  const student = registered?.user?.id ?? registered?.id;
  await prisma.user.update({ where: { id: student }, data: { trialStatus: 'ACTIVE', accountStatus: 'ACTIVE' } });
  const headers = { authorization: `Bearer ${(await postJson(`${apiUrl}/auth/login`, { email, password })).accessToken}` };
  record('seed', `student=${student}; two papers over four priced questions (2 pts each)`);

  // The score HISTORY tracks completed paper SESSIONS, so the exam simulation
  // goes through the session path (start type='paper' + resourceId=paperId,
  // then submit) — exactly what a student's exam run produces.
  const exam = async (paperId, answers) => {
    const started = await postJson(`${apiUrl}/sessions/practice/start`, {
      type: 'paper', resourceId: paperId, questionIds: questions,
    }, headers);
    await postJson(`${apiUrl}/sessions/practice/${started.id}/submit`, { answers }, headers);
    return started.id;
  };
  // Exam A: three wrong (6 observed points lost), one correct.
  const sessionA = await exam(ids.paperA, [
    { questionId: questions[0], selectedAnswer: 'X', timeSpentSec: 30 },
    { questionId: questions[1], selectedAnswer: 'X', timeSpentSec: 30 },
    { questionId: questions[2], selectedAnswer: 'X', timeSpentSec: 30 },
    { questionId: questions[3], selectedAnswer: 'A', timeSpentSec: 30 },
  ]);
  // Exam B: one wrong (2 observed points lost), three correct.
  const sessionB = await exam(ids.paperB, [
    { questionId: questions[0], selectedAnswer: 'X', timeSpentSec: 30 },
    { questionId: questions[1], selectedAnswer: 'A', timeSpentSec: 30 },
    { questionId: questions[2], selectedAnswer: 'A', timeSpentSec: 30 },
    { questionId: questions[3], selectedAnswer: 'A', timeSpentSec: 30 },
  ]);
  record('papers', `exam A lost 6 observed points; exam B lost 2 (sessions ${sessionA.slice(-6)} / ${sessionB.slice(-6)})`);

  // Same-day exams: both carry their own observed loss, but the day-granular
  // history cannot order them, so the delta must be refused with a reason.
  const history = await getJson(`${apiUrl}/exam/score-history`, headers);
  assert.ok(history.lossTrend, 'lossTrend section present (pure increment on the legacy DTO)');
  assert.equal(history.lossTrend.dataStatus, 'OK');
  assert.equal(history.lossTrend.summary.exams, 2);
  assert.equal(history.lossTrend.summary.examsWithLoss, 2);
  assert.equal(history.lossTrend.summary.totalObservedLostScore, 8, 'A 6 + B 2 observed points');
  const amounts = history.lossTrend.rows.map((row) => row.observedLostScore).sort((a, b) => a - b);
  assert.deepEqual(amounts, [2, 6], 'one exam lost 6, the other 2 (real submission path)');
  assert.equal(history.lossTrend.rows[1].observedLossDelta, null, 'same-day order unknowable → no delta');
  assert.match(history.lossTrend.rows[1].deltaReason, /同一天/);
  assert.equal(history.lossTrend.rows[0].deltaReason.length > 0, true, 'first row states why there is no delta');
  const nodeRow = history.lossTrend.rows.find((row) => row.observedLostScore === 6);
  assert.equal(nodeRow.nodes[0].nodeId, ids.node, 'loss attributed to the node');
  assert.equal(nodeRow.nodes[0].observedLostScore, 6);
  record('same-day', 'A 6 / B 2 observed points, node attribution present; same-day delta refused with reason');

  // Cross-day: backdate exam A's session timestamp (fixture time travel, same
  // precedent as the score-loss backdated attempt) so the pair becomes ordered
  // and the delta must state the real direction.
  await prisma.learningSession.updateMany({
    where: { userId: student, resourceId: ids.paperA },
    data: { lastActiveAt: new Date(Date.now() - 2 * DAY), startedAt: new Date(Date.now() - 2 * DAY) },
  });
  const crossDay = await getJson(`${apiUrl}/exam/score-history`, headers);
  const [first, second] = crossDay.lossTrend.rows;
  assert.equal(first.observedLostScore, 6, 'backdated exam A is now first');
  assert.equal(second.observedLostScore, 2);
  assert.equal(second.observedLossDelta, -4, 'loss fell by 4 across days');
  assert.equal(second.observedLossDeltaLabel, '较上次少丢 4 分');
  record('cross-day', 'backdated exam A → delta -4 with "较上次少丢 4 分"');

  // Legacy contract intact (backward compatibility).
  for (const key of ['userId', 'totalExams', 'latestAccuracyRate', 'trend', 'trendLabel', 'history']) {
    assert.ok(key in crossDay, `legacy field ${key} still present`);
  }

  const anon = await fetch(`${apiUrl}/exam/score-history`);
  assert.equal(anon.status, 401);
  record('guards', 'legacy fields preserved + 401 verified');
}

/**
 * FK-safe fixture cleanup (the hygiene fix, 2026-09-19): this suite ran with
 * NO cleanup at all, leaking users/papers/questions per run (11 runs = 22
 * users, 40+ questions of 'integration' residue in the test DB). Redemptions
 * must go before users (they hold FKs to both the redeeming user and the
 * creating admin); papers/questions/points/nodes/families follow.
 */
async function runCleanup() {
  try {
    if (prisma && !process.env.KEEP_FIXTURES) {
      await prisma.invitationRedemption.deleteMany({ where: { user: { email: { endsWith: `${runId}@integration.test` } } } }).catch(() => {});
      await prisma.invitationRedemption.deleteMany({ where: { user: { id: ids.admin } } }).catch(() => {});
      await prisma.invitationCode.deleteMany({ where: { createdBy: { id: ids.admin } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { email: { endsWith: `${runId}@integration.test` } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: ids.admin } }).catch(() => {});
      await prisma.paper.deleteMany({ where: { id: { in: [ids.paperA, ids.paperB] } } }).catch(() => {});
      await prisma.question.deleteMany({ where: { id: { contains: `-${runId}` } } }).catch(() => {});
      await prisma.questionFamily.deleteMany({ where: { id: { startsWith: `mlt-fam-mlt-q-` } } }).catch(() => {});
      await prisma.knowledgePoint.deleteMany({ where: { id: ids.point } }).catch(() => {});
      await prisma.knowledgeNode.deleteMany({ where: { id: ids.node } } ).catch(() => {});
      await prisma.$disconnect();
    }
    if (activeApi) { await new Promise((r) => setTimeout(r, 800)); activeApi.kill(); }
  } catch {
    // cleanup is best-effort; never masks the run result
  }
}

(async () => {
  activeApi = null;
  try {
    const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:api'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
    assert.equal(build.status, 0, `build:api failed: ${(build.stderr || build.stdout).slice(-500)}`);
    const questions = await seedBeforeBoot();
    activeApi = startApi();
    await waitForHealth(activeApi);
    await runJourney(questions);
    console.log(`\nPHASE 11 Mock loss trend integration PASSED (${steps.length} steps)`);
    await runCleanup();
    process.exit(0);
  } catch (error) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    console.error('\nPHASE 11 Mock loss trend integration FAILED:', error?.message ?? error);
    if (activeApi?.getOutput) console.error(activeApi.getOutput().slice(-6000));
    await runCleanup();
    process.exit(1);
  }
})();
