/**
 * V13-A1 Error Reason Foundation — end-to-end over real HTTP + real PostgreSQL.
 *
 * Drives the REAL error-reason surfaces and reads the projection back:
 *
 *   seed (2 attributed nodes + 1 deliberately unattributed point, 3 questions)
 *   → student submits 5 wrong single-question practices through
 *     POST /practice-records (auto labels: unknown×3, knowledge_gap×1,
 *     reading_error×1; one question node-unattributed)
 *   → self-reported reasons through POST /wrong-questions/:id/reason:
 *       controlledReason='method_error' + optionalNote   (Case 1)
 *       legacy canonical Chinese '概念混淆' verbatim      (Case 4)
 *       legacy free text '读题漏条件' verbatim             (Case 4)
 *   → invalid enum rejected 400                           (Case 2)
 *   → oversized optionalNote rejected 400                 (Case 3)
 *   → idempotency key replay creates no second attempt    (Case 9)
 *   → 30-day-old backdated attempt stays out of the 7d window (Case 6, store-side)
 *   → GET /coach/error-patterns aggregates (subject,node,reason):
 *       same node+reason merges across questions          (Case 5)
 *       different reasons / different nodes stay distinct (Case 7/8)
 *   → student without data gets zeros, never fabricated stats (Case 10)
 *   → 401 unauthenticated / 403 cross-student guards
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
const jwtSecret = 'integration-error-patterns-secret-0123456789';
process.env.DATABASE_URL = databaseUrl;

const runId = randomUUID().slice(0, 8);
const DAY = 86_400_000;
const password = 'Error-Pattern-Integration-Password-1';

let qPv; let qMem; let qNoNode;
const ids = {
  admin: `ep-admin-${runId}`,
  teacher: `ep-teacher-${runId}`,
  studentA: `ep-student-a-${runId}`,
  studentAEmail: `ep-student-a-${runId}@integration.test`,
  studentB: null,
  nodeOs: `ep-node-os-${runId}`,
  nodeDs: `ep-node-ds-${runId}`,
  pointOs: `ep-point-os-${runId}`,
  pointDs: `ep-point-ds-${runId}`,
  pointNone: `ep-point-none-${runId}`,
  family: `ep-family-${runId}`,
};

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

  for (const [id, role, name] of [
    [ids.admin, 'ADMIN', 'Error Pattern Admin'],
    [ids.teacher, 'TEACHER', 'Error Pattern Teacher'],
    [ids.studentA, 'STUDENT', '错因学生A'],
  ]) {
    await prisma.user.upsert({
      where: { id },
      update: { passwordHash: await hashPassword(password), role, accountStatus: 'ACTIVE', trialStatus: 'ACTIVE' },
      create: {
        id,
        email: `${id}@integration.test`,
        name,
        role,
        passwordHash: await hashPassword(password),
        trialStatus: 'ACTIVE',
        accountStatus: 'ACTIVE',
      },
    });
  }

  await prisma.knowledgeNode.create({
    data: { id: ids.nodeOs, subject: 'OPERATING_SYSTEM', nodeType: 'knowledge_point', name: `PV 操作 ${runId}`, importance: 4, difficulty: 3, syllabusVersion: 'test' },
  });
  await prisma.knowledgeNode.create({
    data: { id: ids.nodeDs, subject: 'DATA_STRUCTURE', nodeType: 'knowledge_point', name: `内存管理 ${runId}`, importance: 3, difficulty: 3, syllabusVersion: 'test' },
  });
  await prisma.knowledgePoint.create({
    data: {
      id: ids.pointOs, subject: 'OPERATING_SYSTEM', chapter: 'A1-ep', title: 'PV 错因考点',
      importance: 4, frequency: 4, prerequisites: [],
      nodeMaps: { create: { knowledgeNodeId: ids.nodeOs, mappingType: 'PRIMARY', confidence: 1 } },
    },
  });
  await prisma.knowledgePoint.create({
    data: {
      id: ids.pointDs, subject: 'DATA_STRUCTURE', chapter: 'A1-ep', title: '内存错因考点',
      importance: 3, frequency: 3, prerequisites: [],
      nodeMaps: { create: { knowledgeNodeId: ids.nodeDs, mappingType: 'PRIMARY', confidence: 1 } },
    },
  });
  // Deliberately NO node map → canonical resolver finds nothing → node-unattributed.
  await prisma.knowledgePoint.create({
    data: { id: ids.pointNone, subject: 'OPERATING_SYSTEM', chapter: 'A1-ep', title: '无归因考点', importance: 2, frequency: 2, prerequisites: [] },
  });
  await prisma.questionFamily.create({ data: { id: ids.family } });

  const question = (id, overrides = {}) => ({
    id,
    familyId: ids.family,
    versionNumber: 1,
    contentFingerprint: `fp-${id}`,
    stem: `A1 error pattern fixture ${id}`,
    options: ['A', 'B', 'C', 'D'],
    answer: 'A',
    analysis: '',
    difficulty: 'MEDIUM',
    type: 'SINGLE_CHOICE',
    source: 'integration',
    expectedTimeSec: 60,
    ...overrides,
  });
  const questionPointPairs = [
    [`q-ep-pv-${runId}`, ids.pointOs, 1],
    [`q-ep-mem-${runId}`, ids.pointDs, 2],
    [`q-ep-none-${runId}`, ids.pointNone, 3],
  ];
  for (const [id, pointId, versionNumber] of questionPointPairs) {
    await prisma.question.create({ data: question(id, { versionNumber }) });
    // Explicit M:N (composite PK) — rows created separately, per production shape.
    await prisma.questionKnowledgePoint.create({ data: { questionId: id, knowledgePointId: pointId } });
  }
  qPv = `q-ep-pv-${runId}`;
  qMem = `q-ep-mem-${runId}`;
  qNoNode = `q-ep-none-${runId}`;

  // Teacher→student authorization MUST exist before boot: the guard reads an
  // in-memory set hydrated at startup, not the live table.
  await prisma.teacherStudentAuthorization.create({
    data: { teacherId: ids.teacher, studentId: ids.studentA },
  });
}

function startApi() {
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: `${root}/apps/api`,
    env: {
      ...process.env,
      PORT: '3270',
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

async function postStatus(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`GET ${url} failed (${response.status}): ${text.slice(0, 300)}`);
  }
  return response.json();
}

async function createInvitation(maxUses) {
  const code = randomBytes(18).toString('base64url');
  await prisma.invitationCode.create({
    data: {
      codeHash: createHmac('sha256', jwtSecret).update(code.trim()).digest('hex'),
      codePrefix: code.slice(0, 6),
      label: 'v13 a1 error patterns integration',
      maxUses,
      startsAt: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() + DAY),
      createdById: ids.admin,
    },
  });
  return code;
}

async function verifyAfterBoot() {
  // Student A was seeded before boot (known id) so the teacher authorization
  // exists in the startup-hydrated set; login still goes through real HTTP.
  const studentA = ids.studentA;
  const studentAEmail = ids.studentAEmail;

  const inviteB = await createInvitation(5);
  const registeredB = await postJson(`${apiUrl}/auth/register`, {
    email: `ep-student-b-${runId}@integration.test`, password, name: '错因学生B', inviteCode: inviteB,
  });
  const studentB = registeredB?.user?.id ?? registeredB?.id;
  await prisma.user.update({ where: { id: studentB }, data: { trialStatus: 'ACTIVE', accountStatus: 'ACTIVE' } });
  ids.studentB = studentB;

  const login = async (email) => (await postJson(`${apiUrl}/auth/login`, { email, password }))?.accessToken;
  const studentAToken = await login(studentAEmail);
  const studentBToken = await login(`ep-student-b-${runId}@integration.test`);
  assert.ok(studentAToken && studentBToken, 'student logins must succeed');
  const studentAHeaders = { authorization: `Bearer ${studentAToken}` };
  const studentBHeaders = { authorization: `Bearer ${studentBToken}` };
  record('seed', `accounts ready (A=${studentA}, B=${studentB})`);

  // ---------------------------------------------------------------
  // 1. Five wrong practices through the REAL single-question path.
  //    Auto labels: unclassified×3 (no-signal → null), knowledge_gap×1,
  //    reading_error×1 (too fast); qNoNode is node-unattributed.
  // ---------------------------------------------------------------
  let practiceSeq = 0;
  const practice = async (questionId, pointId, overrides = {}) => postJson(`${apiUrl}/practice-records`, {
    questionId, knowledgePointId: pointId, selectedAnswer: 'X', timeSpentSec: 70, ...overrides,
  }, { ...studentAHeaders, 'idempotency-key': `ep-practice-${runId}-${++practiceSeq}` });
  await practice(qPv, ids.pointOs);
  await practice(qPv, ids.pointOs);
  await practice(qPv, ids.pointOs, { confidence: '完全不会' });
  await practice(qMem, ids.pointDs, { timeSpentSec: 5 });
  await practice(qNoNode, ids.pointNone);
  record('practice', '5 wrong practice records submitted (auto: unknown×3, knowledge_gap×1, reading_error×1)');

  // ---------------------------------------------------------------
  // 2. Self-reported reasons through the REAL endpoint.
  // ---------------------------------------------------------------
  const reasonUrl = (questionId) => `${apiUrl}/wrong-questions/${questionId}/reason`;

  // Case 1 — legal controlled reason (+ note) saves; stored as canonical label.
  const r1 = await postJson(reasonUrl(qPv), {
    controlledReason: 'method_error',
    optionalNote: '计算步骤跳步了',
    redoCorrect: false,
    timeSpentSec: 30,
    idempotencyKey: `ep-key-1-${runId}`,
  }, studentAHeaders);
  assert.equal(r1.selfReportedReason, '方法错误', 'controlled reason stored as canonical Chinese label');
  record('case1', "controlledReason='method_error' saved (+optionalNote)");

  // Case 4 — legacy free text and legacy canonical Chinese stay verbatim compatible.
  const r2 = await postJson(reasonUrl(qMem), {
    selfReportedReason: '概念混淆', redoCorrect: false, timeSpentSec: 30,
  }, studentAHeaders);
  assert.equal(r2.selfReportedReason, '概念混淆', 'legacy canonical Chinese stored verbatim');
  const r3 = await postJson(reasonUrl(qMem), {
    selfReportedReason: '读题漏条件', redoCorrect: false, timeSpentSec: 30,
  }, studentAHeaders);
  assert.equal(r3.selfReportedReason, '读题漏条件', 'legacy free text stored verbatim');
  record('case4', 'legacy selfReportedReason paths remain verbatim-compatible');

  // Case 2 — invalid enum rejected.
  const bad = await postStatus(reasonUrl(qPv), {
    controlledReason: 'not_a_reason', redoCorrect: false, timeSpentSec: 30,
  }, studentAHeaders);
  assert.equal(bad.status, 400, `invalid controlledReason must 400, got ${bad.status}`);
  // guessing/unclassified are not submittable either.
  const badGuessing = await postStatus(reasonUrl(qPv), {
    controlledReason: 'guessing', redoCorrect: false, timeSpentSec: 30,
  }, studentAHeaders);
  assert.equal(badGuessing.status, 400, 'guessing is not submittable');
  record('case2', 'invalid enum rejected with 400 (incl. guessing/unclassified)');

  // Case 3 — oversized optionalNote rejected.
  const longNote = await postStatus(reasonUrl(qPv), {
    controlledReason: 'method_error',
    optionalNote: 'x'.repeat(101),
    redoCorrect: false,
    timeSpentSec: 30,
  }, studentAHeaders);
  assert.equal(longNote.status, 400, `oversized optionalNote must 400, got ${longNote.status}`);
  record('case3', 'optionalNote >100 chars rejected with 400');

  // Case 9 — idempotent replay creates no second evidence row (store-state invariant).
  const replay = await postStatus(reasonUrl(qPv), {
    controlledReason: 'method_error',
    optionalNote: '计算步骤跳步了',
    redoCorrect: false,
    timeSpentSec: 30,
    idempotencyKey: `ep-key-1-${runId}`,
  }, studentAHeaders);
  assert.equal(replay.status, 201, `idempotent replay must succeed, got ${replay.status}`);
  const replayedRows = await prisma.reviewAttempt.count({
    where: { idempotencyKey: `ep-key-1-${runId}`, schedule: { userId: studentA } },
  });
  assert.equal(replayedRows, 1, `idempotency key must yield exactly one attempt row, got ${replayedRows}`);
  record('case9', 'idempotent replay creates no second attempt (store count == 1)');

  // Case 6 (store side) — a 30-day-old self-reported attempt must stay out of the 7d window.
  const existingSchedule = await prisma.reviewSchedule.findUnique({
    where: { userId_questionId: { userId: studentA, questionId: qPv } },
  });
  assert.ok(existingSchedule, 'qPv schedule exists after the controlled reason report');
  await prisma.reviewAttempt.create({
    data: {
      scheduleId: existingSchedule.id, redoCorrect: false, timeSpentSec: 30, reportedReason: '公式记错',
      nextIntervalDays: 1, reviewedAt: new Date(Date.now() - 30 * DAY), isReview: true, source: 'wrong_question',
    },
  });
  record('case6-seed', '30-day-old formula_gap attempt planted outside the window');

  // ---------------------------------------------------------------
  // 3. The projection over real HTTP.
  // ---------------------------------------------------------------
  const patterns = await getJson(`${apiUrl}/coach/error-patterns?days=7`, studentAHeaders);
  assert.equal(patterns.storeAvailable, true);
  assert.equal(patterns.totals.wrongCount, 8, `expected 8 eligible wrong-evidence facts (5 practice + 3 self-reported), got ${patterns.totals.wrongCount}`);
  assert.equal(patterns.attemptsCounted, patterns.totals.wrongCount, 'OBSERVED count == eligible evidence count');
  assert.equal(patterns.totals.unclassifiedCount, 4, 'unclassified = 3 auto no-signal + 1 free-text self report');

  const rows = patterns.patterns;
  const findRow = (nodeId, reasonCode) => rows.find((row) => row.nodeId === nodeId && row.reasonCode === reasonCode);
  // Case 5 — same node + same reason merge across different questions.
  const unknownOs = findRow(ids.nodeOs, 'unclassified');
  assert.ok(unknownOs && unknownOs.count === 2, `same node+reason merges (Case 5), got ${unknownOs?.count}`);
  // Case 7 — different reasons stay distinct on the same node.
  const gap = findRow(ids.nodeOs, 'knowledge_gap');
  const method = findRow(ids.nodeOs, 'method_error');
  assert.ok(gap && gap.count === 1, 'knowledge_gap row distinct (Case 7)');
  assert.ok(method && method.count === 1 && method.sources.join(',') === 'self_reported', 'method_error only via user confirmation (task §5)');
  // Case 8 — different nodes never merge, subjects come from the node.
  const reading = findRow(ids.nodeDs, 'reading_error');
  const confusion = findRow(ids.nodeDs, 'concept_confusion');
  const freeText = findRow(ids.nodeDs, 'unclassified');
  assert.ok(reading && reading.count === 1 && reading.subject === 'DATA_STRUCTURE');
  assert.ok(confusion && confusion.count === 1 && confusion.reasonLabel === '概念混淆', 'legacy canonical Chinese maps to concept_confusion in projection');
  assert.ok(freeText && freeText.count === 1, 'legacy free text surfaces as unclassified');
  assert.equal(rows.filter((row) => row.reasonCode === 'formula_gap').length, 0, '30-day-old attempt stays outside the window (Case 6)');
  assert.ok(!rows.some((row) => row.nodeId === null), 'node-less attempts never form fake rows');
  assert.equal(patterns.totals.nodeUnattributedCount, 1, 'qNoNode evidence counted, attribution gap visible');
  record('projection', '8 facts → 6 rows; merge/distinct/window/unclassified all verified (Cases 5-9)');

  // Case 10 — a student without evidence gets zeros, not fabricated stats.
  const emptyB = await getJson(`${apiUrl}/coach/error-patterns`, studentBHeaders);
  assert.equal(emptyB.storeAvailable, true);
  assert.equal(emptyB.totals.wrongCount, 0);
  assert.deepEqual(emptyB.patterns, []);
  assert.deepEqual(emptyB.byReason, []);
  record('case10', 'no-evidence student receives zeros + empty patterns');

  // Guards: 401 unauthenticated, 403 cross-student.
  const anon = await fetch(`${apiUrl}/coach/error-patterns`);
  assert.equal(anon.status, 401, 'unauthenticated request must 401');
  const cross = await fetch(`${apiUrl}/coach/error-patterns?userId=${studentA}`, { headers: studentBHeaders });
  assert.equal(cross.status, 403, 'cross-student read must 403');
  // days boundary: non-numeric defaults, oversized clamps.
  const defaulted = await getJson(`${apiUrl}/coach/error-patterns?days=abc`, studentAHeaders);
  assert.equal(defaulted.window.days, 7);
  const clamped = await getJson(`${apiUrl}/coach/error-patterns?days=400`, studentAHeaders);
  assert.equal(clamped.window.days, 90);
  record('guards', '401 / 403 / days default+clamp verified');

  // Teacher with authorization can read the student's projection.
  const teacherToken = await login(`${ids.teacher}@integration.test`);
  const teacherView = await getJson(`${apiUrl}/coach/error-patterns?userId=${studentA}`, { authorization: `Bearer ${teacherToken}` });
  assert.equal(teacherView.totals.wrongCount, 8, 'authorized teacher reads the student projection');
  record('teacher', 'authorized teacher read verified');
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
    console.log(`\nV13-A1 Error Patterns integration PASSED (${steps.length} steps)`);
    await runCleanup();
    process.exit(0);
  } catch (error) {
    console.error('\nV13-A1 Error Patterns integration FAILED:', error?.message ?? error);
    if (activeApi?.getOutput) {
      console.error('--- API output tail ---');
      console.error(activeApi.getOutput().slice(-12000));
    }
    await runCleanup();
    process.exit(1);
  } finally {
    // Cleanup runs explicitly before each process.exit: process.exit()
    // terminates the process synchronously and never executes finally.
  }

})();

async function runCleanup() {
    try {
      if (prisma && !process.env.KEEP_FIXTURES) {
        // Invitation rows hold FKs to both the redeeming user and the creating
        // admin: they must go first or the user deletes fail silently.
        await prisma.invitationRedemption.deleteMany({ where: { user: { email: { endsWith: `${runId}@integration.test` } } } }).catch(() => {});
        await prisma.invitationRedemption.deleteMany({ where: { user: { id: ids.admin } } }).catch(() => {});
        await prisma.invitationCode.deleteMany({ where: { createdBy: { id: ids.admin } } }).catch(() => {});
        await prisma.user.deleteMany({ where: { email: { endsWith: `${runId}@integration.test` } } }).catch(() => {});
        await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.teacher, ids.studentB].filter(Boolean) } } }).catch(() => {});
        await prisma.question.deleteMany({ where: { id: { contains: runId } } }).catch(() => {});
        await prisma.knowledgePoint.deleteMany({ where: { id: { in: [ids.pointOs, ids.pointDs, ids.pointNone] } } }).catch(() => {});
        await prisma.knowledgeNode.deleteMany({ where: { id: { in: [ids.nodeOs, ids.nodeDs] } } }).catch(() => {});
        await prisma.questionFamily.deleteMany({ where: { id: ids.family } }).catch(() => {});
        await prisma.$disconnect();
      }
      if (activeApi) { await new Promise((r) => setTimeout(r, 800)); activeApi.kill(); }
    } catch {
      // cleanup is best-effort; never masks the run result
    }
  }
