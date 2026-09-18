/**
 * LARGE-QUESTION TRAINING-CHAIN ACCEPTANCE HARNESS (Long-Horizon v2.0 §12/§17).
 *
 * The four-subject harness proves the §32 chain for OBJECTIVE attempts. This
 * harness proves the chain for the 408 大题 — the loss half of the loop that
 * makes large questions first-class:
 *
 *   paper self-assessed 大题 (wrong, partial credit)
 *     → PracticeRecord (self_assessed) + ScoreLossItem PROXY (earned 2 / lost 4 / max 6)
 *     → controlled reason report (large_question_scoring_loss → schedule)
 *     → CONSUME: error-patterns (ALGORITHM row) → error-diagnosis
 *       (OBSERVED 2 + PROXY 4 on one finding, never merged)
 *     → CONSUME: training-prescription (ladder from the real ALGORITHM bank)
 *     → CONSUME: score-recovery (awaiting_reattempt)
 *   retest (self 6/6, correct)
 *     → mastery moves up → recovery flips awaiting → recovered (PROXY money
 *       tracked in its own lane, never merged into OBSERVED)
 *     → ScoreLoss ledger stays append-only (no new rows)
 *   F4 rubric offline attempt (the dedicated 大题 scoring channel)
 *     → rubric versioned + hashed, criteria detail, evidence recorded
 *     → CANARY: still invisible to error-patterns/diagnosis — the documented
 *       consumption gap (wiring it = Score/Evidence semantics = Owner Gate).
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
const jwtSecret = 'integration-large-question-chain-secret-0123456789';
process.env.DATABASE_URL = databaseUrl;

const runId = randomUUID().slice(0, 8);
const password = 'Large-Question-Chain-Password-1';

const ids = {
  admin: `lqc-admin-${runId}`,
  node: `lqc-node-${runId}`,
  point: `lqc-point-${runId}`,
  paper: `lqc-paper-${runId}`,
  big: `lqc-big-${runId}`,
  b1: `lqc-b1-${runId}`,
  m1: `lqc-m1-${runId}`,
  m2: `lqc-m2-${runId}`,
  student: null,
  studentEmail: null,
};

const rubric = {
  version: 1,
  totalPoints: 6,
  criteria: [
    {
      id: 'c1', description: '给出正确的时间复杂度推导', points: 3, required: true,
      evidenceHint: '答案需出现时间复杂度的量级与推导',
      matchAny: ['时间复杂度o(nlogn)', '时间复杂度为o(nlogn)', 'o(nlogn)'],
      knowledgeNodeIds: [],
    },
    {
      id: 'c2', description: '说明空间复杂度与优化方向', points: 3, required: false,
      evidenceHint: '答案需讨论空间开销',
      matchAny: ['空间复杂度', '额外空间'],
      knowledgeNodeIds: [],
    },
  ],
};

let activeApi = null;
let prisma = null;

const steps = [];
const pending = [];
function record(step, detail) {
  steps.push(`${step}: ${detail}`);
  console.log(`  ✓ ${step} — ${detail}`);
}
function markPending(step, detail) {
  pending.push(`${step}: ${detail}`);
  console.log(`  ⏸ ${step} — PENDING: ${detail}`);
}

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
      id: ids.admin, email: `${ids.admin}@integration.test`, name: 'LQC Admin', role: 'ADMIN',
      passwordHash: await hashPassword(password), trialStatus: 'ACTIVE', accountStatus: 'ACTIVE',
    },
  });
  await prisma.knowledgeNode.create({
    data: { id: ids.node, subject: 'DATA_STRUCTURE', nodeType: 'knowledge_point', name: `大题链节点 ${runId}`, importance: 4, difficulty: 3, syllabusVersion: 'test' },
  });
  await prisma.knowledgePoint.create({
    data: {
      id: ids.point, subject: 'DATA_STRUCTURE', chapter: 'LQC', title: '大题链考点',
      importance: 4, frequency: 4, prerequisites: [],
      nodeMaps: { create: { knowledgeNodeId: ids.node, mappingType: 'PRIMARY', confidence: 1 } },
    },
  });

  const question = (id, difficulty, extra = {}) => ({
    id, familyId: `lqc-fam-${id}`, versionNumber: 1, contentFingerprint: `fp-${id}`,
    stem: `大题链夹具 ${id}`, options: ['A', 'B', 'C', 'D'], answer: 'A', analysis: 'x',
    difficulty, type: 'SINGLE_CHOICE', source: 'integration', expectedTimeSec: 60,
    questionSubtype: 'ALGORITHM', maxScore: 2, ...extra,
  });
  const seed = async (id, difficulty, extra) => {
    await prisma.questionFamily.create({ data: { id: `lqc-fam-${id}` } });
    await prisma.question.create({ data: question(id, difficulty, extra) });
    await prisma.questionKnowledgePoint.create({ data: { questionId: id, knowledgePointId: ids.point } });
  };
  // The 大题 itself: legacy formal type COMPREHENSIVE (graded '综合题' at the
  // scoring chain) + 408 business subtype ALGORITHM, priced 6 (the extra spread
  // MUST carry maxScore — it overrides the base 2), versioned rubric.
  await seed(ids.big, 'MEDIUM', {
    type: 'COMPREHENSIVE', options: ['作答区'], answer: '', analysis: '参考解析：推导复杂度并讨论空间。',
    rubric, maxScore: 6,
  });
  // The ALGORITHM ladder pool (the prescription's same-type reservoir).
  await seed(ids.b1, 'BASIC');
  await seed(ids.m1, 'MEDIUM');
  await seed(ids.m2, 'MEDIUM');

  // Papers hydrate at boot: one 模拟卷 mixing the 大题 with one objective item
  // (the proven conservation shape from the question-scoring suite).
  await prisma.paper.create({
    data: {
      id: ids.paper, title: '大题链验收卷', paperType: '模拟卷', questionCount: 2,
      knowledgePointIds: [ids.point],
      questions: [
        { id: ids.big, stem: '大题链夹具 big', type: '综合题', options: ['作答区'], answer: '', analysis: '参考解析。' },
        { id: ids.m1, stem: '大题链夹具 m1', type: '单选题', options: ['A', 'B', 'C', 'D'], answer: 'A', analysis: 'x' },
      ],
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
  // Generous deadline: a fresh dist build can take >40s to boot on a cold
  // Windows filesystem (observed once as a false "did not become healthy").
  const deadline = Date.now() + 90_000;
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

async function masteryRow() {
  const map = await getJson(`${apiUrl}/knowledge/mastery`, ids.studentHeaders);
  return map.items.find((item) => item.knowledgeNodeId === ids.node) ?? null;
}

async function runJourney() {
  const invite = randomBytes(18).toString('base64url');
  await prisma.invitationCode.create({
    data: {
      codeHash: createHmac('sha256', jwtSecret).update(invite.trim()).digest('hex'),
      codePrefix: invite.slice(0, 6), label: 'large question chain',
      maxUses: 5, startsAt: new Date(Date.now() - 60_000), expiresAt: new Date(Date.now() + 86_400_000),
      createdById: ids.admin,
    },
  });
  ids.studentEmail = `lqc-student-${runId}@integration.test`;
  const registered = await postJson(`${apiUrl}/auth/register`, {
    email: ids.studentEmail, password, name: '大题链学生', inviteCode: invite,
  });
  ids.student = registered?.user?.id ?? registered?.id;
  await prisma.user.update({ where: { id: ids.student }, data: { trialStatus: 'ACTIVE', accountStatus: 'ACTIVE' } });
  const token = (await postJson(`${apiUrl}/auth/login`, { email: ids.studentEmail, password })).accessToken;
  ids.studentHeaders = { authorization: `Bearer ${token}` };

  await postJson(`${apiUrl}/onboarding/complete`, {
    examYear: 2027, targetScore: 110, currentScore: 60, remainingDays: 120, dailyHours: 3, weakestSubject: '数据结构',
  }, ids.studentHeaders);

  const emptyPatterns = await getJson(`${apiUrl}/coach/error-patterns?days=7`, ids.studentHeaders);
  assert.equal(emptyPatterns.totals.wrongCount, 0, 'clean account: no error evidence yet');
  assert.equal(await masteryRow(), null, 'clean account: no mastery row');
  record('day0', `registered + onboarded; evidence surface empty`);

  // ── Day 1 — first 大题 attempt through the REAL paper path ─────────────
  // The student self-scores 2/6 (<60% ⇒ wrong): partial credit on a large
  // question is PROXY loss, the objective sibling wrong is OBSERVED loss.
  // timeSpentSec stays within the expected budget: 300s is NORMAL for a 大题
  // but would trip the legacy slow→概念混淆 auto-label (kept for objective
  // questions in A1) — this harness pins the no-signal bucket, not that wart.
  const submission = await postJson(`${apiUrl}/papers/${ids.paper}/submit`, {
    answers: [
      { questionId: ids.big, selectedAnswer: '我的作答：只写了一半推导。', timeSpentSec: 60, selfScore: 2, maxScore: 6 },
      { questionId: ids.m1, selectedAnswer: 'X', timeSpentSec: 60 },
    ],
  }, ids.studentHeaders);
  assert.equal(submission.syncedPracticeRecordCount, 2);
  const day1Mastery = await masteryRow();
  assert.ok(day1Mastery && day1Mastery.attempts === 2, 'the paper produced two ability observations');
  record('day1-paper', `paper submitted: 大题 self 2/6 (wrong, partial) + objective wrong → ${submission.syncedPracticeRecordCount} records, mastery ${day1Mastery.mastery.toFixed(4)}`);

  // ScoreLoss ledger: PROXY vs OBSERVED in separate lanes (IL-6).
  const lossRows = await prisma.scoreLossItem.findMany({ where: { userId: ids.student } });
  const bigLoss = lossRows.find((row) => row.questionId === ids.big);
  const objLoss = lossRows.find((row) => row.questionId === ids.m1);
  assert.ok(bigLoss && bigLoss.lossKind === 'PROXY' && bigLoss.lostScore === 4 && bigLoss.earnedScore === 2
    && bigLoss.maxScore === 6 && bigLoss.gradingMethod === 'self_report',
    `大题 partial credit derives PROXY loss 4 (earned 2 / max 6); got ${JSON.stringify(bigLoss ?? null)}`);
  assert.ok(objLoss && objLoss.lossKind === 'OBSERVED' && objLoss.lostScore === 2, 'objective wrong derives OBSERVED loss 2');
  record('day1-loss', `ScoreLoss ledger: 大题 PROXY lost 4 (self_report) + objective OBSERVED lost 2 — lanes never merged`);

  // The student reports the reason through the controlled channel — the owner
  // taxonomy has a dedicated code for exactly this situation.
  await postJson(`${apiUrl}/wrong-questions/${ids.big}/reason`, {
    controlledReason: 'large_question_scoring_loss', redoCorrect: false, timeSpentSec: 60,
    isReview: false, idempotencyKey: `lqc-report-${runId}`,
  }, ids.studentHeaders);
  const schedule = await prisma.reviewSchedule.findUnique({
    where: { userId_questionId: { userId: ids.student, questionId: ids.big } },
  });
  assert.ok(schedule, 'the reason report created the review schedule');
  assert.equal(schedule.selfReportedReason, '大题采分点失分', 'the large-question reason persisted with its canonical label');
  const hoursToReview = (schedule.nextReviewAt.getTime() - Date.now()) / 3_600_000;
  assert.ok(hoursToReview > 23 && hoursToReview <= 25, `review scheduled ≈24h (${hoursToReview.toFixed(1)}h)`);
  record('day1-report', `controlled reason "large_question_scoring_loss" → schedule「大题采分点失分」, review ≈24h`);

  // CONSUME: patterns see the 大题 wrong attempt under its 408 subtype.
  const patterns = await getJson(`${apiUrl}/coach/error-patterns?days=7`, ids.studentHeaders);
  assert.equal(patterns.totals.wrongCount, 2, 'both wrong attempts are evidence');
  const patternRow = patterns.patterns.find((row) => row.nodeId === ids.node);
  assert.ok(patternRow && patternRow.count === 2 && patternRow.questionSubtype === 'ALGORITHM'
    && patternRow.subject === 'DATA_STRUCTURE',
    `pattern row: node × unclassified × ALGORITHM ×2, subject correct; got ${JSON.stringify(patternRow ?? null)}`);
  record('day1-patterns', `error-patterns → (数据结构 · ALGORITHM · unclassified) ×2 — the 大题 joins the objective sibling in one bucket`);

  // CONSUME: diagnosis carries BOTH money lanes on one finding, unmerged.
  const diagnosis = await getJson(`${apiUrl}/coach/error-diagnosis?days=7`, ids.studentHeaders);
  const finding = diagnosis.findings.find((row) => row.nodeId === ids.node);
  assert.ok(finding, 'diagnosis exposes the node finding');
  assert.equal(finding.count, 2);
  assert.equal(finding.questionSubtype, 'ALGORITHM');
  assert.equal(finding.observedLostScore, 2, 'OBSERVED lane = the objective wrong');
  assert.equal(finding.proxyLostScore, 4, 'PROXY lane = the 大题 partial credit');
  assert.equal(finding.confidence, 'low', 'count 2 ⇒ low sample-size confidence');
  record('day1-diagnosis', `diagnosis → count=2, OBSERVED 2 + PROXY 4 (separate lanes), confidence=low`);

  // CONSUME: the prescription prices the ladder against the real ALGORITHM
  // bank (big MEDIUM + 3 siblings ⇒ base pool 4 ⇒ basic 3 / same_type 2).
  const prescription = await getJson(`${apiUrl}/coach/training-prescription?days=7&nodeId=${encodeURIComponent(ids.node)}`, ids.studentHeaders);
  assert.equal(prescription.storeAvailable, true);
  assert.equal(prescription.target.questionSubtype, 'ALGORITHM');
  assert.equal(prescription.target.subject, 'DATA_STRUCTURE');
  assert.equal(prescription.difficultyAnchor, 'BASIC');
  assert.equal(prescription.ladder.find((step) => step.stage === 'basic').questionCount, 3);
  assert.equal(prescription.ladder.find((step) => step.stage === 'same_type').questionCount, 2);
  assert.equal(prescription.dataStatus, 'OK');
  record('day1-prescription', `prescription → ALGORITHM ladder basic=3/same_type=2 from the real bank, review 1d / retest 3d`);

  // CONSUME: the loss waits for a re-attempt.
  const recoveryBefore = await getJson(`${apiUrl}/coach/score-recovery?days=30`, ids.studentHeaders);
  const bigBefore = recoveryBefore.rows.find((row) => row.questionId === ids.big);
  const objBefore = recoveryBefore.rows.find((row) => row.questionId === ids.m1);
  assert.ok(bigBefore && bigBefore.status === 'awaiting_reattempt', '大题 loss awaits a re-attempt');
  assert.ok(objBefore && objBefore.status === 'awaiting_reattempt' && objBefore.observedLossOutstanding === 2);
  assert.equal(recoveryBefore.summary.awaitingQuestions, 2);
  record('day1-recovery', `score-recovery → 2 losses awaiting re-attempt (大题 4 proxy / objective 2 observed)`);

  // ── Day 3 — the retest: the student rewrites the 大题 fully (6/6) ──────
  const retest = await postJson(`${apiUrl}/practice-records`, {
    questionId: ids.big, knowledgePointId: ids.point, selectedAnswer: '完整作答：时间复杂度o(nlogn)，空间复杂度o(n)。',
    timeSpentSec: 300, selfScore: 6, maxScore: 6,
  }, { ...ids.studentHeaders, 'idempotency-key': `lqc-retest-${runId}` });
  assert.equal(retest.correct, true, 'a 6/6 self-scored retest grades correct');
  const day3Mastery = await masteryRow();
  assert.equal(day3Mastery.attempts, 3, 'retest recorded as the 3rd observation');
  assert.ok(day3Mastery.mastery > day1Mastery.mastery,
    `retest moves ability state up (${day1Mastery.mastery.toFixed(4)} → ${day3Mastery.mastery.toFixed(4)})`);

  const lossRowsAfter = await prisma.scoreLossItem.findMany({ where: { userId: ids.student } });
  assert.equal(lossRowsAfter.length, 2, 'the ledger stays append-only: a retest adds no loss rows');

  const recoveryAfter = await getJson(`${apiUrl}/coach/score-recovery?days=30`, ids.studentHeaders);
  const bigAfter = recoveryAfter.rows.find((row) => row.questionId === ids.big);
  const objAfter = recoveryAfter.rows.find((row) => row.questionId === ids.m1);
  assert.ok(bigAfter && bigAfter.status === 'recovered' && bigAfter.proxyLossWithReattemptSuccess === 4
    && bigAfter.observedLossOutstanding === 0,
    `大题 retest flips recovery to recovered, PROXY 4 tracked in its own lane; got ${JSON.stringify(bigAfter ?? null)}`);
  assert.ok(objAfter && objAfter.status === 'awaiting_reattempt' && objAfter.observedLossOutstanding === 2,
    'the objective loss the student never re-answered stays outstanding');
  assert.equal(recoveryAfter.summary.recoveredQuestions, 1);
  assert.equal(recoveryAfter.summary.awaitingQuestions, 1);
  record('day3-retest', `rewrote the 大题 (6/6) → mastery ${day3Mastery.mastery.toFixed(4)}, recovery: 大题 recovered (proxy 4) / objective still awaiting 2 — per-question discrimination`);

  // ── F4 rubric channel — the dedicated 大题 scoring path ────────────────
  const rubricView = await getJson(`${apiUrl}/questions/${ids.big}/rubric`, ids.studentHeaders);
  assert.equal(rubricView.hasRubric, true);
  assert.equal(rubricView.validation.valid, true);
  assert.ok(rubricView.rubricHash && rubricView.rubricHash.startsWith('rv1-'), `rubric versioned + hashed (${rubricView.rubricHash})`);

  const patternsBeforeF4 = await getJson(`${apiUrl}/coach/error-patterns?days=7`, ids.studentHeaders);
  const f4Attempt = await postJson(`${apiUrl}/questions/${ids.big}/subjective-attempt`, {
    answerText: '我的推导：时间复杂度o(nlogn)。',
  }, ids.studentHeaders);
  assert.equal(f4Attempt.score.score, 3, 'offline rubric scoring: criterion 1 hit ⇒ 3/6');
  assert.equal(f4Attempt.score.verdict, 'partial');
  assert.equal(f4Attempt.score.criticalMiss, false, 'the required criterion was hit');
  assert.equal(f4Attempt.score.criteria[0].matched, true);
  assert.equal(f4Attempt.score.criteria[1].awarded, 0);
  assert.equal(f4Attempt.score.rubricVersion, 1);
  assert.equal(f4Attempt.evidenceRecorded, true, 'the rubric-scored attempt is recorded as evidence');
  record('f4-attempt', `F4 offline scoring → 3/6 partial (criterion detail + rubric hash), evidence recorded (${f4Attempt.evidenceKey.slice(0, 12)}…)`);

  // CANARY — the documented consumption gap. The rubric-scored attempt is an
  // evidence EVENT only: no PracticeRecord, no ScoreLoss row, so the training
  // chain cannot see it. If this assert ever fails, someone wired F4 into the
  // chain — that is a Score/Evidence semantics change (Owner Gate) and this
  // harness must be consciously updated to assert the new consumption.
  const patternsAfterF4 = await getJson(`${apiUrl}/coach/error-patterns?days=7`, ids.studentHeaders);
  assert.equal(patternsAfterF4.totals.wrongCount, patternsBeforeF4.totals.wrongCount,
    'F4 attempts are still invisible to the wrong-attempt evidence surface (documented gap, Owner-gated wiring)');
  const diagnosisAfterF4 = await getJson(`${apiUrl}/coach/error-diagnosis?days=7`, ids.studentHeaders);
  assert.equal(diagnosisAfterF4.findings.find((row) => row.nodeId === ids.node).count, finding.count,
    'F4 attempts change no diagnosis count');
  markPending('F4-consumption', `rubric-scored attempts reach NO training-chain consumer (patterns/diagnosis/score-loss/mastery) — wiring them = Score/Evidence semantics decision, Owner Gate (see report)`);

  const anonRubric = await fetch(`${apiUrl}/questions/${ids.big}/rubric`);
  assert.equal(anonRubric.status, 401);
  const anonAttempt = await fetch(`${apiUrl}/questions/${ids.big}/subjective-attempt`, { method: 'POST' });
  assert.equal(anonAttempt.status, 401);
  record('guards', 'unauthenticated rubric read + attempt submit → 401');
}

async function runCleanup() {
  try {
    if (prisma && !process.env.KEEP_FIXTURES) {
      await prisma.invitationRedemption.deleteMany({ where: { user: { email: { endsWith: `${runId}@integration.test` } } } }).catch(() => {});
      await prisma.invitationRedemption.deleteMany({ where: { user: { id: ids.admin } } }).catch(() => {});
      await prisma.invitationCode.deleteMany({ where: { createdBy: { id: ids.admin } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { email: { endsWith: `${runId}@integration.test` } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: ids.admin } }).catch(() => {});
      await prisma.paper.deleteMany({ where: { id: ids.paper } }).catch(() => {});
      await prisma.question.deleteMany({ where: { id: { contains: runId } } }).catch(() => {});
      await prisma.questionFamily.deleteMany({ where: { id: { startsWith: 'lqc-fam-' } } }).catch(() => {});
      await prisma.knowledgePoint.deleteMany({ where: { id: ids.point } }).catch(() => {});
      await prisma.knowledgeNode.deleteMany({ where: { id: ids.node } }).catch(() => {});
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
    await seedBeforeBoot();
    activeApi = startApi();
    await waitForHealth(activeApi);
    await runJourney();
    console.log(`\nLARGE-QUESTION TRAINING-CHAIN HARNESS PASSED (${steps.length} stages, ${pending.length} PENDING)`);
    for (const item of pending) console.log(`  ⏸ ${item}`);
    await runCleanup();
    process.exit(0);
  } catch (error) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    console.error('\nLARGE-QUESTION TRAINING-CHAIN HARNESS FAILED:', error?.message ?? error);
    if (activeApi?.getOutput) console.error(activeApi.getOutput().slice(-8000));
    await runCleanup();
    process.exit(1);
  }
})();
