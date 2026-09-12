/**
 * S2 Transfer Probe — end-to-end over real HTTP + real PostgreSQL.
 *
 * Drives the whole formal-design chain for real students:
 *
 *   intervention completed → lazy scheduling (+48h window) → delivery of a
 *   NEVER-SEEN pool question → probe attempt via the canonical session submit
 *   path → atomic transfer evidence → canonical mastery propagation →
 *   transfer observation/summary projection
 *
 * Plus every rejection the eligibility rules promise: already-seen,
 * exposure-only, same-family, difficulty mismatch, duplicate scheduling,
 * duplicate submission, student isolation, no_probe_available, probe_expired.
 *
 * Prerequisite: docker compose -f compose.test.yml up -d --wait
 */

import { spawn, spawnSync } from 'node:child_process';
import { randomUUID, createHmac, randomBytes } from 'node:crypto';
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
const jwtSecret = 'integration-transfer-probe-secret-0123456';
process.env.DATABASE_URL = databaseUrl;

const runId = randomUUID().slice(0, 8);
const DAY = 86_400_000;
const HOUR = 3_600_000;
const password = 'Transfer-Probe-Integration-Password-1';

const ids = {
  admin: `tp-admin-${runId}`,
  node: `tp-node-${runId}`,
  nodeHard: `tp-node-hard-${runId}`,
  nodeEmpty: `tp-node-empty-${runId}`,
  point: `tp-point-${runId}`,
  family: `tp-family-${runId}`,
  familyPractice: `tp-family-practice-${runId}`,
  familyHard: `tp-family-hard-${runId}`,
  familyHard2: `tp-family-hard2-${runId}`,
  familyEmpty: `tp-family-empty-${runId}`,
  practiceQuestion: `tp-q-practice-${runId}`,
  poolQuestionA: `tp-q-pool-a-${runId}`,
  sameFamilyQuestion: `tp-q-family-${runId}`,
  hardQuestion: `tp-q-hard-${runId}`,
  basicQuestion: `tp-q-basic-${runId}`,
  emptyQuestion: `tp-q-empty-${runId}`,
  students: {},
};

const steps = [];
function record(step, detail) {
  steps.push(`${step}: ${detail}`);
  console.log(`  ✓ ${step} — ${detail}`);
}

let activeApi = null;

