/**
 * V12 FINAL — Score Improvement Loop end-to-end check.
 *
 * Mission section 30 requires more than proving each module exists: it requires
 * proving that DATA FLOWS THROUGH THE ENTIRE SYSTEM for one student. So this
 * script drives a single student through the whole chain over HTTP against a
 * real PostgreSQL, and asserts at every link that something real was written.
 *
 *   student → practice → mastery → evidence → review evidence
 *          → task completion evidence → recommendation exposure
 *          → assessment outcome → calibration → opportunity
 *
 * Every assertion is an invariant that must hold. Where a value depends on
 * product state that is legitimately variable (for example whether the engine
 * happened to emit a RecommendationAction), the script asserts the honest
 * invariant and reports the observed value instead of demanding a specific
 * number it cannot guarantee.
 *
 * Prerequisite: docker compose -f compose.test.yml up -d --wait
 */

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

// Reuse the API's own password hashing so the seeded admin can log in for real
// (rather than weakening the shadow endpoints' role guard to let a student in).
const require = createRequire(import.meta.url);
const { hashPassword } = require('../apps/api/dist/auth/password.js');

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const root = process.cwd();
const apiUrl = 'http://127.0.0.1:3210';
const databaseUrl = process.env.TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:55432/kaoyan408_test?schema=public';
const jwtSecret = 'integration-score-loop-secret-0123456789abcdef';
process.env.DATABASE_URL = databaseUrl;

const runId = randomUUID().slice(0, 8);
const DAY = 86_400_000;
const adminPassword = 'Loop-Integration-Admin-Password-1';

