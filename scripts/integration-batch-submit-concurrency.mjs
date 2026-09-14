/**
 * P1.5 Batch-submit concurrency — end-to-end over real HTTP + real PostgreSQL.
 *
 * The defect (S1 report §8.3, PRE-EXISTING): the three batch submission paths
 * fanned out per-question writes with Promise.all. When several questions in
 * one paper resolve to the SAME knowledge node, the concurrent transactions
 * race on one UserKnowledgeMastery row, the OCC retry budget (3) is exhausted,
 * MasteryOptimisticLockConflictError is thrown and the WHOLE paper submit
 * returns 500. Reproduced deterministically with 3+ same-node questions.
 *
 * This script drives the REAL paper submission path with FIVE questions that
 * all resolve to one node (bridge shape, production's reality):
 *
 *   seed (1 node, 1 bridge knowledge point, 5 questions, 1 paper)
 *   → student submits the paper (mixed correct/wrong answers)
 *   → submit succeeds (was: 500)
 *   → 5 PracticeRecord rows; mastery row attempts=5, version=4
 *   → the stored mastery state equals the shared updateMasteryAfterAttempt
 *     replayed SEQUENTIALLY in answer order (deterministic application order)
 *   → 401 unauthenticated rejection path
 *   → a second batch path (stage assessment, same node) also succeeds and
 *     accumulates on the same mastery row
 *
 * Prerequisite: docker compose -f compose.test.yml up -d --wait
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

// Lazy requires: module-load-time require of dist artifacts breaks when a
// previous run was interrupted mid-build (nest deletes outDir before emit).
const require = createRequire(import.meta.url);
const loadPassword = () => require('../apps/api/dist/auth/password.js');
const loadMastery = () => require('../packages/shared/dist/score-center/mastery.js');

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const root = process.cwd();
const apiUrl = 'http://127.0.0.1:3271';
const databaseUrl = process.env.TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:55432/kaoyan408_test?schema=public';
const jwtSecret = 'integration-batch-concurrency-secret-0123456789';
process.env.DATABASE_URL = databaseUrl;

const runId = randomUUID().slice(0, 8);
const DAY = 86_400_000;
const password = 'Batch-Concurrency-Integration-Password-1';

const ids = {
  admin: `batch-admin-${runId}`,
  node: `batch-node-${runId}`,
  point: `batch-point-${runId}`,
  family: `batch-family-${runId}`,
  paper: `batch-paper-${runId}`,
};
const QUESTION_COUNT = 5;
// Mixed outcomes; the expected mastery is replayed from this exact order.
const ANSWER_PLAN = [
  { selectedAnswer: 'A', correct: true },
  { selectedAnswer: 'X', correct: false },
  { selectedAnswer: 'A', correct: true },
  { selectedAnswer: 'X', correct: false },
  { selectedAnswer: 'X', correct: false },
];

const steps = [];
function record(step, detail) {
  steps.push(`${step}: ${detail}`);
  console.log(`  ✓ ${step} — ${detail}`);
}

let activeApi = null;
let prisma = null;

async function seedBeforeBoot() {
  const migrate = spawnSync(npx, ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  assert.equal(migrate.status, 0, `migrate deploy failed: ${migrate.stderr || migrate.stdout}`);

  prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const { hashPassword } = loadPassword();

  await prisma.user.upsert({
    where: { id: ids.admin },
    update: { passwordHash: await hashPassword(password), role: 'ADMIN', accountStatus: 'ACTIVE', trialStatus: 'ACTIVE' },
    create: {
      id: ids.admin,
      email: `${ids.admin}@integration.test`,
      name: 'Batch Admin',
      role: 'ADMIN',
      passwordHash: await hashPassword(password),
      trialStatus: 'ACTIVE',
      accountStatus: 'ACTIVE',
    },
  });

  await prisma.knowledgeNode.create({
    data: { id: ids.node, subject: 'DATA_STRUCTURE', nodeType: 'knowledge_point', name: `并发节点 ${ids.node}`, importance: 3, difficulty: 3, syllabusVersion: 'test' },
  });
  await prisma.knowledgePoint.create({
    data: {
      id: ids.point, subject: 'DATA_STRUCTURE', chapter: 'P15-batch', title: '并发归中考点',
      importance: 3, frequency: 3, prerequisites: [],
      nodeMaps: { create: { knowledgeNodeId: ids.node, mappingType: 'PRIMARY', confidence: 1 } },
    },
  });
  await prisma.questionFamily.create({ data: { id: ids.family } });

  // FIVE questions, ALL resolving to the SAME node via the bridge shape
  // (question → knowledge point → node map) — the exact shape that made the
  // concurrent Promise.all submissions exhaust the OCC retry budget.
  for (let i = 0; i < QUESTION_COUNT; i += 1) {
    const questionId = `q-batch-${i}-${runId}`;
    await prisma.question.create({
      data: {
        id: questionId,
        familyId: ids.family,
        versionNumber: i + 1,
        contentFingerprint: `fp-${questionId}`,
        stem: `P1.5 concurrency fixture ${i}`,
        options: ['A', 'B', 'C', 'D'],
        answer: 'A',
        analysis: '',
        difficulty: 'MEDIUM',
        type: 'SINGLE_CHOICE',
        source: 'integration',
        expectedTimeSec: 60,
      },
    });
    await prisma.questionKnowledgePoint.create({ data: { questionId, knowledgePointId: ids.point } });
  }

  const paperQuestions = Array.from({ length: QUESTION_COUNT }, (_, i) => ({
    id: `q-batch-${i}-${runId}`,
    stem: `P1.5 concurrency fixture ${i}`,
    type: '单选题',
    options: ['A', 'B', 'C', 'D'],
    analysis: '',
  }));
  await prisma.paper.create({
    data: {
      id: ids.paper,
      title: 'P1.5 并发提交集成卷',
      paperType: '模拟卷',
      questionCount: QUESTION_COUNT,
      knowledgePointIds: [ids.point],
      questions: paperQuestions,
      estimatedMinutes: 15,
      createdBy: ids.admin,
    },
  });
}

async function createInvitation(maxUses) {
  const code = randomBytes(18).toString('base64url');
  await prisma.invitationCode.create({
    data: {
      codeHash: createHmac('sha256', jwtSecret).update(code.trim()).digest('hex'),
      codePrefix: code.slice(0, 6),
      label: 'p1.5 batch concurrency integration',
      maxUses,
      startsAt: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() + DAY),
      createdById: ids.admin,
    },
  });
  return code;
}

function startApi() {
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: `${root}/apps/api`,
    env: {
      ...process.env,
      PORT: '3271',
      WEB_ORIGIN: 'http://127.0.0.1:5173',
      DATABASE_URL: databaseUrl,
      JWT_SECRET: jwtSecret,
      ALLOW_DEMO_AUTH: 'true',
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
    if (child.exitCode != null) {
      throw new Error(`API exited with ${child.exitCode}: ${child.getOutput?.().trim() ?? ''}`);
    }
    try {
      const response = await fetch(`${apiUrl}/health`);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`API did not become healthy in time: ${child.getOutput?.().slice(-2000) ?? ''}`);
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`POST ${url} failed (${response.status}): ${text.slice(0, 300)}`);
  }
  return response.json();
}

/** Sequential replay of the production EMA over the answer plan. */
function expectedMasteryState() {
  const { updateMasteryAfterAttempt } = loadMastery();
  const neutral = { mastery: 0.5, accuracy: 0.55, recentAccuracy: 0.55, attempts: 0, correctCount: 0, wrongCount: 0, confidence: 0 };
  let state = neutral;
  for (const answer of ANSWER_PLAN) {
    state = updateMasteryAfterAttempt(state, {
      isCorrect: answer.correct,
      difficulty: 3,
      role: 'PRIMARY',
    });
  }
  return state;
}

