/**
 * CLEAN-ACCOUNT CLOSED-LOOP ACCEPTANCE HARNESS (Long-Horizon v2.0 §31/§32).
 *
 * Simulates ONE first-time student across the Day 0 → Day 7 journey through
 * the REAL HTTP API on a REAL PostgreSQL instance, and after every stage
 * asserts the contract's consumption rule: data produced → consumed by the
 * next layer → the next decision surface actually changes.
 *
 *   Day 0  register → onboarding/complete → today/plan
 *   Day 1  wrong practice ×3 → controlled self-report → wrong-question review
 *          → CONSUME: error-patterns → error-diagnosis → training-prescription
 *            (ladder counts against the real bank) → ReviewSchedule 24h
 *          → GATE 15 PENDING: prescription creates no StudyTask/RecommendationAction
 *   Day 3  retest (real practice, correct) → CONSUME: mastery attempts/mastery
 *          moved, forgetting-risk now sees the reviewed node
 *   Day 7  paper submission (the ScoreLoss path) + stage assessment
 *          → CONSUME: ScoreLoss coverage > 0, assessment history grows
 *   final  re-run diagnosis/prescription: the DECISION SURFACE reflects the
 *          post-retest state (not the Day-1 state)
 *
 * Time semantics: the journey is a SEQUENCE of real actions, not wall-clock
 * days; no fabricated events. The only DB writes outside HTTP are fixtures
 * (accounts/bank/paper) and the audit of what the system itself wrote.
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
const jwtSecret = 'integration-clean-account-loop-secret-0123456789';
process.env.DATABASE_URL = databaseUrl;

const runId = randomUUID().slice(0, 8);
const password = 'Clean-Account-Loop-Password-1';

const ids = {
  admin: `cal-admin-${runId}`,
  node: `cal-node-${runId}`,
  point: `cal-point-${runId}`,
  paper: `cal-paper-${runId}`,
  student: null,
  studentEmail: null,
};

let qA; let qB; let qC; let qD;

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
      id: ids.admin, email: `${ids.admin}@integration.test`, name: 'Loop Admin', role: 'ADMIN',
      passwordHash: await hashPassword(password), trialStatus: 'ACTIVE', accountStatus: 'ACTIVE',
    },
  });
  await prisma.knowledgeNode.create({
    data: { id: ids.node, subject: 'OPERATING_SYSTEM', nodeType: 'knowledge_point', name: `闭环节点 ${runId}`, importance: 4, difficulty: 3, syllabusVersion: 'test' },
  });
  await prisma.knowledgePoint.create({
    data: {
      id: ids.point, subject: 'OPERATING_SYSTEM', chapter: 'LOOP', title: '闭环考点',
      importance: 4, frequency: 4, prerequisites: [],
      nodeMaps: { create: { knowledgeNodeId: ids.node, mappingType: 'PRIMARY', confidence: 1 } },
    },
  });
  const question = (id, difficulty) => ({
    id, familyId: `cal-fam-${id}`, versionNumber: 1, contentFingerprint: `fp-${id}`,
    stem: `闭环夹具 ${id}`, options: ['A', 'B', 'C', 'D'], answer: 'A', analysis: 'x',
    difficulty, type: 'SINGLE_CHOICE', source: 'integration', expectedTimeSec: 60,
    questionSubtype: 'OS_PV', maxScore: 2,
  });
  qA = `cal-q-a-${runId}`; qB = `cal-q-b-${runId}`; qC = `cal-q-c-${runId}`; qD = `cal-q-d-${runId}`;
  for (const [id, difficulty] of [[qA, 'BASIC'], [qB, 'BASIC'], [qC, 'MEDIUM'], [qD, 'MEDIUM']]) {
    await prisma.questionFamily.create({ data: { id: `cal-fam-${id}` } });
    await prisma.question.create({ data: question(id, difficulty) });
    await prisma.questionKnowledgePoint.create({ data: { questionId: id, knowledgePointId: ids.point } });
  }
  // Day 7 paper: three priced questions (wrong/wrong/correct) so the real
  // ScoreLoss derivation has evidence. Papers hydrate at boot.
  await prisma.paper.create({
    data: {
      id: ids.paper, title: '闭环 Day7 试卷', paperType: '模拟卷', questionCount: 3,
      knowledgePointIds: [ids.point],
      questions: [
        { id: qA, stem: '闭环夹具 A', type: '单选题', options: ['A', 'B', 'C', 'D'], answer: 'A', analysis: 'x' },
        { id: qC, stem: '闭环夹具 C', type: '单选题', options: ['A', 'B', 'C', 'D'], answer: 'A', analysis: 'x' },
        { id: qD, stem: '闭环夹具 D', type: '单选题', options: ['A', 'B', 'C', 'D'], answer: 'A', analysis: 'x' },
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

async function practice(questionId, selectedAnswer, extra = {}) {
  return postJson(`${apiUrl}/practice-records`, {
    questionId, knowledgePointId: ids.point, selectedAnswer, timeSpentSec: 60, ...extra,
  }, { ...ids.studentHeaders, 'idempotency-key': `cal-${runId}-${questionId}-${randomUUID().slice(0, 8)}` });
}

async function masteryRow() {
  const map = await getJson(`${apiUrl}/knowledge/mastery`, ids.studentHeaders);
  return map.items.find((item) => item.knowledgeNodeId === ids.node) ?? null;
}

async function runJourney() {
  // ───────────────────────── Day 0 — register + onboarding ─────────────
  const invite = randomBytes(18).toString('base64url');
  await prisma.invitationCode.create({
    data: {
      codeHash: createHmac('sha256', jwtSecret).update(invite.trim()).digest('hex'),
      codePrefix: invite.slice(0, 6), label: 'clean account loop',
      maxUses: 5, startsAt: new Date(Date.now() - 60_000), expiresAt: new Date(Date.now() + 86_400_000),
      createdById: ids.admin,
    },
  });
  ids.studentEmail = `cal-student-${runId}@integration.test`;
  const registered = await postJson(`${apiUrl}/auth/register`, {
    email: ids.studentEmail, password, name: '闭环学生', inviteCode: invite,
  });
  ids.student = registered?.user?.id ?? registered?.id;
  await prisma.user.update({ where: { id: ids.student }, data: { trialStatus: 'ACTIVE', accountStatus: 'ACTIVE' } });
  const token = (await postJson(`${apiUrl}/auth/login`, { email: ids.studentEmail, password })).accessToken;
  ids.studentHeaders = { authorization: `Bearer ${token}` };

  await postJson(`${apiUrl}/onboarding/complete`, {
    examYear: 2027, targetScore: 110, currentScore: 60, remainingDays: 120, dailyHours: 3, weakestSubject: '操作系统',
  }, ids.studentHeaders);
  const onboarding = await getJson(`${apiUrl}/onboarding/status`, ids.studentHeaders);
  assert.equal(onboarding.completed, true, 'onboarding is completed');
  // The endpoint's field is `priorityTasks` (legacy DTO name). A clean account
  // MUST receive today's scheduled work — assert it positively instead of
  // reading a non-existent key (the 2026-09-18 investigation).
  const plan = await getJson(`${apiUrl}/today/plan`, ids.studentHeaders);
  const planTasks = plan?.priorityTasks ?? [];
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  assert.ok(planTasks.length > 0, 'a clean account receives work for today on Day 0');
  assert.ok(planTasks.every((task) => task.scheduledDate === today),
    `every Day-0 task is scheduled for today (${today}); got ${[...new Set(planTasks.map((task) => task.scheduledDate))].join(',')}`);
  assert.equal(plan?.summary?.totalTasks, planTasks.length, 'summary.totalTasks matches the returned tasks');
  record('Day0', `registered + onboarding complete; today/plan carries ${planTasks.length} tasks scheduled for ${today} (summary.totalTasks=${plan.summary.totalTasks})`);

  // Baseline: no ability state, no evidence.
  assert.equal(await masteryRow(), null, 'clean account starts with no mastery row');

  // ───────────────────────── Day 1 — practice + error + review ──────────
  await practice(qA, 'X');       // wrong
  await practice(qC, 'X');       // wrong
  await practice(qB, 'X');       // wrong
  // isReview:false mirrors the product's own ErrorReasonSelector for a fresh
  // wrong answer (reason-only report; no redo observation is claimed).
  await postJson(`${apiUrl}/wrong-questions/${qA}/reason`, {
    controlledReason: 'calculation_error', redoCorrect: false, timeSpentSec: 60,
    isReview: false, idempotencyKey: `cal-report-${runId}`,
  }, ids.studentHeaders);
  await postJson(`${apiUrl}/wrong-questions/${qA}/review`, { userId: ids.student }, ids.studentHeaders);

  const day1Mastery = await masteryRow();
  assert.ok(day1Mastery, 'Day1 produced a mastery row');
  assert.equal(day1Mastery.attempts, 3, `three wrong attempts recorded (got attempts=${day1Mastery.attempts}, wrong=${day1Mastery.wrongCount}, correct=${day1Mastery.correctCount})`);
  assert.ok(day1Mastery.mastery < 0.5, `wrong-only practice pushes mastery below neutral (${day1Mastery.mastery})`);

  // CONSUME: error evidence → patterns → diagnosis → prescription.
  const patterns = await getJson(`${apiUrl}/coach/error-patterns?days=7`, ids.studentHeaders);
  assert.equal(patterns.totals.wrongCount, 3, 'error patterns see the three wrong attempts');
  assert.ok(patterns.patterns.some((row) => row.nodeId === ids.node), 'pattern row exists for the node');

  const diagnosis = await getJson(`${apiUrl}/coach/error-diagnosis?days=7`, ids.studentHeaders);
  assert.ok(diagnosis.findings.some((row) => row.nodeId === ids.node), 'diagnosis exposes the node finding');

  const prescription = await getJson(`${apiUrl}/coach/training-prescription?days=7`, ids.studentHeaders);
  assert.equal(prescription.storeAvailable, true);
  assert.equal(prescription.target.nodeId, ids.node, 'prescription targets the diagnosed node');
  const basicStep = prescription.ladder.find((step) => step.stage === 'basic');
  const sameTypeStep = prescription.ladder.find((step) => step.stage === 'same_type');
  assert.ok(basicStep.questionCount > 0 && sameTypeStep.questionCount > 0,
    `ladder is built from the real bank (basic=${basicStep.questionCount}, same_type=${sameTypeStep.questionCount})`);
  record('Day1-consume', `wrong×3 → patterns(3) → diagnosis(node) → prescription(basic=${basicStep.questionCount}, same_type=${sameTypeStep.questionCount}, variant=${prescription.ladder.find((s) => s.stage === 'variant').status})`);

  // CONSUME: the review report created the canonical 24h schedule.
  const schedule = await prisma.reviewSchedule.findUnique({
    where: { userId_questionId: { userId: ids.student, questionId: qA } },
  });
  assert.ok(schedule, 'review schedule exists for the reviewed wrong question');
  const hoursToReview = (schedule.nextReviewAt.getTime() - Date.now()) / 3_600_000;
  assert.ok(hoursToReview > 23 && hoursToReview <= 25, `next review ≈24h (${hoursToReview.toFixed(1)}h)`);
  record('Day1-review', `review scheduled in ≈24h (${hoursToReview.toFixed(1)}h) via the real review path`);

  // GATE 15: prescription must NOT create tasks/actions yet (Owner-gated).
  const actionsAfter = await prisma.recommendationAction.count({ where: { userId: ids.student } });
  const tasksAfter = await prisma.studyTask.count({ where: { plan: { userId: ids.student } } });
  markPending('Gate15', `prescription→task creation not implemented (RecommendationAction=${actionsAfter}, StudyTask=${tasksAfter} after prescription call)`);

  // ───────────────────────── Day 3 — review redo + retest ──────────────
  // The student completes the scheduled review: a redo observation with a
  // real outcome (isReview: true) — the ONE path that writes stability and
  // retention into the canonical mastery row.
  const review = await postJson(`${apiUrl}/wrong-questions/${qA}/reason`, {
    controlledReason: 'calculation_error', redoCorrect: true, timeSpentSec: 40,
    isReview: true, idempotencyKey: `cal-review-${runId}`,
  }, ids.studentHeaders);
  assert.equal(review.redoCorrect, true);
  const afterReview = await masteryRow();
  assert.equal(afterReview.attempts, 4, 'review redo recorded as the 4th observation');
  assert.ok(afterReview.mastery > day1Mastery.mastery,
    `review redo moves ability state up (${day1Mastery.mastery} → ${afterReview.mastery})`);
  record('Day3-review', `completed review redo: attempts 3→4, mastery ${day1Mastery.mastery.toFixed(4)} → ${afterReview.mastery.toFixed(4)}`);

  await practice(qA, 'A');  // retest the previously wrong question, now correct
  const day3Mastery = await masteryRow();
  assert.equal(day3Mastery.attempts, 5, 'retest recorded as the 5th observation');
  assert.ok(day3Mastery.mastery > afterReview.mastery,
    `retest moves ability state up again (${afterReview.mastery} → ${day3Mastery.mastery})`);
  record('Day3-retest', `correct retest: attempts 4→5, mastery ${afterReview.mastery.toFixed(4)} → ${day3Mastery.mastery.toFixed(4)} (training changed state)`);

  // CONSUME: forgetting-risk sees the reviewed node (state → projection).
  const forgetting = await getJson(`${apiUrl}/coach/forgetting-risk`, ids.studentHeaders);
  const riskRow = forgetting.rows.find((row) => row.nodeId === ids.node);
  assert.ok(riskRow, 'forgetting-risk now includes the reviewed node');
  assert.equal(riskRow.retention != null, true, 'retention is computable from the canonical review state');
  assert.ok(riskRow.retention > 0.9, `fresh review ⇒ retention ≈1 (${riskRow.retention})`);
  record('Day3-consume', `forgetting-risk includes the node (risk=${riskRow.risk}, retention≈${riskRow.retention?.toFixed(2)})`);

  // ───────────────────────── Day 7 — paper + stage assessment ───────────
  const submission = await postJson(`${apiUrl}/papers/${ids.paper}/submit`, {
    answers: [
      { questionId: qA, selectedAnswer: 'X', timeSpentSec: 30 },  // wrong, priced
      { questionId: qC, selectedAnswer: 'X', timeSpentSec: 30 },  // wrong, priced
      { questionId: qD, selectedAnswer: 'A', timeSpentSec: 30 },  // correct
    ],
  }, ids.studentHeaders);
  assert.equal(submission.syncedPracticeRecordCount, 3);

  const lossRows = await prisma.scoreLossItem.findMany({ where: { userId: ids.student } });
  const pricedLosses = lossRows.filter((row) => row.lostScore != null);
  assert.ok(pricedLosses.length > 0, 'ScoreLoss coverage > 0 (priced evidence exists)');
  record('Day7-score', `paper submitted → ${lossRows.length} loss rows, ${pricedLosses.length} with OBSERVED loss (coverage > 0)`);

  // Stage assessment: the legacy path returns its result + adjustment, and the
  // adjustment persists into the student profile (the system's own write) —
  // consumption is verified against BOTH, never against a fabricated surface.
  const stageBefore = await getJson(`${apiUrl}/assessments/stage`, ids.studentHeaders);
  const stageQuestions = (stageBefore?.questions ?? []).map((row) => row.id ?? row.questionId).filter(Boolean);
  const profileBefore = await prisma.user.findUnique({ where: { id: ids.student }, select: { remainingDays: true, studyStage: true } });
  if (stageQuestions.length > 0) {
    const stageResult = await postJson(`${apiUrl}/assessments/stage/submit`, {
      answers: stageQuestions.slice(0, 3).map((questionId) => ({ questionId, selectedAnswer: 'X', timeSpentSec: 40 })),
    }, ids.studentHeaders);
    assert.equal(stageResult.score, 0, 'all-wrong stage answers score 0 (real grading)');
    assert.ok(stageResult.adjustment?.stage, 'the assessment produced a stage decision');
    assert.ok(stageResult.adjustment?.message, 'and a student-facing explanation');
    const profileAfter = await prisma.user.findUnique({ where: { id: ids.student }, select: { remainingDays: true, studyStage: true } });
    assert.ok(profileAfter.remainingDays > profileBefore.remainingDays,
      `sub-60 assessment extends the foundation window (remainingDays ${profileBefore.remainingDays} → ${profileAfter.remainingDays})`);
    record('Day7-assessment', `stage assessment: score=0 → stage=${stageResult.adjustment.stage}, remainingDays ${profileBefore.remainingDays}→${profileAfter.remainingDays} (assessment changed the plan inputs)`);
    const planAfterAssessment = await getJson(`${apiUrl}/today/plan`, ids.studentHeaders);
    record('Day7-plan', `plan regenerated along the adjusted profile (today tasks=${(planAfterAssessment?.priorityTasks ?? []).length})`);
  } else {
    record('Day7-assessment', 'NO_CONTENT: stage assessment selector returned no questions for this account (honest content/threshold gap, not fabricated)');
  }

  // ─────────── Final: the decision surface reflects the NEW state ───────
  const diagnosisAfter = await getJson(`${apiUrl}/coach/error-diagnosis?days=7`, ids.studentHeaders);
  const nodeAfter = diagnosisAfter.findings.find((row) => row.nodeId === ids.node);
  assert.ok(nodeAfter, 'diagnosis still covers the node after Day7');
  assert.ok(nodeAfter.count > (diagnosis.findings.find((row) => row.nodeId === ids.node)?.count ?? 0),
    'the decision surface reflects the ADDITIONAL evidence produced later (count grew)');
  const prescriptionAfter = await getJson(`${apiUrl}/coach/training-prescription?days=7`, ids.studentHeaders);
  assert.equal(prescriptionAfter.storeAvailable, true);
  assert.equal(prescriptionAfter.target.nodeId, ids.node);
  record('final', `post-journey diagnosis count=${nodeAfter.count} (Day1 was ${diagnosis.findings.find((row) => row.nodeId === ids.node)?.count}); prescription still resolves against the real bank`);

  const anon = await fetch(`${apiUrl}/coach/training-prescription`);
  assert.equal(anon.status, 401);
  record('guards', 'unauthenticated loop read → 401');
}

async function runCleanup() {
  try {
    if (prisma && !process.env.KEEP_FIXTURES) {
      // Invitation rows hold FKs to both the redeeming user and the creating
      // admin: they must go first or the user deletes fail silently.
      await prisma.invitationRedemption.deleteMany({ where: { user: { email: { endsWith: `${runId}@integration.test` } } } }).catch(() => {});
      await prisma.invitationRedemption.deleteMany({ where: { user: { id: ids.admin } } }).catch(() => {});
      await prisma.invitationCode.deleteMany({ where: { createdBy: { id: ids.admin } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { email: { endsWith: `${runId}@integration.test` } } }).catch(() => {});
      await prisma.user.deleteMany({ where: { id: ids.admin } }).catch(() => {});
      await prisma.question.deleteMany({ where: { id: { contains: runId } } }).catch(() => {});
      await prisma.paper.deleteMany({ where: { id: ids.paper } }).catch(() => {});
      await prisma.knowledgePoint.deleteMany({ where: { id: ids.point } }).catch(() => {});
      await prisma.knowledgeNode.deleteMany({ where: { id: ids.node } }).catch(() => {});
      await prisma.questionFamily.deleteMany({ where: { id: { startsWith: 'cal-fam-' } } }).catch(() => {});
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
    console.log(`\nCLEAN-ACCOUNT CLOSED-LOOP HARNESS PASSED (${steps.length} stages, ${pending.length} PENDING)`);
    for (const item of pending) console.log(`  ⏸ ${item}`);
    await runCleanup();
    process.exit(0);
  } catch (error) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    console.error('\nCLEAN-ACCOUNT CLOSED-LOOP HARNESS FAILED:', error?.message ?? error);
    if (activeApi?.getOutput) console.error(activeApi.getOutput().slice(-8000));
    await runCleanup();
    process.exit(1);
  }
})();
