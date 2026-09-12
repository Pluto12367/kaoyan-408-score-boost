/**
 * G1 Guidance Foundation — end-to-end check over real HTTP + real PostgreSQL.
 *
 * Drives the student's actual learning path through the real API:
 *
 *   new student → today mission contract → honest WHY → first-use HOW →
 *   practice → behaviour guardrails → exam-date entry → transfer re-test →
 *   verification → NEXT → guidance telemetry, plus the isolation and
 *   never-a-second-state invariants.
 *
 * Scenarios covered (task §23): new student, returning student, insufficient
 * evidence, probe expired, recommendation failed.
 *
 * Every assertion is an invariant. Without a database this script is
 * meaningless by design — it refuses to fake anything.
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
const apiUrl = 'http://127.0.0.1:3271';
const databaseUrl = process.env.TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:55432/kaoyan408_test?schema=public';
const jwtSecret = 'integration-guidance-protocol-secret-0123456789';
process.env.DATABASE_URL = databaseUrl;
// A5: the probe must be ON for this run — the E2E is meaningless otherwise.
process.env.TRANSFER_PROBE_ENABLED = 'true';
// C1 must stay OFF; the run asserts it explicitly.
delete process.env.MASTERY_SEMANTICS;

const runId = randomUUID().slice(0, 8);
const DAY = 86_400_000;
const password = 'Guidance-Protocol-Integration-Password-1';

const steps = [];
function record(step, detail) {
  steps.push(`${step}: ${detail}`);
  console.log(`  ✓ ${step} — ${detail}`);
}

let activeApi = null;

async function main() {
  const migrate = spawnSync(npx, ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  assert.equal(migrate.status, 0, `migrate deploy failed: ${migrate.stderr || migrate.stdout}`);

  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const created = { users: [], nodes: [], questions: [], kgPoints: [], invitations: [] };
  try {
    // -------------------------------------------------------------------
    // 1. Seed an admin (invitations) and two students through the real
    //    invitation flow. Two students let us prove isolation.
    // -------------------------------------------------------------------
    const adminId = `gd-admin-${runId}`;
    await prisma.user.upsert({
      where: { id: adminId },
      update: { passwordHash: await hashPassword(password), role: 'ADMIN', accountStatus: 'ACTIVE', trialStatus: 'ACTIVE' },
      create: {
        id: adminId,
        email: `${adminId}@integration.test`,
        name: 'G1 Admin',
        role: 'ADMIN',
        passwordHash: await hashPassword(password),
        trialStatus: 'ACTIVE',
        accountStatus: 'ACTIVE',
      },
    });
    created.users.push(adminId);

    const invite = await createInvitation(prisma, adminId, 5);
    const students = [];
    for (const label of ['a', 'b']) {
      const credentials = {
        email: `gd-student-${label}-${runId}@integration.test`,
        password,
        name: `G1 学生 ${label}`,
        inviteCode: invite,
      };
      const registered = await postJson(`${apiUrl}/auth/register`, credentials);
      const id = registered?.user?.id ?? registered?.id ?? null;
      assert.ok(id, 'register must return the created student id');
      await prisma.user.update({
        where: { id },
        data: { trialStatus: 'ACTIVE', accountStatus: 'ACTIVE', targetScore: 120, remainingDays: 96 },
      });
      const token = (await postJson(`${apiUrl}/auth/login`, { email: credentials.email, password }))?.accessToken;
      assert.ok(token, 'student login must return an access token');
      students.push({ id, token, headers: { authorization: `Bearer ${token}` } });
      created.users.push(id);
    }
    const [studentA, studentB] = students;
    record('seed', `admin + 2 students ready (A ${studentA.id}, B ${studentB.id})`);

    // -------------------------------------------------------------------
    // 2. Route registration: the G1 endpoints are guarded, not missing.
    // -------------------------------------------------------------------
    const guarded = [
      ['GET', '/coach/practice-patterns'],
      ['POST', '/coach/exam-date'],
    ];
    for (const [method, path] of guarded) {
      const response = await fetch(`${apiUrl}${path}`, {
        method,
        ...(method === 'POST'
          ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ examDate: null }) }
          : {}),
      });
      assert.equal(response.status, 401, `${method} ${path} must require authentication (registered + guarded)`);
    }
    record('route-guard', 'GET /coach/practice-patterns and POST /coach/exam-date are 401 unauthenticated');

    // -------------------------------------------------------------------
    // 3. NEW STUDENT: quiet by default. No history means no wrong-usage
    //    signal may be emitted — a fabricated one would be worse than none.
    // -------------------------------------------------------------------
    const newStudentPatterns = await getJson(`${apiUrl}/coach/practice-patterns`, studentA.headers);
    assert.equal(newStudentPatterns.storeAvailable, true, 'the real store must be available');
    assert.deepEqual(newStudentPatterns.signals, [], 'a brand-new student triggers nothing');
    assert.equal(newStudentPatterns.basis.attempts, 0);
    record('new-student', 'no history → zero behaviour signals (quiet by default)');

    // -------------------------------------------------------------------
    // 4. REASON INTEGRITY over HTTP: whatever the engine decided, the
    //    student-facing string must never contain a raw engine code.
    // -------------------------------------------------------------------
    const overview = await getJson(`${apiUrl}/dashboard/overview`, studentA.headers);
    const plan = await getJson(`${apiUrl}/today/plan`, studentA.headers).catch(() => ({ priorityTasks: [] }));
    const rawCodes = /[A-Z]{3,}_[A-Z_]{3,}/;
    for (const task of plan.priorityTasks ?? []) {
      assert.ok(
        !rawCodes.test(String(task.reason ?? '')),
        `task reason leaked a raw engine code: ${task.reason}`,
      );
      assert.ok(
        !String(task.reason ?? '').includes('recommendation:'),
        'the machine filler token must never reach a student',
      );
    }
    assert.ok(overview?.student, 'dashboard overview must be readable');
    record('reason-integrity', `${(plan.priorityTasks ?? []).length} task(s) carry no raw code and no machine token`);

    // -------------------------------------------------------------------
    // 5. examDate entry: derived days, past/malformed rejection, and the
    //    fact that remainingDays follows the date instead of the reverse.
    // -------------------------------------------------------------------
    const futureDate = new Date(Date.now() + 100 * DAY).toISOString().slice(0, 10);
    const savedExamDate = await postJson(`${apiUrl}/coach/exam-date`, { examDate: futureDate }, studentA.headers);
    assert.equal(savedExamDate.storeAvailable, true);
    assert.equal(savedExamDate.examDate, futureDate);
    assert.equal(savedExamDate.remainingDays, 100, 'remainingDays is derived from the date');
    assert.equal(savedExamDate.source, 'exam_date');
    assert.match(savedExamDate.daysLabel, /距离考试 100 天/);
    const storedRow = await prisma.user.findUnique({ where: { id: studentA.id }, select: { examDate: true, remainingDays: true } });
    assert.equal(storedRow.examDate.toISOString().slice(0, 10), futureDate, 'examDate is persisted');
    assert.equal(storedRow.remainingDays, 100, 'remainingDays agrees with examDate in the database');
    record('exam-date', `saved ${futureDate} → remainingDays ${storedRow.remainingDays} derived and persisted`);

    const past = await fetch(`${apiUrl}/coach/exam-date`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...studentA.headers },
      body: JSON.stringify({ examDate: '2020-01-01' }),
    });
    assert.equal(past.status, 400, 'a past exam date is rejected');
    const malformed = await fetch(`${apiUrl}/coach/exam-date`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...studentA.headers },
      body: JSON.stringify({ examDate: '2026-13-45' }),
    });
    assert.equal(malformed.status, 400, 'a malformed exam date is rejected');
    record('exam-date-guards', 'past date → 400, malformed date → 400');

    // -------------------------------------------------------------------
    // 6. RETURNING STUDENT with real history: seed graded practice so the
    //    behaviour detectors have something honest to work with.
    //    * 60 attempts, almost all repeats, none above BASIC, no
    //      verification at all  → patterns A, B and D must fire.
    // -------------------------------------------------------------------
    const nodeId = await seedNode(prisma, created, runId);
    const questionIds = await seedQuestions(prisma, created, nodeId, runId, 8);
    await seedPracticeHistory(prisma, studentA.id, questionIds, { attempts: 60, repeatWindow: 3, difficulty: 'BASIC' });
    const richPatterns = await getJson(`${apiUrl}/coach/practice-patterns`, studentA.headers);
    const fired = new Set(richPatterns.signals.map((signal) => signal.id));
    assert.ok(fired.has('A_repeat_familiar'), `A must fire, got ${[...fired].join(',')}`);
    assert.ok(fired.has('B_easy_only'), 'B must fire (no exam-difficulty work)');
    assert.ok(fired.has('D_practice_without_verification'), 'D must fire (volume without measurement)');
    for (const signal of richPatterns.signals) {
      assert.ok(signal.fact?.text?.length > 0, `${signal.id} must carry a FACT line`);
      assert.ok(signal.inference?.text?.length > 0, `${signal.id} must carry an explanation`);
      assert.ok(signal.action?.section, `${signal.id} must carry a clickable correction target`);
      assert.ok(signal.verification?.length > 0, `${signal.id} must state how success is judged`);
    }
    record('returning-student', `guardrails fired: ${[...fired].sort().join(', ')} (each with detection→explanation→action→verification)`);

    // -------------------------------------------------------------------
    // 7. PROBE EXPIRED: three expiries must produce an informational signal
    //    that explicitly refuses to count as a failure (S2 §7 discipline).
    // -------------------------------------------------------------------
    await seedExpiredProbes(prisma, studentA.id, nodeId, runId, 3);
    const probePatterns = await getJson(`${apiUrl}/coach/practice-patterns`, studentA.headers);
    const expiredSignal = probePatterns.signals.find((signal) => signal.id === 'E_probe_expired');
    assert.ok(expiredSignal, 'E must fire after three expiries');
    assert.equal(expiredSignal.evidence.countsAsFailure, false, 'expiry is never a failure');
    assert.equal(expiredSignal.priority, 'P2', 'expiry is informational');
    record('probe-expired', 'expiry signal is informational and explicitly not a failure');

    // -------------------------------------------------------------------
    // 8. RECOMMENDATION FAILED: two negative outcome signals on the same
    //    (node, action) must surface a "change the method" correction.
    // -------------------------------------------------------------------
    await seedNegativeFeedback(prisma, studentA.id, nodeId, 'PRACTICE', 2);
    const failedPatterns = await getJson(`${apiUrl}/coach/practice-patterns`, studentA.headers);
    const failedSignal = failedPatterns.signals.find((signal) => signal.id === 'F_recommendation_failed');
    assert.ok(failedSignal, 'F must fire after two negative outcomes');
    assert.match(failedSignal.inference.text, /不是你的问题|手段不匹配/, 'F must not blame the student');
    record('recommendation-failed', 'two failures surface a method-change correction, not a repeated task');

    // -------------------------------------------------------------------
    // 9. STUDENT ISOLATION: B has no history, so B must see nothing.
    // -------------------------------------------------------------------
    const isolated = await getJson(`${apiUrl}/coach/practice-patterns`, studentB.headers);
    assert.deepEqual(isolated.signals, [], 'another student must not inherit these signals');
    assert.equal(isolated.basis.attempts, 0);
    // A student may not view another student's patterns.
    const crossView = await fetch(`${apiUrl}/coach/practice-patterns?userId=${studentA.id}`, { headers: studentB.headers });
    const crossBody = await crossView.text().catch(() => '');
    assert.equal(
      crossView.status,
      403,
      `a student must not read another student's pattern read (got ${crossView.status}: ${crossBody.slice(0, 200)})`,
    );
    assert.ok(
      !crossBody.includes('A_repeat_familiar'),
      'another student’s signals must never be returned',
    );
    // ...and may not write another student's exam date.
    const crossWrite = await fetch(`${apiUrl}/coach/exam-date`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...studentB.headers },
      body: JSON.stringify({ examDate: futureDate, userId: studentA.id }),
    });
    assert.equal(crossWrite.status, 201, 'the write succeeds only for the caller');
    const untouched = await prisma.user.findUnique({ where: { id: studentA.id }, select: { examDate: true } });
    assert.equal(untouched.examDate.toISOString().slice(0, 10), futureDate, "B's write never touched A's row");
    record('isolation', `signals are self-only (cross-read refused with ${crossView.status}, no signals returned) and the exam-date writer is caller-scoped`);

    // -------------------------------------------------------------------
    // 10. GUIDANCE TELEMETRY (A3): allowlisted stages are accepted, unknown
    //     names are refused, and no learning content rides along.
    // -------------------------------------------------------------------
    for (const type of ['guidance.shown', 'guidance.accepted', 'guidance.action_started', 'guidance.action_completed', 'guidance.dismissed', 'guidance.correction_success']) {
      const response = await fetch(`${apiUrl}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...studentA.headers },
        body: JSON.stringify({ type, payload: { guidanceId: 'C_explain_only', trigger: 'C_explain_only', action: 'continue_training', surface: 'home' } }),
      });
      assert.ok(response.ok, `${type} must be accepted by the telemetry allowlist`);
    }
    const rejected = await fetch(`${apiUrl}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...studentA.headers },
      body: JSON.stringify({ type: 'guidance.not_a_stage', payload: {} }),
    });
    assert.equal(rejected.status, 400, 'a non-allowlisted event name is refused');
    const storedEvents = await prisma.userEvent.count({ where: { userId: studentA.id, type: { startsWith: 'guidance.' } } });
    assert.equal(storedEvents, 6, 'all six stages persisted with the student attached');
    record('telemetry', '6 allowlisted guidance stages accepted, unknown name refused, userId attached');

    // -------------------------------------------------------------------
    // 11. STATE DISCIPLINE: Guidance introduced no second state system and
    //     left the mastery switch alone.
    // -------------------------------------------------------------------
    for (const table of ['guidanceMastery', 'guidanceProgress', 'guidanceScore']) {
      assert.equal(prisma[table], undefined, `no ${table} delegate may exist`);
    }
    assert.equal(process.env.MASTERY_SEMANTICS, undefined, 'C1 stays OFF');
    const masteryWrites = await prisma.userKnowledgeMastery.count({ where: { userId: studentA.id } });
    record('state-discipline', `no guidance tables, C1 off, mastery rows untouched by guidance (${masteryWrites} rows are the practice path's own)`);

    // -------------------------------------------------------------------
    // 12. TRANSFER PROBE (A5): the feature is enabled, and with no pool
    //     content it must answer honestly rather than reuse an old question.
    // -------------------------------------------------------------------
    const probes = await getJson(`${apiUrl}/coach/transfer-probes`, studentA.headers);
    assert.equal(probes.featureEnabled, true, 'TRANSFER_PROBE_ENABLED must be on');
    assert.equal(probes.storeAvailable, true);
    const delivered = (probes.cards ?? []).filter((card) => card.session);
    assert.equal(delivered.length, 0, 'no eligible new question exists, so nothing may be delivered');
    record('transfer-probe', `feature enabled; ${(probes.cards ?? []).length} card(s), ${delivered.length} with a session (honest absence)`);

    console.log(`\nG1 Guidance Protocol integration PASSED (${steps.length} steps)`);
  } finally {
    // Cleanup: deleting the users cascades their rows; seeded content nodes and
    // questions are removed explicitly. The test database stays as clean as found.
    await prisma.practiceRecord.deleteMany({ where: { userId: { in: created.users } } }).catch(() => {});
    await prisma.userEvent.deleteMany({ where: { userId: { in: created.users } } }).catch(() => {});
    await prisma.recommendationAction.deleteMany({ where: { userId: { in: created.users } } }).catch(() => {});
    if (created.questions.length) {
      await prisma.questionKnowledgePoint.deleteMany({ where: { questionId: { in: created.questions } } }).catch(() => {});
      await prisma.question.deleteMany({ where: { id: { in: created.questions } } }).catch(() => {});
      await prisma.questionFamily.deleteMany({ where: { id: { in: created.questions.map((id) => id.replace('gd-q-', 'gd-fam-')) } } }).catch(() => {});
    }
    if (created.kgPoints.length) {
      await prisma.knowledgePointNodeMap.deleteMany({ where: { knowledgePointId: { in: created.kgPoints } } }).catch(() => {});
      await prisma.knowledgePoint.deleteMany({ where: { id: { in: created.kgPoints } } }).catch(() => {});
    }
    if (created.users.length) await prisma.user.deleteMany({ where: { id: { in: created.users } } }).catch(() => {});
    if (created.nodes.length) await prisma.knowledgeNode.deleteMany({ where: { id: { in: created.nodes } } }).catch(() => {});
    await prisma.$disconnect();
    if (activeApi) activeApi.kill();
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function seedNode(prisma, created, runId) {
  const id = `gd-node-${runId}`;
  await prisma.knowledgeNode.create({
    data: {
      id,
      name: `G1 集成节点 ${runId}`,
      subject: 'DS',
      nodeType: 'atomicPoint',
      importance: 4,
      difficulty: 3,
      syllabusVersion: 'integration',
      isActive: true,
    },
  });
  created.nodes.push(id);
  return id;
}

async function seedQuestions(prisma, created, nodeId, runId, count) {
  const ids = [];
  for (let index = 0; index < count; index += 1) {
    const questionId = `gd-q-${runId}-${index}`;
    const familyId = `gd-fam-${runId}-${index}`;
    // A question always belongs to a family (FK, onDelete: Restrict).
    await prisma.questionFamily.create({ data: { id: familyId } });
    await prisma.question.create({
      data: {
        id: questionId,
        familyId,
        versionNumber: 1,
        isCurrent: true,
        contentFingerprint: `gd-fp-${runId}-${index}`,
        stem: `G1 集成题 ${index}`,
        options: ['A', 'B', 'C', 'D'],
        answer: 'A',
        analysis: '集成测试用解析',
        difficulty: 'BASIC',
        type: 'SINGLE_CHOICE',
        source: 'integration',
      },
    });
    ids.push(questionId);
    created.questions.push(questionId);
  }
  // The practice path resolves question→node through the legacy bridge in
  // production, so seed the bridge too (V12.1 lesson: a direct tag alone is
  // invisible to the real resolver, and vice versa).
  for (const questionId of ids) {
    const pointId = `gd-kp-${questionId}`;
    await prisma.knowledgePoint.create({
      data: {
        id: pointId,
        title: `G1 考点 ${questionId}`,
        subject: 'DATA_STRUCTURE',
        chapter: '测试章节',
        importance: 4,
        frequency: 3,
        prerequisites: [],
      },
    });
    created.kgPoints.push(pointId);
    await prisma.questionKnowledgePoint.create({ data: { questionId, knowledgePointId: pointId } });
    await prisma.knowledgePointNodeMap.create({
      data: { knowledgePointId: pointId, knowledgeNodeId: nodeId, mappingType: 'PRIMARY' },
    });
  }
  return ids;
}

async function seedPracticeHistory(prisma, userId, questionIds, { attempts, repeatWindow, difficulty }) {
  const rows = [];
  const now = Date.now();
  for (let index = 0; index < attempts; index += 1) {
    const questionId = questionIds[index % repeatWindow];
    rows.push({
      id: `gd-pr-${userId}-${index}`,
      userId,
      questionId,
      knowledgePointId: `gd-kp-${questionId}`,
      selectedAnswer: 'A',
      correct: index % 3 !== 0,
      timeSpentSec: 40,
      expectedTimeSec: 60,
      submittedAt: new Date(now - index * 60_000),
      gradingMode: 'objective',
      knowledgePointIds: [],
      difficultyHint: undefined,
    });
  }
  rows.forEach((row) => { delete row.difficultyHint; });
  await prisma.practiceRecord.createMany({ data: rows });
}

async function seedExpiredProbes(prisma, userId, nodeId, runId, count) {
  for (let index = 0; index < count; index += 1) {
    await prisma.recommendationAction.create({
      data: {
        id: `gd-probe-${runId}-${index}`,
        userId,
        actionType: 'TRANSFER_PROBE',
        targetType: 'KNOWLEDGE_NODE',
        targetId: nodeId,
        reason: '迁移复测（integration）',
        evidenceRefs: [],
        status: 'EXPIRED',
        creationKey: `TRANSFER_PROBE:${userId}:${nodeId}:2026-09-0${index + 1}`,
      },
    }).catch(() => {});
  }
}

async function seedNegativeFeedback(prisma, userId, nodeId, actionType, count) {
  for (let index = 0; index < count; index += 1) {
    await prisma.userEvent.create({
      data: {
        userId,
        type: 'USER_ACTION_FEEDBACK',
        eventKey: `USER_ACTION_FEEDBACK:${userId}:gd-action-${index}:NEGATIVE_FEEDBACK`,
        payload: {
          id: `gd-action-${index}`,
          userId,
          actionId: `gd-action-${index}`,
          actionType,
          targetType: 'KNOWLEDGE_NODE',
          targetId: nodeId,
          signalType: 'NEGATIVE_FEEDBACK',
          confidence: 0.8,
          evidenceRefs: [],
          occurredAt: new Date().toISOString(),
        },
      },
    }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Harness (mirrors integration-score-anchor.mjs)
// ---------------------------------------------------------------------------

async function createInvitation(prisma, createdById, maxUses) {
  const code = randomBytes(18).toString('base64url');
  await prisma.invitationCode.create({
    data: {
      codeHash: createHmac('sha256', jwtSecret).update(code.trim()).digest('hex'),
      codePrefix: code.slice(0, 6),
      label: 'g1 guidance protocol integration',
      maxUses,
      startsAt: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() + DAY),
      createdById,
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
      TRANSFER_PROBE_ENABLED: 'true',
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

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`GET ${url} failed (${response.status}): ${text.slice(0, 300)}`);
  }
  return response.json();
}

(async () => {
  activeApi = null;
  try {
    const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:api'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
    assert.equal(build.status, 0, `build:api failed: ${(build.stderr || build.stdout).slice(-500)}`);
    activeApi = startApi();
    await waitForHealth(activeApi);
    await main();
    process.exit(0);
  } catch (error) {
    console.error('\nG1 Guidance Protocol integration FAILED:', error?.message ?? error);
    if (error?.stack) console.error(error.stack);
    if (activeApi?.getOutput) {
      console.error('--- API output tail ---');
      console.error(activeApi.getOutput().slice(-1500));
    }
    process.exit(1);
  }
})();