async function verifyAfterBoot() {
  const invite = await createInvitation(2);
  const studentEmail = `batch-student-${runId}@integration.test`;
  const registered = await postJson(`${apiUrl}/auth/register`, {
    email: studentEmail, password, name: '并发学生', inviteCode: invite,
  });
  const studentId = registered?.user?.id ?? registered?.id;
  assert.ok(studentId, 'register must return the created student id');
  await prisma.user.update({ where: { id: studentId }, data: { trialStatus: 'ACTIVE', accountStatus: 'ACTIVE' } });
  const token = (await postJson(`${apiUrl}/auth/login`, { email: studentEmail, password }))?.accessToken;
  assert.ok(token, 'login must succeed');
  const headers = { authorization: `Bearer ${token}` };
  record('seed', `1 node + 5 same-node questions + paper ready (student=${studentId})`);

  // ---------------------------------------------------------------------
  // 1. Rejection path first: unauthenticated submit must be 401.
  // ---------------------------------------------------------------------
  const unauth = await fetch(`${apiUrl}/papers/${ids.paper}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers: [] }),
  });
  assert.equal(unauth.status, 401, `unauthenticated paper submit must be 401, got ${unauth.status}`);
  record('guards', '401 unauthenticated paper submit');

  // ---------------------------------------------------------------------
  // 2. THE defect scenario: 5 same-node questions in one paper submit.
  //    Before the fix this deterministically returned 500 (OCC exhaustion).
  // ---------------------------------------------------------------------
  const submission = await postJson(`${apiUrl}/papers/${ids.paper}/submit`, {
    answers: ANSWER_PLAN.map((answer, i) => ({
      questionId: `q-batch-${i}-${runId}`,
      selectedAnswer: answer.selectedAnswer,
      timeSpentSec: 10,
    })),
  }, headers);
  const expectedCorrect = ANSWER_PLAN.filter((a) => a.correct).length;
  assert.equal(submission.correctCount, expectedCorrect, `expected ${expectedCorrect} correct, got ${submission.correctCount}`);
  assert.equal(submission.syncedPracticeRecordCount, QUESTION_COUNT, 'all five answers synced as practice records');
  record('submit', `paper submitted through the real endpoint (${expectedCorrect}/${QUESTION_COUNT} correct) — no 500`);

  // ---------------------------------------------------------------------
  // 3. Every attempt landed exactly once, on ONE mastery row.
  // ---------------------------------------------------------------------
  const practiceRecords = await prisma.practiceRecord.findMany({ where: { userId: studentId } });
  assert.equal(practiceRecords.length, QUESTION_COUNT, `expected ${QUESTION_COUNT} practice records, got ${practiceRecords.length}`);

  const mastery = await prisma.userKnowledgeMastery.findUnique({
    where: { userId_knowledgeNodeId: { userId: studentId, knowledgeNodeId: ids.node } },
  });
  assert.ok(mastery, 'the mastery row exists');
  assert.equal(mastery.attempts, QUESTION_COUNT, `mastery attempts must be ${QUESTION_COUNT} (each question applied exactly once), got ${mastery.attempts}`);
  assert.equal(mastery.correctCount, expectedCorrect);
  assert.equal(mastery.wrongCount, QUESTION_COUNT - expectedCorrect);
  assert.equal(mastery.version, QUESTION_COUNT - 1, `create(v0) + ${QUESTION_COUNT - 1} OCC increments = ${QUESTION_COUNT - 1}, got ${mastery.version}`);
  record('mastery', `attempts=${mastery.attempts} version=${mastery.version} correct=${mastery.correctCount} — exactly-once per question`);

  // ---------------------------------------------------------------------
  // 4. The stored state equals the sequential EMA replay in answer order.
  //    (Deterministic application order is part of the fix's correctness.)
  // ---------------------------------------------------------------------
  const expected = expectedMasteryState();
  for (const key of ['mastery', 'accuracy', 'recentAccuracy', 'confidence']) {
    assert.ok(
      Math.abs(mastery[key] - expected[key]) < 1e-9,
      `${key}: stored ${mastery[key]} must equal sequential replay ${expected[key]}`,
    );
  }
  record('determinism', `stored mastery=${mastery.mastery.toFixed(6)} equals sequential replay in answer order`);

  // ---------------------------------------------------------------------
  // 5. A second batch path (stage assessment, same node) also succeeds and
  //    accumulates on the same mastery row — no OCC exhaustion either.
  // ---------------------------------------------------------------------
  const assessment = await postJson(`${apiUrl}/assessments/stage/submit`, {
    answers: ANSWER_PLAN.slice(0, 3).map((answer, i) => ({
      questionId: `q-batch-${i}-${runId}`,
      selectedAnswer: answer.selectedAnswer,
      timeSpentSec: 8,
    })),
  }, headers);
  assert.ok(assessment.totalQuestions === 3, 'stage assessment accepted 3 answers');
  const masteryAfter = await prisma.userKnowledgeMastery.findUnique({
    where: { userId_knowledgeNodeId: { userId: studentId, knowledgeNodeId: ids.node } },
  });
  assert.equal(masteryAfter.attempts, QUESTION_COUNT + 3, `attempts accumulate across batch paths: ${QUESTION_COUNT}+3, got ${masteryAfter.attempts}`);
  record('second-path', `stage assessment (3 same-node answers) succeeded; attempts=${masteryAfter.attempts}`);
}

(async () => {
  activeApi = null;
  try {
    const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:api'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
    assert.equal(build.status, 0, `build:api failed: ${(build.stderr || build.stdout).slice(-500)}`);
    // Content fixtures MUST exist before boot: the service hydrates its paper
    // catalog in OnModuleInit, so a paper seeded after boot is invisible.
    await seedBeforeBoot();
    activeApi = startApi();
    await waitForHealth(activeApi);
    await verifyAfterBoot();
    console.log(`\nP1.5 batch-submit concurrency integration PASSED (${steps.length} steps)`);
    process.exit(0);
  } catch (error) {
    console.error('\nP1.5 batch-submit concurrency integration FAILED:', error?.message ?? error);
    if (activeApi?.getOutput) {
      console.error('--- API output tail ---');
      console.error(activeApi.getOutput().slice(-12000));
    }
    process.exit(1);
  } finally {
    try {
      if (prisma && !process.env.KEEP_FIXTURES) {
        await prisma.user.deleteMany({ where: { email: { endsWith: `${runId}@integration.test` } } }).catch(() => {});
        await prisma.user.deleteMany({ where: { id: ids.admin } }).catch(() => {});
        await prisma.paper.deleteMany({ where: { id: ids.paper } }).catch(() => {});
        await prisma.question.deleteMany({ where: { id: { startsWith: `q-batch-` } } }).catch(() => {});
        await prisma.knowledgePoint.deleteMany({ where: { id: ids.point } }).catch(() => {});
        await prisma.knowledgeNode.deleteMany({ where: { id: ids.node } }).catch(() => {});
        await prisma.questionFamily.deleteMany({ where: { id: ids.family } }).catch(() => {});
        await prisma.$disconnect();
      }
      if (activeApi) { await new Promise((r) => setTimeout(r, 800)); activeApi.kill(); }
    } catch {
      // cleanup is best-effort; never masks the run result
    }
  }
})();