async function main(prisma, invite) {
  const createdUsers = [];
  try {
    // -----------------------------------------------------------------
    // 1. Seed admin + content.
    // -----------------------------------------------------------------

    // -----------------------------------------------------------------
    // 2. Students A..F via the real invitation flow.
    // -----------------------------------------------------------------
    const invite = await createInvitation(prisma, ids.admin, 10);
        const authSleep = () => new Promise((resolve) => setTimeout(resolve, 6500));
    const register = async (name) => {
      await authSleep();
      const credentials = { email: `tp-${name}-${runId}@integration.test`, password, name, inviteCode: invite };
      const registered = await postJson(`${apiUrl}/auth/register`, credentials);
      const userId = registered?.user?.id ?? registered?.id;
      assert.ok(userId, 'register must return the student id');
      await prisma.user.update({ where: { id: userId }, data: { trialStatus: 'ACTIVE', accountStatus: 'ACTIVE' } });
      createdUsers.push(userId);
      await authSleep();
      const login = await postJson(`${apiUrl}/auth/login`, { email: credentials.email, password });
      return { userId, headers: { authorization: `Bearer ${login.accessToken}` } };
    };
    const students = [];
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f']) students.push(await register(name));
    const [studentA, studentB, studentC, studentD, studentE, studentF] = students;
    ids.students = Object.fromEntries(students.map((s, i) => [['a', 'b', 'c', 'd', 'e', 'f'][i], s.userId]));
    await authSleep();
    const adminToken = (await postJson(`${apiUrl}/auth/login`, { email: `${ids.admin}@integration.test`, password })).accessToken;
    const adminHeaders = { authorization: `Bearer ${adminToken}` };

    assert.equal((await fetch(`${apiUrl}/coach/transfer-probes`)).status, 401);
    record('route-guard', 'GET /coach/transfer-probes without a token is 401');

    // A completed intervention = plan + task done 38h ago (lazy scheduler input).
    //
    // FIXTURE BUG (repaired): this used to be `Date.now() - 40 * HOUR`, which is
    // not a stable fixture. The scheduler derives the delivery day as
    // `probeDayKey(completedAt) + TRANSFER_PROBE_WINDOWS.targetDaysAfter` in the
    // probe timezone, so a *relative* offset lands on a different calendar day
    // depending on what time of day the suite runs: at 15:29 local, `now - 40h`
    // is two calendar days back and the probe is due today; at 16:29 it is only
    // one calendar day back and the probe is scheduled for tomorrow, so student A
    // receives no card and the suite fails. The production scheduler is correct
    // and unchanged — only the fixture's date anchoring was wrong.
    //
    // The anchor below pins `completedAt` to 00:30 on the Shanghai calendar day
    // exactly two days back, so the derived delivery day is always today while
    // the elapsed time stays ≥ 47.5h and therefore always clears the 36h guard.
    const PROBE_TIME_ZONE = 'Asia/Shanghai';
    const MIN_ELAPSED_HOURS = 36;

    function probeDayKey(date) {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: PROBE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(date);
    }

    /** Calendar-day arithmetic on a `YYYY-MM-DD` key. */
    function shiftDayKey(dayKey, days) {
      const [year, month, day] = dayKey.split('-').map(Number);
      const shifted = new Date(Date.UTC(year, month - 1, day + days));
      return [
        shifted.getUTCFullYear(),
        String(shifted.getUTCMonth() + 1).padStart(2, '0'),
        String(shifted.getUTCDate()).padStart(2, '0'),
      ].join('-');
    }

    const TODAY_KEY = probeDayKey(new Date());

    /**
     * An instant on the probe timezone's calendar day `daysBack` days ago, at
     * 00:30 local. Deterministic regardless of when the suite runs.
     */
    function anchoredInterventionCompletedAt(daysBack = 2, now = new Date()) {
      const targetDay = shiftDayKey(probeDayKey(now), -daysBack);
      return new Date(`${targetDay}T00:30:00+08:00`);
    }

    /** Self-check: the anchor must be due today and past the 36h guard. */
    for (const daysBack of [2, 12]) {
      const anchored = anchoredInterventionCompletedAt(daysBack);
      const elapsedHours = (Date.now() - anchored.getTime()) / HOUR;
      assert.ok(
        elapsedHours >= MIN_ELAPSED_HOURS,
        `fixture anchor ${daysBack}d back must clear the ${MIN_ELAPSED_HOURS}h guard (got ${elapsedHours.toFixed(1)}h)`,
      );
      assert.equal(
        shiftDayKey(probeDayKey(anchored), 2),
        shiftDayKey(probeDayKey(new Date()), -daysBack + 2),
        'the fixture anchor must be calendar-day stable',
      );
    }

    const completedIntervention = async (userId, nodeId, nodeName) => {
      const completedAt = anchoredInterventionCompletedAt(2);
      const plan = await prisma.studyPlan.create({
        data: { userId, source: 'score-center', status: 'ACTIVE', phase: 'integration', checkpoint: 'integration', modelVersion: 'integration', targetScore: 120, remainingDays: 96, dailyHours: 3.5 },
      });
      return prisma.studyTask.create({
        data: {
          planId: plan.id, knowledgePointId: ids.point, knowledgeNodeId: nodeId, subject: 'DATA_STRUCTURE',
          title: nodeName, mode: '练习', minutes: 20, questionCount: 3,
          // Inert for the scheduler (it reads `completedAt` only), kept coherent
          // with the anchor so the fixture does not advertise a stale date.
          scheduledDate: probeDayKey(completedAt),
          status: 'completed', completed: true, completedAt,
        },
      });
    };

    const practice = (headers, questionId, idem, answer = 'A') => postJson(`${apiUrl}/practice-records`, {
      questionId, knowledgePointId: ids.point, selectedAnswer: answer, timeSpentSec: 60, expectedTimeSec: 100,
    }, headers, { 'Idempotency-Key': idem });

    // -----------------------------------------------------------------
    // 3. Student A: valid probe.
    // -----------------------------------------------------------------
    await practice(studentA.headers, ids.practiceQuestion, `tp-a-practice-${runId}`);
    await completedIntervention(studentA.userId, ids.node, '迁移复测干预 A');
    const dueA = await getJson(`${apiUrl}/coach/transfer-probes`, studentA.headers);
    assert.equal(dueA.featureEnabled, true);
    console.error('DEBUG dueA:', JSON.stringify(dueA));
    const delivered = dueA.cards.find((card) => card.session);
    assert.ok(delivered, 'student A must receive a delivered probe card');
    assert.equal(delivered.session.question.id, ids.poolQuestionA, 'the delivered question is the pool probe');
    assert.ok(!('answer' in delivered.session.question) && !('analysis' in delivered.session.question), 'student-safe card');
    record('valid-probe', `delivered ${delivered.session.question.id} (never-seen pool question)`);

    await getJson(`${apiUrl}/coach/transfer-probes`, studentA.headers);
    const probeActionsA = await prisma.recommendationAction.findMany({
      where: { userId: studentA.userId, actionType: 'TRANSFER_PROBE' },
    });
    assert.equal(probeActionsA.length, 1, 'duplicate scheduling is impossible');
    record('duplicate-scheduling', 'a second scan created no second probe action');

    const observationB = await getJson(`${apiUrl}/coach/transfer-observation`, studentB.headers);
    assert.equal(observationB.events.length, 0, 'student B sees no probe events from student A');
    record('isolation', 'student B starts with an empty probe observation');

    // -----------------------------------------------------------------
    // 4. Duplicate submission + mastery propagation + projection.
    // -----------------------------------------------------------------
    const sessionId = delivered.session.sessionId;
    const submitPayload = {
      answers: [{ questionId: delivered.session.question.id, selectedAnswer: 'A', timeSpentSec: 45 }],
      totalActiveMs: 45_000,
    };
    const firstSubmit = await postJson(`${apiUrl}/sessions/practice/${sessionId}/submit`, submitPayload, studentA.headers);
    assert.equal(firstSubmit.records[0].correct, true, 'the probe attempt is judged through the canonical path');
    await postJson(`${apiUrl}/sessions/practice/${sessionId}/submit`, submitPayload, studentA.headers).catch(() => null);
    const recordsForQuestion = await prisma.practiceRecord.count({ where: { userId: studentA.userId, questionId: delivered.session.question.id } });
    assert.equal(recordsForQuestion, 1, 'duplicate submission cannot duplicate the attempt');
    const evidenceEvents = await prisma.userEvent.count({
      where: { userId: studentA.userId, type: 'EVIDENCE_RECORDED', payload: { path: ['detail', 'kind'], equals: 'transfer_probe' } },
    });
    assert.equal(evidenceEvents, 1, 'exactly one transfer evidence event per probe');
    record('duplicate-submission', 'one attempt, one evidence event, one probe');

    const mastery = await prisma.userKnowledgeMastery.findFirst({
      where: { userId: studentA.userId, knowledgeNodeId: ids.node },
    });
    assert.ok(mastery, 'mastery row exists for the node');
    assert.ok(mastery.attempts >= 2, `the probe attempt propagated into canonical mastery (attempts=${mastery.attempts})`);
    record('mastery', `canonical mastery attempts=${mastery.attempts} (practice + probe via applyAttempts)`);

    const observationA = await getJson(`${apiUrl}/coach/transfer-observation`, studentA.headers);
    assert.equal(observationA.events.length, 1);
    assert.equal(observationA.events[0].correct, true);
    const summary = await getJson(`${apiUrl}/coach/transfer-summary`, adminHeaders);
    assert.equal(summary.authoritative, false);
    const rowNode1 = summary.rows.find((row) => row.nodeId === ids.node);
    assert.ok(rowNode1, 'the node appears in the teacher summary');
    assert.equal(rowNode1.gate, 'insufficient_data', 'n=1 is below the preregistered floor');
    assert.equal(rowNode1.transferRate, null, 'no number below the gate');
    record('projection', `observation=1 event; summary gate=insufficient_data (honest)`);

    // -----------------------------------------------------------------
    // 5. Rejections.
    // -----------------------------------------------------------------
    await practice(studentA.headers, ids.sameFamilyQuestion, `tp-a-family-${runId}`, 'B');
    const laterTask = await completedIntervention(studentA.userId, ids.node, '迁移复测干预 A2');
    await prisma.studyTask.update({ where: { id: laterTask.id }, data: { completedAt: new Date(Date.now() - 2 * HOUR) } });
    await getJson(`${apiUrl}/coach/transfer-probes`, studentA.headers);
    const probeActionsA2 = await prisma.recommendationAction.count({
      where: { userId: studentA.userId, actionType: 'TRANSFER_PROBE' },
    });
    assert.equal(probeActionsA2, 1, 'same-node rescheduling within the spacing window is skipped');
    record('already-seen/spacing', 'second intervention on the node schedules nothing new');

    await prisma.learningSession.create({
      data: {
        id: `tp-exposure-${runId}`, userId: studentB.userId, type: 'practice_set',
        questionIds: [ids.poolQuestionA], questionSnapshot: [], answers: {},
        markedQuestions: [], currentIndex: 0, revision: 0, startedAt: new Date(), lastActiveAt: new Date(), totalActiveMs: 0, lastResumeAt: new Date(),
      },
    });
    await practice(studentB.headers, ids.practiceQuestion, `tp-b-practice-${runId}`);
    await completedIntervention(studentB.userId, ids.node, '迁移复测干预 B');
    const dueB = await getJson(`${apiUrl}/coach/transfer-probes`, studentB.headers);
    const deliveredB = dueB.cards.find((card) => card.session);
    assert.equal(deliveredB, undefined, 'exposure-only questions are NOT probe-eligible');
    assert.ok(dueB.cards.some((card) => card.reason === 'no_probe_available'), 'the failure mode is honest no_probe_available');
    record('exposure-rejection', 'seen-but-unsubmitted pool questions are ineligible');

    await practice(studentC.headers, ids.sameFamilyQuestion, `tp-c-family-${runId}`, 'C');
    await completedIntervention(studentC.userId, ids.node, '迁移复测干预 C');
    const dueC = await getJson(`${apiUrl}/coach/transfer-probes`, studentC.headers);

    const deliveredC = dueC.cards.find((card) => card.session);
    if (deliveredC) {
      // The verified pool (familyA) is burned by the same-family attempt, so
      // any delivery must be the honestly-labeled unverified fallback and must
      // never be a question from the burned family or an attempted question.
      assert.equal(deliveredC.isomorphism, 'unverified', 'the verified pool is burned — delivery is honestly labeled unverified');
      assert.notEqual(deliveredC.session.question.id, ids.poolQuestionA, 'the burned-family probe is never delivered');
      assert.notEqual(deliveredC.session.question.id, ids.sameFamilyQuestion, 'the attempted family member is never delivered');
    } else {
      assert.ok(dueC.cards.some((card) => card.reason === 'no_probe_available'), 'or an honest no_probe_available');
    }
    record('same-family-rejection', 'the whole question family is burned once seen');

    await practice(studentD.headers, ids.basicQuestion, `tp-d-practice-${runId}`);
    await completedIntervention(studentD.userId, ids.nodeHard, '难度失配干预 D');
    const dueD = await getJson(`${apiUrl}/coach/transfer-probes`, studentD.headers);
    assert.ok(dueD.cards.every((card) => !card.session), 'no bucket-crossing fallback exists');
    record('difficulty-rejection', 'HARD-only pool never serves a BASIC intervention');

    await practice(studentE.headers, ids.emptyQuestion, `tp-e-practice-${runId}`);
    await completedIntervention(studentE.userId, ids.nodeEmpty, '空池干预 E');
    const dueE = await getJson(`${apiUrl}/coach/transfer-probes`, studentE.headers);
    assert.ok(dueE.cards.some((card) => card.reason === 'no_probe_available' && !card.session));
    record('no-probe-available', 'an empty pool is an honest skip, never an old-question substitution');

    // A 12-day-old intervention with a same-window historical practice record
    // (direct seed): the scheduler compensates it, then the state machine
    // expires the probe because the delivery window closed long ago.
    const staleCompletedAt = anchoredInterventionCompletedAt(12);
    const stalePractice = await prisma.practiceRecord.create({
      data: {
        userId: studentF.userId, questionId: ids.practiceQuestion, knowledgePointId: ids.point,
        selectedAnswer: 'A', correct: true, timeSpentSec: 60, expectedTimeSec: 100,
        gradingMode: 'objective', submittedAt: new Date(staleCompletedAt.getTime() - DAY),
      },
    });
    await prisma.userKnowledgeMastery.upsert({
      where: { userId_knowledgeNodeId: { userId: studentF.userId, knowledgeNodeId: ids.node } },
      update: {}, create: { userId: studentF.userId, knowledgeNodeId: ids.node },
    });
    await prisma.studyTask.update({ where: { id: (await completedIntervention(studentF.userId, ids.node, '过期干预 F')).id }, data: { completedAt: staleCompletedAt } });
    void stalePractice;
    const dueF = await getJson(`${apiUrl}/coach/transfer-probes`, studentF.headers);
    assert.ok(dueF.cards.every((card) => !card.session), 'an out-of-window probe is not delivered');
    const expiredAction = await prisma.recommendationAction.findFirst({
      where: { userId: studentF.userId, actionType: 'TRANSFER_PROBE', status: 'EXPIRED' },
    });
    assert.ok(expiredAction, 'the stale probe expired honestly (EXPIRED, not failed)');
    record('probe-expired', 'window elapsed → EXPIRED (not a failure, no numbers)');

    // -----------------------------------------------------------------
    // 6. Authoritative surface check.
    // -----------------------------------------------------------------
    const assessmentCount = await prisma.assessmentHistoryItem.count({ where: { userId: { in: createdUsers } } });
    assert.equal(assessmentCount, 0, 'probes never fabricate assessment-history entries');
    const scoreOutcomes = await prisma.scoreOutcome.count({ where: { userId: { in: createdUsers } } });
    assert.equal(scoreOutcomes, 0, 'probes never fabricate score outcomes');
    const semantics = await prisma.userEvent.count({
      where: { userId: { in: createdUsers }, type: 'REVIEW_MASTERY_APPLIED' },
    });
    assert.equal(semantics, 0, 'no review-mastery semantics were touched by the probe flow');
    record('authoritative-check', 'assessmentHistory=0 scoreOutcome=0 reviewMastery=0 (probe writes stay probe-local)');

    console.log('\nS2 Transfer Probe integration: ALL PASS');
  } finally {
    await prisma.userEvent.deleteMany({ where: { userId: { in: [...createdUsers, ids.admin] } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [...createdUsers, ids.admin] } } }).catch(() => {});
    await prisma.knowledgeNode.deleteMany({ where: { id: { in: [ids.node, ids.nodeHard, ids.nodeEmpty] } } }).catch(() => {});
    await prisma.knowledgePoint.deleteMany({ where: { id: ids.point } }).catch(() => {});
    await prisma.question.deleteMany({ where: { id: { in: [ids.practiceQuestion, ids.poolQuestionA, ids.sameFamilyQuestion, ids.hardQuestion, ids.basicQuestion, ids.emptyQuestion] } } }).catch(() => {});
    for (const familyId of [ids.family, ids.familyPractice, ids.familyHard, ids.familyHard2, ids.familyEmpty]) {
      await prisma.questionFamily.deleteMany({ where: { id: familyId } }).catch(() => {});
    }
    await prisma.$disconnect();
    if (activeApi) activeApi.kill();
  }
}