const ids = {
  admin: `loop-admin-${runId}`,
  node: `loop-node-${runId}`,
  point: `loop-point-${runId}`,
  family: `loop-family-${runId}`,
  question: `loop-question-${runId}`,
};

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
  let userId = null;
  try {
    // ---------------------------------------------------------------------
    // 1. Seed the content the loop needs (one node, one question, one snapshot)
    // ---------------------------------------------------------------------
    await prisma.user.upsert({
      where: { id: ids.admin },
      update: {
        passwordHash: await hashPassword(adminPassword),
        role: 'ADMIN',
        accountStatus: 'ACTIVE',
        trialStatus: 'ACTIVE',
      },
      create: {
        id: ids.admin,
        email: `${ids.admin}@integration.test`,
        name: 'Loop Invitation Admin',
        role: 'ADMIN',
        passwordHash: await hashPassword(adminPassword),
        trialStatus: 'ACTIVE',
        accountStatus: 'ACTIVE',
      },
    });

    await prisma.knowledgeNode.upsert({
      where: { id: ids.node },
      update: {},
      create: {
        id: ids.node,
        subject: 'DATA_STRUCTURE',
        nodeType: 'knowledge_point',
        name: `提分闭环节点 ${runId}`,
        importance: 5,
        difficulty: 3,
        syllabusVersion: '2026',
      },
    });
    await prisma.knowledgePoint.upsert({
      where: { id: ids.point },
      update: {},
      create: {
        id: ids.point,
        subject: 'DATA_STRUCTURE',
        chapter: 'integration',
        title: `提分闭环考点 ${runId}`,
        importance: 5,
        frequency: 5,
      },
    });
    await prisma.knowledgePointNodeMap.upsert({
      where: { knowledgePointId_knowledgeNodeId: { knowledgePointId: ids.point, knowledgeNodeId: ids.node } },
      update: {},
      create: { knowledgePointId: ids.point, knowledgeNodeId: ids.node, mappingType: 'PRIMARY' },
    });
    await prisma.knowledgeFrequencySnapshot.upsert({
      where: {
        knowledgeNodeId_snapshotDate_modelVersion: {
          knowledgeNodeId: ids.node,
          snapshotDate: new Date('2026-01-01T00:00:00.000Z'),
          modelVersion: 'v12-loop',
        },
      },
      update: {},
      create: {
        knowledgeNodeId: ids.node,
        snapshotDate: new Date('2026-01-01T00:00:00.000Z'),
        recent3Frequency: 5,
        recent5Frequency: 6,
        allTimeEvidence: 10,
        primaryScore5y: 12,
        trendDirection: 'RISING',
        trendDelta: 1.5,
        evidenceConfidence: 'HIGH',
        modelVersion: 'v12-loop',
      },
    });
    await prisma.questionFamily.upsert({ where: { id: ids.family }, update: {}, create: { id: ids.family } });
    await prisma.question.upsert({
      where: { id: ids.question },
      update: {},
      create: {
        id: ids.question,
        familyId: ids.family,
        contentFingerprint: `loop-${runId}`,
        stem: '提分闭环集成题',
        options: ['A', 'B', 'C', 'D'],
        answer: 'A',
        analysis: 'integration seed',
        difficulty: 'MEDIUM',
        type: 'SINGLE_CHOICE',
        source: 'integration',
      },
    });
    await prisma.questionKnowledgeNodeTag.upsert({
      where: {
        questionId_knowledgeNodeId_role: {
          questionId: ids.question,
          knowledgeNodeId: ids.node,
          role: 'PRIMARY',
        },
      },
      update: {},
      create: { questionId: ids.question, knowledgeNodeId: ids.node, role: 'PRIMARY' },
    });
    await prisma.questionKnowledgePoint.upsert({
      where: { questionId_knowledgePointId: { questionId: ids.question, knowledgePointId: ids.point } },
      update: {},
      create: { questionId: ids.question, knowledgePointId: ids.point },
    });
    record('seed', `node ${ids.node} + question ${ids.question} + frequency snapshot`);

    // ---------------------------------------------------------------------
    // 2. Boot the API against the real database
    // ---------------------------------------------------------------------
    activeApi = startApi();
    await waitForHealth(activeApi);
    record('boot', 'API healthy against PostgreSQL');

    // ---------------------------------------------------------------------
    // 3. Student starts (register through a real invitation)
    // ---------------------------------------------------------------------
    const invite = await createInvitation(prisma, ids.admin, 5);
    const credentials = {
      email: `loop-student-${runId}@integration.test`,
      password: 'Loop-Integration-Password-1',
      name: '提分闭环学生',
      inviteCode: invite,
    };
    const registered = await postJson(`${apiUrl}/auth/register`, credentials);
    userId = registered?.user?.id ?? registered?.id ?? null;
    assert.ok(userId, 'register must return the created student id');
    await prisma.user.update({
      where: { id: userId },
      data: { trialStatus: 'ACTIVE', accountStatus: 'ACTIVE', targetScore: 120 },
    });
    const login = await postJson(`${apiUrl}/auth/login`, {
      email: credentials.email,
      password: credentials.password,
    });
    const token = login?.accessToken ?? login?.token;
    assert.ok(token, 'login must return an access token');
    const headers = { authorization: `Bearer ${token}` };

    // The V12 shadow/calibration endpoints are model-quality instruments and are
    // teacher/admin only. Rather than weaken that, drive them with a real admin
    // session — which also verifies the role guard is actually enforced.
    await expectStatus(`${apiUrl}/coach/score-calibration`, headers, 403);
    record('role guard', 'student receives 403 on the teacher/admin shadow endpoints (guard enforced)');
    const adminLogin = await postJson(`${apiUrl}/auth/login`, {
      email: `${ids.admin}@integration.test`,
      password: adminPassword,
    });
    const adminToken = adminLogin?.accessToken ?? adminLogin?.token;
    assert.ok(adminToken, 'the seeded admin must be able to log in');
    const adminHeaders = { authorization: `Bearer ${adminToken}` };
    record('student', `registered and logged in as ${userId}`);

    // ---------------------------------------------------------------------
    // 4. Practice: a WRONG answer, so the wrong-question loop can start
    // ---------------------------------------------------------------------
    await postJson(`${apiUrl}/practice-records`, {
      questionId: ids.question,
      knowledgePointId: ids.point,
      selectedAnswer: 'B',
      correct: false,
      timeSpentSec: 90,
      expectedTimeSec: 100,
      confidence: '不确定',
    }, headers, { 'Idempotency-Key': `loop-wrong-${runId}` });

    const masteryAfterPractice = await prisma.userKnowledgeMastery.findUnique({
      where: { userId_knowledgeNodeId: { userId, knowledgeNodeId: ids.node } },
    });
    assert.ok(masteryAfterPractice, 'practice must create a mastery row (ability changed)');
    assert.equal(masteryAfterPractice.attempts, 1);
    assert.equal(masteryAfterPractice.wrongCount, 1);
    const snapshotAfterPractice = await prisma.userMasterySnapshot.findFirst({
      where: { userId, knowledgeNodeId: ids.node },
    });
    assert.ok(snapshotAfterPractice, 'practice must write a daily mastery snapshot');
    record(
      'practice → ability',
      `mastery=${masteryAfterPractice.mastery.toFixed(4)} attempts=${masteryAfterPractice.attempts} + snapshot`,
    );

    // ---------------------------------------------------------------------
    // 5. Review marked: activity evidence (EB-2)
    // ---------------------------------------------------------------------
    await postJson(`${apiUrl}/wrong-questions/${ids.question}/review`, {}, headers);
    const markedEvidence = await findEvidence(prisma, userId, 'review.marked');
    assert.ok(markedEvidence, 'marking a review must record learning evidence (EB-2)');
    assert.equal(markedEvidence.strength, 'none', 'a review tick is activity, not ability evidence');
    assert.equal(markedEvidence.canInfluenceMastery, false);
    record('review.marked', `evidence strength=${markedEvidence.strength} canInfluenceMastery=false`);

    // ---------------------------------------------------------------------
    // 6. Review with an observed redo: strong evidence
    // ---------------------------------------------------------------------
    await postJson(`${apiUrl}/wrong-questions/${ids.question}/reason`, {
      selfReportedReason: '概念混淆',
      redoCorrect: true,
      timeSpentSec: 60,
      isReview: true,
    }, headers);
    const recallEvidence = await findEvidence(prisma, userId, 'review.recalled');
    assert.ok(recallEvidence, 'an observed redo must record recall evidence');
    assert.equal(recallEvidence.strength, 'strong', 'an observed recall is strong evidence');
    assert.equal(recallEvidence.canInfluenceMastery, true);
    record('review.recalled', `strength=${recallEvidence.strength} canInfluenceMastery=${recallEvidence.canInfluenceMastery}`);

    // ---------------------------------------------------------------------
    // 7. Today plan → complete a task: completion evidence (EB-1)
    // ---------------------------------------------------------------------
    const todayPlan = await getJson(`${apiUrl}/today/plan`, headers);
    const plannedTask = (todayPlan?.priorityTasks ?? todayPlan?.tasks ?? [])[0] ?? null;
    let completedTaskId = null;
    if (plannedTask?.id) {
      await postJson(`${apiUrl}/study-tasks/${plannedTask.id}/complete`, {
        completedQuestionCount: 5,
        correctCount: 4,
        minutesSpent: 30,
        selfRating: 4,
      }, headers);
      completedTaskId = plannedTask.id;
      const taskEvidence = await findEvidence(prisma, userId, 'task.completed');
      assert.ok(taskEvidence, 'completing a task must record evidence (EB-1)');
      assert.equal(taskEvidence.strength, 'weak', 'self-reported numbers are weak evidence');
      assert.equal(taskEvidence.canInfluenceMastery, false, 'self-report must never move mastery');
      record('task.completed', `task ${completedTaskId} → strength=${taskEvidence.strength}`);
    } else {
      // Honest reporting rather than a silent skip: the plan produced no task.
      record('task.completed', 'SKIPPED — the generated plan contained no task to complete');
    }

    // ---------------------------------------------------------------------
    // 8. Recommendation exposure: did the student SEE it? (EB-3)
    // ---------------------------------------------------------------------
    await postJson(`${apiUrl}/events`, {
      type: 'recommendation.exposed',
      payload: { surface: 'today_mission', taskId: completedTaskId ?? ids.question },
    }, headers);
    const funnel = await getJson(`${apiUrl}/coach/recommendation-funnel`, headers);
    assert.ok(funnel?.funnel, 'the funnel endpoint must answer');
    assert.equal(funnel.funnel.summary.exposureTelemetryAvailable, true, 'exposure telemetry must now be available');
    record(
      'recommendation → exposure',
      `telemetry=${funnel.funnel.summary.exposureTelemetryAvailable} generated=${funnel.funnel.summary.generated} exposed=${funnel.funnel.summary.exposed}`,
    );

    // ---------------------------------------------------------------------
    // 9. Evidence ledger: the student can see what was observed
    // ---------------------------------------------------------------------
    const ledger = await getJson(`${apiUrl}/coach/learning-evidence`, headers);
    assert.ok(Array.isArray(ledger?.records), 'the ledger must return records');
    assert.ok(ledger.records.length >= 2, 'the ledger must contain the evidence written above');
    assert.ok(ledger.summary?.hasAbilityEvidence === true, 'an observed recall must count as ability evidence');
    assert.equal(ledger.summary.strong >= 1, true, 'at least one strong observation must be present');
    record('evidence ledger', `${ledger.summary.total} records, ${ledger.summary.strong} strong, ${ledger.summary.weak} weak, ${ledger.summary.none} activity-only`);

    // ---------------------------------------------------------------------
    // 10. Assessment outcome → calibration (EB-4)
    // ---------------------------------------------------------------------
    await prisma.assessmentHistoryItem.create({
      data: {
        id: `loop-assessment-${runId}`,
        userId,
        title: '提分闭环模考',
        submittedAt: new Date(Date.now() + 60_000),
        score: 96,
        totalScore: 150,
        accuracyRate: 64,
        elapsedSec: 5400,
        unansweredCount: 2,
        weakPointTitle: '顺序表',
        reviewSuggestion: '复盘错题',
      },
    });
    const calibration = await getJson(`${apiUrl}/coach/score-calibration?userId=${userId}`, adminHeaders);
    assert.ok(calibration, 'calibration endpoint must answer');
    assert.equal(calibration.authoritative, false, 'calibration is never authoritative');
    assert.equal(calibration.summary.pairedCount, 1, 'the recorded assessment must pair with a rebuilt prediction');
    const pairRow = calibration.rows[0];
    assert.equal(pairRow.actual, 96, 'the ACTUAL value must be the recorded score');
    assert.ok(pairRow.predicted != null, 'a prediction must have been rebuilt from pre-assessment facts');
    assert.ok(pairRow.error != null, 'the error must be reported separately from both sides');
    assert.match(pairRow.evidence.basis, /评估前/, 'the evidence behind the prediction must be stated');
    record(
      'assessment → calibration',
      `predicted=${pairRow.predicted} actual=${pairRow.actual} error=${pairRow.error} (MAE withheld below sample floor: ${calibration.summary.meanAbsoluteError === null})`,
    );

    // ---------------------------------------------------------------------
    // 11. Opportunity: why this point, with every factor sourced
    // ---------------------------------------------------------------------
    const opportunity = await getJson(`${apiUrl}/coach/score-opportunity?userId=${userId}`, adminHeaders);
    assert.ok(opportunity, 'opportunity endpoint must answer');
    assert.equal(opportunity.authoritative, false);
    assert.ok(Array.isArray(opportunity.opportunities), 'opportunities must be a list');
    assert.ok(opportunity.summary.candidatesEvaluated >= 1, 'the seeded node must be evaluated');
    if (opportunity.opportunities.length > 0) {
      const top = opportunity.opportunities[0];
      assert.equal(top.factors.length, 6, 'all six factors must be itemised');
      for (const factor of top.factors) {
        assert.ok(factor.source.length > 0, `${factor.key} must cite its data source`);
        assert.ok(factor.basis.length > 0, `${factor.key} must explain itself`);
      }
      record('opportunity', `top=${top.title} score=${top.score} confidence=${top.confidence} factors=${top.factors.length}`);
    } else {
      record('opportunity', `SKIPPED scoring — ${opportunity.summary.blocked} candidate(s) blocked for missing required factors`);
    }

    // ---------------------------------------------------------------------
    // 12. Review semantics shadow: the unification is measurable
    // ---------------------------------------------------------------------
    const shadow = await getJson(`${apiUrl}/coach/review-semantics-shadow?userId=${userId}`, adminHeaders);
    assert.ok(shadow, 'review shadow endpoint must answer');
    assert.equal(shadow.authoritative, false);
    const replayRow = (shadow.masteryReplay?.rows ?? []).find((row) => row.nodeId === ids.node);
    assert.ok(replayRow, 'the reviewed node must appear in the mastery replay');
    assert.ok(replayRow.observations >= 1, 'the observed redo must feed the replay');
    assert.ok(replayRow.replayMastery != null, 'the unified replay must produce an estimate');
    assert.equal(shadow.retention?.summary?.storedOptimistic >= 0, true);
    record(
      'review semantics shadow',
      `node observations=${replayRow.observations} stored=${replayRow.storedMastery} unified=${replayRow.replayMastery} direction=${replayRow.direction}`,
    );

    // ---------------------------------------------------------------------
    // 13. The chain is connected: one node, seen end to end
    // ---------------------------------------------------------------------
    assert.ok(masteryAfterPractice, 'chain: practice → mastery');
    assert.ok(markedEvidence && recallEvidence, 'chain: review → evidence');
    assert.ok(ledger.records.length >= 2, 'chain: evidence → ledger');
    assert.equal(calibration.summary.pairedCount, 1, 'chain: assessment → calibration');
    assert.ok(replayRow, 'chain: review → semantics shadow');
    record('chain', 'practice → mastery → evidence → ledger → exposure → assessment → calibration → shadow');

    console.log('');
    console.log(`[score-improvement-loop] ${steps.length} links verified end-to-end on real PostgreSQL`);
    console.log('[score-improvement-loop] assertions passed');
  } finally {
    if (activeApi && activeApi.exitCode == null) activeApi.kill();
    // Clean up only what this run created (unique ids keep other runs safe).
    if (userId) {
      await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
    }
    await prisma.user.deleteMany({ where: { id: ids.admin } }).catch(() => {});
    await prisma.question.deleteMany({ where: { id: ids.question } }).catch(() => {});
    await prisma.questionFamily.deleteMany({ where: { id: ids.family } }).catch(() => {});
    await prisma.knowledgePoint.deleteMany({ where: { id: ids.point } }).catch(() => {});
    await prisma.knowledgeNode.deleteMany({ where: { id: ids.node } }).catch(() => {});
    await prisma.$disconnect();
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function findEvidence(prisma, userId, action) {
  const rows = await prisma.userEvent.findMany({
    where: { userId, type: 'EVIDENCE_RECORDED' },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  for (const row of rows) {
    const payload = row.payload;
    if (payload && typeof payload === 'object' && !Array.isArray(payload) && payload.action === action) {
      return payload;
    }
  }
  return null;
}

async function createInvitation(prisma, createdById, maxUses) {
  const code = randomBytes(18).toString('base64url');
  await prisma.invitationCode.create({
    data: {
      codeHash: createHmac('sha256', jwtSecret).update(code.trim()).digest('hex'),
      codePrefix: code.slice(0, 6),
      label: 'v12 score improvement loop',
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
      PORT: '3210',
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
      if (response.ok) {
        const health = await response.json();
        if (health.dataSource === 'postgresql') return;
      }
    } catch {}
    await delay(400);
  }
  throw new Error(`Timed out waiting for API health: ${child.getOutput?.().trim() ?? ''}`);
}

async function postJson(url, body, headers = {}, extraHeaders = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers, ...extraHeaders },
    body: JSON.stringify(body ?? {}),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  assert.ok(
    response.ok,
    `POST ${url} failed with ${response.status}: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`,
  );
  return payload;
}

async function expectStatus(url, headers, expected) {
  const response = await fetch(url, { headers });
  assert.equal(
    response.status,
    expected,
    `${url} should return ${expected} for this role but returned ${response.status}`,
  );
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  assert.ok(
    response.ok,
    `GET ${url} failed with ${response.status}: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`,
  );
  return payload;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error('[score-improvement-loop] FAILED:', error.message);
  if (activeApi?.getOutput) {
    const output = activeApi.getOutput().trim();
    if (output) console.error(output.split('\n').slice(-25).join('\n'));
  }
  process.exitCode = 1;
});