/** Content + admin seeding runs BEFORE the API boots so the in-process
 * question memory (refreshed at boot) already contains the probe pool. */
async function seedContent(prisma) {
  // Residue from earlier failed runs: all seeded ids are 'tp-' prefixed, so a
  // prefix sweep makes the scenario deterministic without touching real data.
  await prisma.userEvent.deleteMany({ where: { type: 'EVIDENCE_RECORDED', payload: { path: ['detail', 'kind'], equals: 'transfer_probe' } } });
  await prisma.invitationRedemption.deleteMany({ where: { invitationCode: { createdById: { startsWith: 'tp-' } } } });
  await prisma.invitationCode.deleteMany({ where: { createdById: { startsWith: 'tp-' } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: 'tp-' } } });
  // questions before nodes (tags FK), families last (question FK)
  await prisma.question.deleteMany({ where: { id: { startsWith: 'tp-' } } });
  await prisma.knowledgeNode.deleteMany({ where: { id: { startsWith: 'tp-' } } });
  await prisma.knowledgePoint.deleteMany({ where: { id: { startsWith: 'tp-' } } });
  await prisma.questionFamily.deleteMany({ where: { id: { startsWith: 'tp-' } } });
  await prisma.user.upsert({
    where: { id: ids.admin },
    update: { passwordHash: await hashPassword(password), role: 'ADMIN', accountStatus: 'ACTIVE', trialStatus: 'ACTIVE' },
    create: {
      id: ids.admin, email: ids.admin + '@integration.test', name: 'Transfer Probe Admin',
      role: 'ADMIN', passwordHash: await hashPassword(password), trialStatus: 'ACTIVE', accountStatus: 'ACTIVE',
    },
  });

  const node = (id, name) => prisma.knowledgeNode.upsert({
    where: { id }, update: {}, create: {
      id, subject: 'DATA_STRUCTURE', nodeType: 'knowledge_point', name, importance: 4, difficulty: 3, syllabusVersion: '2026',
    },
  });
  const point = (id, title) => prisma.knowledgePoint.upsert({
    where: { id }, update: {}, create: { id, subject: 'DATA_STRUCTURE', chapter: 'integration', title, importance: 4, frequency: 4 },
  });
  await node(ids.node, '迁移复测节点 ' + runId);
  await node(ids.nodeHard, '难度失配节点 ' + runId);
  await node(ids.nodeEmpty, '空池节点 ' + runId);
  await point(ids.point, '迁移复测考点 ' + runId);
  await prisma.knowledgePointNodeMap.upsert({
    where: { knowledgePointId_knowledgeNodeId: { knowledgePointId: ids.point, knowledgeNodeId: ids.node } },
    update: {}, create: { knowledgePointId: ids.point, knowledgeNodeId: ids.node, mappingType: 'PRIMARY' },
  });
  for (const familyId of [ids.family, ids.familyPractice, ids.familyHard, ids.familyHard2, ids.familyEmpty]) {
    await prisma.questionFamily.upsert({ where: { id: familyId }, update: {}, create: { id: familyId } });
  }
  const question = (id, familyId, version, stem, difficulty, source) => prisma.question.upsert({
    where: { id }, update: {}, create: {
      id, familyId, versionNumber: version, contentFingerprint: id + '-' + runId, stem, options: ['A', 'B', 'C', 'D'], answer: 'A',
      analysis: 'integration seed', difficulty, type: 'SINGLE_CHOICE', source, expectedTimeSec: 100,
    },
  });
  await question(ids.practiceQuestion, ids.familyPractice, 1, '练习题：干预用题', 'MEDIUM', 'integration');
  // family = versions of one question: the pool probe is v1, the same-family
  // distractor is v2 — answering the distractor burns the whole family.
  await question(ids.poolQuestionA, ids.family, 1, '探针A：从未见过的同构新题', 'MEDIUM', 'transfer_probe_pool');
  await question(ids.sameFamilyQuestion, ids.family, 2, '同族干扰题（family v2）', 'MEDIUM', 'integration');
  await question(ids.hardQuestion, ids.familyHard, 1, 'HARD 池题', 'HARD', 'transfer_probe_pool');
  await question(ids.basicQuestion, ids.familyHard2, 1, 'BASIC 练习题（难度失配用）', 'BASIC', 'integration');
  await question(ids.emptyQuestion, ids.familyEmpty, 1, '空池节点练习题', 'MEDIUM', 'integration');
  for (const pair of [
    [ids.practiceQuestion, ids.node], [ids.poolQuestionA, ids.node],
    [ids.sameFamilyQuestion, ids.node], [ids.hardQuestion, ids.nodeHard],
    [ids.basicQuestion, ids.nodeHard], [ids.emptyQuestion, ids.nodeEmpty],
  ]) {
    await prisma.questionKnowledgeNodeTag.upsert({
      where: { questionId_knowledgeNodeId_role: { questionId: pair[0], knowledgeNodeId: pair[1], role: 'PRIMARY' } },
      update: {}, create: { questionId: pair[0], knowledgeNodeId: pair[1], role: 'PRIMARY' },
    });
  }
  await prisma.questionKnowledgePoint.upsert({
    where: { questionId_knowledgePointId: { questionId: ids.practiceQuestion, knowledgePointId: ids.point } },
    update: {}, create: { questionId: ids.practiceQuestion, knowledgePointId: ids.point },
  });
  // Pool questions carry legacy KnowledgePoint links too — every practiced
  // record requires a valid knowledgePointId (FK), exactly like real imports.
  for (const qId of [ids.poolQuestionA, ids.hardQuestion, ids.basicQuestion]) {
    await prisma.questionKnowledgePoint.upsert({
      where: { questionId_knowledgePointId: { questionId: qId, knowledgePointId: ids.point } },
      update: {}, create: { questionId: qId, knowledgePointId: ids.point },
    });
  }
  return createInvitation(prisma, ids.admin, 10);
}

// ---------------------------------------------------------------------------
// Harness (mirrors the sibling integration scripts)
// ---------------------------------------------------------------------------

async function createInvitation(prisma, createdById, maxUses) {
  const code = randomBytes(18).toString('base64url');
  await prisma.invitationCode.create({
    data: {
      codeHash: createHmac('sha256', jwtSecret).update(code.trim()).digest('hex'),
      codePrefix: code.slice(0, 6),
      label: 's2 transfer probe integration',
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
      PORT: '3270',
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
    if (child.exitCode != null) throw new Error(`API exited with ${child.exitCode}: ${child.getOutput?.().trim() ?? ''}`);
    try {
      if ((await fetch(`${apiUrl}/health`)).ok) return;
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`API did not become healthy in time: ${child.getOutput?.().slice(-2000) ?? ''}`);
}

async function postJson(url, body, headers = {}, extraHeaders = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers, ...extraHeaders },
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
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:api'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
    assert.equal(build.status, 0, `build:api failed: ${(build.stderr || build.stdout).slice(-500)}`);
    const migrate = spawnSync(npx, ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    assert.equal(migrate.status, 0, `migrate deploy failed: ${migrate.stderr || migrate.stdout}`);
    // Content seeding happens BEFORE the API boots: the in-process question
    // memory is refreshed at boot and must already contain the probe pool.
    const invite = await seedContent(prisma);
    activeApi = startApi();
    await waitForHealth(activeApi);
    await main(prisma, invite);
    process.exit(0);
  } catch (error) {
    console.error('\nS2 Transfer Probe integration FAILED:', error?.message ?? error);
    if (activeApi?.getOutput) {
      console.error('--- API output tail ---');
      console.error(activeApi.getOutput().slice(-1200));
    }
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
