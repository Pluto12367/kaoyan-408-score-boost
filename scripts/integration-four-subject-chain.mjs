/**
 * FOUR-SUBJECT CLOSED-LOOP BREADTH HARNESS (Long-Horizon v2.0 §31/§32 breadth).
 *
 * The clean-account harness (integration-clean-account-loop.mjs) proves the
 * §32 chain IN DEPTH for one fixture subject. This harness proves the same
 * chain IN BREADTH: one real student, all four 408 subjects, real PostgreSQL
 * + real HTTP, and after every stage asserts the consumption rule.
 *
 *   per subject (DS / CO / OS / CN, each with its own node, bank and subtype):
 *     wrong ×3 → controlled self-report (a different owner reason per subject)
 *     → CONSUME: error-patterns (subject-correct attribution, per-subtype rows)
 *     → CONSUME: error-diagnosis (unclassified bucket + self-report bucket)
 *     → CONSUME: training-prescription (exact ladder counts from THAT subject's
 *       bank, review=1d / retest=3d shared constants)
 *     → review redo (isReview) → retest → forgetting-risk sees the node
 *     → follow the ladder manually (8 correct) → §32: the NEXT prescription
 *       re-anchors BASIC → MEDIUM for EVERY subject
 *
 *   subtype partition (one mixed-subtype node):
 *     the same node carries OS_PV AND SINGLE_CHOICE questions; the prescription
 *     must price each subtype's pool separately (SINGLE_CHOICE pool = 1 question
 *     ⇒ LIMITED_CONTENT, never inflated by the OS_PV questions at that node).
 *
 * Time semantics: a SEQUENCE of real actions, no fabricated events; the only
 * DB writes outside HTTP are fixtures (accounts/bank).
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
const jwtSecret = 'integration-four-subject-chain-secret-0123456789';
process.env.DATABASE_URL = databaseUrl;

const runId = randomUUID().slice(0, 8);
const password = 'Four-Subject-Chain-Password-1';

const SUBJECTS = [
  { key: 'ds', subject: 'DATA_STRUCTURE', name: '数据结构', subtype: 'ALGORITHM', reason: 'method_error', label: '方法错误' },
  { key: 'co', subject: 'COMPUTER_ORGANIZATION', name: '计算机组成', subtype: 'CO_COMPUTATION', reason: 'calculation_error', label: '计算错误' },
  { key: 'os', subject: 'OPERATING_SYSTEM', name: '操作系统', subtype: 'OS_PV', reason: 'reading_error', label: '审题错误' },
  { key: 'cn', subject: 'COMPUTER_NETWORK', name: '计算机网络', subtype: 'CN_ROUTING', reason: 'concept_confusion', label: '概念混淆' },
];

const ids = {
  admin: `fsj-admin-${runId}`,
  student: null,
  studentEmail: null,
  nodes: {},   // key → knowledgeNodeId (4 subjects + mixed)
  points: {},  // key → knowledgePointId
};

const questions = {}; // key → [q1..q5]  (mixed: qm1..qm4)

let activeApi = null;
let prisma = null;

const steps = [];
function record(step, detail) {
  steps.push(`${step}: ${detail}`);
  console.log(`  ✓ ${step} — ${detail}`);
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
      id: ids.admin, email: `${ids.admin}@integration.test`, name: 'Four Subject Admin', role: 'ADMIN',
      passwordHash: await hashPassword(password), trialStatus: 'ACTIVE', accountStatus: 'ACTIVE',
    },
  });

  const question = (id, difficulty, subtype) => ({
    id, familyId: `fsj-fam-${id}`, versionNumber: 1, contentFingerprint: `fp-${id}`,
    stem: `四科闭环夹具 ${id}`, options: ['A', 'B', 'C', 'D'], answer: 'A', analysis: 'x',
    difficulty, type: 'SINGLE_CHOICE', source: 'integration', expectedTimeSec: 60,
    questionSubtype: subtype, maxScore: 2,
  });

  async function seedNode(key, subject, name) {
    const nodeId = `fsj-node-${runId}-${key}`;
    const pointId = `fsj-pt-${runId}-${key}`;
    await prisma.knowledgeNode.create({
      data: { id: nodeId, subject, nodeType: 'knowledge_point', name: `四科节点 ${name} ${runId}`, importance: 4, difficulty: 3, syllabusVersion: 'test' },
    });
    await prisma.knowledgePoint.create({
      data: {
        id: pointId, subject, chapter: 'FSJ', title: `四科考点 ${name}`,
        importance: 4, frequency: 4, prerequisites: [],
        nodeMaps: { create: { knowledgeNodeId: nodeId, mappingType: 'PRIMARY', confidence: 1 } },
      },
    });
    ids.nodes[key] = nodeId;
    ids.points[key] = pointId;
    return { nodeId, pointId };
  }

  async function seedQuestion(id, difficulty, subtype, pointId) {
    await prisma.questionFamily.create({ data: { id: `fsj-fam-${id}` } });
    await prisma.question.create({ data: question(id, difficulty, subtype) });
    await prisma.questionKnowledgePoint.create({ data: { questionId: id, knowledgePointId: pointId } });
  }

  // Per-subject bank: 2 BASIC + 3 MEDIUM, all of the subject's 408 subtype —
  // exactly the clean-account shape so the per-subject §32 anchor flip runs
  // the identical, already-proven EMA sequence.
  for (const entry of SUBJECTS) {
    const { nodeId, pointId } = await seedNode(entry.key, entry.subject, entry.name);
    questions[entry.key] = [
      `fsj-${runId}-${entry.key}-q1`, `fsj-${runId}-${entry.key}-q2`, `fsj-${runId}-${entry.key}-q3`,
      `fsj-${runId}-${entry.key}-q4`, `fsj-${runId}-${entry.key}-q5`,
    ];
    const difficulties = ['BASIC', 'BASIC', 'MEDIUM', 'MEDIUM', 'MEDIUM'];
    for (let index = 0; index < 5; index += 1) {
      await seedQuestion(questions[entry.key][index], difficulties[index], entry.subtype, pointId);
    }
    void nodeId;
  }

  // Mixed-subtype node: ONE node carrying OS_PV AND SINGLE_CHOICE questions.
  // Used to prove the prescription pool is partitioned per subtype.
  const mixed = await seedNode('mixed', 'OPERATING_SYSTEM', '混合题型');
  questions.mixed = [
    `fsj-${runId}-qm1`, `fsj-${runId}-qm2`, `fsj-${runId}-qm3`, `fsj-${runId}-qm4`,
  ];
  await seedQuestion(questions.mixed[0], 'BASIC', 'OS_PV', mixed.pointId);
  await seedQuestion(questions.mixed[1], 'MEDIUM', 'OS_PV', mixed.pointId);
  await seedQuestion(questions.mixed[2], 'MEDIUM', 'OS_PV', mixed.pointId);
  await seedQuestion(questions.mixed[3], 'BASIC', 'SINGLE_CHOICE', mixed.pointId);
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

async function practice(questionId, pointId, selectedAnswer) {
  return postJson(`${apiUrl}/practice-records`, {
    questionId, knowledgePointId: pointId, selectedAnswer, timeSpentSec: 60,
  }, { ...ids.studentHeaders, 'idempotency-key': `fsj-${runId}-${questionId}-${randomUUID().slice(0, 8)}` });
}

function masteryFor(map, nodeId) {
  return map.items.find((item) => item.knowledgeNodeId === nodeId) ?? null;
}

async function masteryRow(nodeId) {
  const map = await getJson(`${apiUrl}/knowledge/mastery`, ids.studentHeaders);
  return masteryFor(map, nodeId);
}

/**
 * ONE subject's full §32 slice, against that subject's own node and bank.
 * Mirrors the clean-account journey shape attempt-for-attempt so the EMA math
 * per node is the already-proven sequence (3W → redo C → retest C → 8C).
 */
async function runSubjectJourney(entry) {
  const nodeId = ids.nodes[entry.key];
  const pointId = ids.points[entry.key];
  const [q1, q2, q3] = questions[entry.key];

  // Produce: three wrong attempts (no signals → unclassified bucket) + one
  // controlled self-report of the subject's own owner reason.
  await practice(q1, pointId, 'X');
  await practice(q3, pointId, 'X');
  await practice(q2, pointId, 'X');
  await postJson(`${apiUrl}/wrong-questions/${q1}/reason`, {
    controlledReason: entry.reason, redoCorrect: false, timeSpentSec: 60,
    isReview: false, idempotencyKey: `fsj-report-${runId}-${entry.key}`,
  }, ids.studentHeaders);

  // CONSUME patterns: the fresh reason report (isReview:false) writes the
  // SCHEDULE (selfReportedReason), not an attempt fact — attempts enter the
  // wrong-pattern surface only through real wrong observations. So the three
  // signal-less wrongs form exactly ONE unclassified row per subject node.
  const patterns = await getJson(`${apiUrl}/coach/error-patterns?days=7`, ids.studentHeaders);
  const nodeRows = patterns.patterns.filter((row) => row.nodeId === nodeId);
  const unclassifiedRow = nodeRows.find((row) => row.reasonCode === 'unclassified' && row.questionSubtype === entry.subtype);
  assert.ok(unclassifiedRow && unclassifiedRow.count === 3,
    `${entry.name}: unclassified pattern row counts the 3 signal-less wrongs (got ${unclassifiedRow?.count})`);
  assert.equal(unclassifiedRow.subject, entry.subject,
    `${entry.name}: pattern rows carry the attempt's SUBJECT (${entry.subject})`);
  // The controlled report itself landed on the canonical schedule with the
  // taxonomy's Chinese label (the report channel's real write path).
  const reportedSchedule = await prisma.reviewSchedule.findUnique({
    where: { userId_questionId: { userId: ids.student, questionId: q1 } },
  });
  assert.ok(reportedSchedule, `${entry.name}: the reason report created the review schedule`);
  assert.equal(reportedSchedule.selfReportedReason, entry.label,
    `${entry.name}: controlled report persisted the canonical label (${entry.label})`);
  record(`${entry.key}:patterns`, `patterns → unclassified×3 (subject=${entry.subject}, subtype=${entry.subtype}); report → schedule "${entry.label}"`);

  // CONSUME diagnosis: one finding for the node, subtype-tagged, sample-size
  // confidence per the documented thresholds (3 ⇒ medium).
  const diagnosis = await getJson(`${apiUrl}/coach/error-diagnosis?days=7`, ids.studentHeaders);
  const nodeFindings = diagnosis.findings.filter((row) => row.nodeId === nodeId);
  assert.equal(nodeFindings.length, 1, `${entry.name}: exactly one finding (the unclassified bucket)`);
  const uncFinding = nodeFindings[0];
  assert.ok(uncFinding.count === 3 && uncFinding.observedLostScore === 0 && uncFinding.proxyLostScore === 0,
    `${entry.name}: finding counts 3 with zero loss value (practice wrongs price no ScoreLoss ledger — money enters via the paper path, proven in the clean-account Day7)`);
  assert.equal(uncFinding.questionSubtype, entry.subtype, `${entry.name}: finding keeps the subject's 408 subtype`);
  assert.equal(uncFinding.confidence, 'medium', `${entry.name}: count 3 ⇒ medium sample-size confidence`);
  record(`${entry.key}:diagnosis`, `diagnosis → finding count=3, subtype ${entry.subtype}, confidence=medium, loss=0/0 (practice wrongs price no ledger)`);

  // CONSUME prescription: exact ladder counts from THAT subject's bank
  // (2 BASIC + 3 MEDIUM ⇒ base pool 5 ⇒ basic 3 / same_type 2, not limited).
  const prescription = await getJson(`${apiUrl}/coach/training-prescription?days=7&nodeId=${encodeURIComponent(nodeId)}`, ids.studentHeaders);
  assert.equal(prescription.storeAvailable, true);
  assert.equal(prescription.target.nodeId, nodeId);
  assert.equal(prescription.target.subject, entry.subject, `${entry.name}: prescription target carries the subject`);
  assert.equal(prescription.target.questionSubtype, entry.subtype, `${entry.name}: prescription target carries the 408 subtype`);
  assert.equal(prescription.difficultyAnchor, 'BASIC', `${entry.name}: fresh wrong-only state anchors BASIC`);
  const day1Basic = prescription.ladder.find((step) => step.stage === 'basic');
  const day1Same = prescription.ladder.find((step) => step.stage === 'same_type');
  assert.equal(day1Basic.questionCount, 3, `${entry.name}: basic step resolves against the real bank (got ${day1Basic.questionCount})`);
  assert.equal(day1Same.questionCount, 2, `${entry.name}: same-type step resolves against the real bank (got ${day1Same.questionCount})`);
  assert.equal(day1Basic.limitedByContent, false);
  assert.equal(prescription.dataStatus, 'OK');
  const reviewStep = prescription.ladder.find((step) => step.stage === 'review');
  const retestStep = prescription.ladder.find((step) => step.stage === 'retest');
  assert.equal(reviewStep.dueInDays, 1, `${entry.name}: review timing = shared scheduler constant`);
  assert.equal(retestStep.dueInDays, 3, `${entry.name}: retest timing = shared scheduler constant`);
  record(`${entry.key}:prescription`, `prescription → ${entry.name} ladder basic=3/same_type=2 (bank-resolved), anchor BASIC, review 1d / retest 3d`);

  // Day-3 slice: real review redo (the ONE path writing review state), then a
  // correct retest — ability state must move twice.
  const redo = await postJson(`${apiUrl}/wrong-questions/${q1}/reason`, {
    controlledReason: entry.reason, redoCorrect: true, timeSpentSec: 40,
    isReview: true, idempotencyKey: `fsj-redo-${runId}-${entry.key}`,
  }, ids.studentHeaders);
  assert.equal(redo.redoCorrect, true);
  const afterRedo = await masteryRow(nodeId);
  assert.equal(afterRedo.attempts, 4, `${entry.name}: review redo recorded as the 4th observation`);

  await practice(q1, pointId, 'A');
  const afterRetest = await masteryRow(nodeId);
  assert.equal(afterRetest.attempts, 5, `${entry.name}: retest recorded as the 5th observation`);
  assert.ok(afterRetest.mastery > afterRedo.mastery, `${entry.name}: retest moves mastery up`);

  // CONSUME forgetting: the reviewed node is now in the learning domain with
  // fresh review state.
  const forgetting = await getJson(`${apiUrl}/coach/forgetting-risk`, ids.studentHeaders);
  const riskRow = forgetting.rows.find((row) => row.nodeId === nodeId);
  assert.ok(riskRow, `${entry.name}: forgetting-risk includes the reviewed node`);
  assert.ok(riskRow.retention != null && riskRow.retention > 0.9,
    `${entry.name}: fresh review ⇒ retention ≈1 (${riskRow.retention})`);
  record(`${entry.key}:review`, `review redo + retest → attempts 3→5, mastery ${afterRedo.mastery.toFixed(4)}→${afterRetest.mastery.toFixed(4)}, forgetting sees the node (retention≈${riskRow.retention.toFixed(2)})`);

  // §32 breadth: follow the Day-1 ladder MANUALLY (8 correct) — the NEXT
  // prescription must re-anchor BASIC → MEDIUM for EVERY subject.
  for (let index = 0; index < 8; index += 1) {
    await practice(index % 2 === 0 ? q2 : q3, pointId, 'A');
  }
  const consolidated = await masteryRow(nodeId);
  assert.ok(consolidated.mastery > 0.8, `${entry.name}: following the ladder consolidates the node (${consolidated.mastery.toFixed(4)})`);
  const nextPrescription = await getJson(`${apiUrl}/coach/training-prescription?days=7&nodeId=${encodeURIComponent(nodeId)}`, ids.studentHeaders);
  assert.equal(nextPrescription.difficultyAnchor, 'MEDIUM',
    `${entry.name}: state change reaches the NEXT prescription (BASIC → ${nextPrescription.difficultyAnchor}, mastery ${consolidated.mastery.toFixed(4)})`);
  assert.equal(nextPrescription.ladder.find((step) => step.stage === 'basic').difficulty, 'MEDIUM',
    `${entry.name}: the basic step itself re-anchors`);
  assert.notDeepEqual(nextPrescription.ladder, prescription.ladder, `${entry.name}: the ladder is not static across states`);
  record(`${entry.key}:ss32`, `followed the ladder (8 correct) → mastery ${consolidated.mastery.toFixed(4)} → NEXT prescription re-anchored BASIC→MEDIUM (§32 holds for ${entry.name})`);
}

/** Subtype partition proof on the mixed-subtype node. */
async function runSubtypePartition() {
  const nodeId = ids.nodes.mixed;
  const pointId = ids.points.mixed;
  const [qm1, qm2, qm3, qm4] = questions.mixed;

  // Produce: 3 wrongs on OS_PV questions + 1 wrong on the SINGLE_CHOICE
  // question — two buckets at one node.
  await practice(qm1, pointId, 'X');
  await practice(qm2, pointId, 'X');
  await practice(qm3, pointId, 'X');
  await practice(qm4, pointId, 'X');

  const diagnosis = await getJson(`${apiUrl}/coach/error-diagnosis?days=7`, ids.studentHeaders);
  const mixedFindings = diagnosis.findings.filter((row) => row.nodeId === nodeId);
  const pvFinding = mixedFindings.find((row) => row.questionSubtype === 'OS_PV');
  const scFinding = mixedFindings.find((row) => row.questionSubtype === 'SINGLE_CHOICE');
  assert.ok(pvFinding && pvFinding.count === 3, 'mixed node: OS_PV bucket counts 3');
  assert.ok(scFinding && scFinding.count === 1, 'mixed node: SINGLE_CHOICE bucket counts 1 (never merged into the OS_PV rows)');

  // Auto target = the dominant OS_PV finding; its pool = 1 BASIC + 2 MEDIUM
  // OS_PV questions ⇒ basic 3 / same_type 2, OK.
  const autoPrescription = await getJson(`${apiUrl}/coach/training-prescription?days=7&nodeId=${encodeURIComponent(nodeId)}`, ids.studentHeaders);
  assert.equal(autoPrescription.target.questionSubtype, 'OS_PV');
  assert.equal(autoPrescription.target.subject, 'OPERATING_SYSTEM');
  assert.equal(autoPrescription.ladder.find((step) => step.stage === 'basic').questionCount, 3);
  assert.equal(autoPrescription.dataStatus, 'OK');

  // The SAME node asked for the SINGLE_CHOICE finding: its pool is exactly the
  // one SINGLE_CHOICE question ⇒ basic 1 (limited), same_type 1 (limited),
  // LIMITED_CONTENT. If the subtype filter leaked, the OS_PV questions would
  // inflate this pool to 4 and the step would look READY — that is the bug
  // this assertion exists to catch.
  const scPrescription = await getJson(
    `${apiUrl}/coach/training-prescription?days=7&nodeId=${encodeURIComponent(nodeId)}&questionSubtype=SINGLE_CHOICE`,
    ids.studentHeaders,
  );
  assert.equal(scPrescription.target.questionSubtype, 'SINGLE_CHOICE');
  const scBasic = scPrescription.ladder.find((step) => step.stage === 'basic');
  const scSame = scPrescription.ladder.find((step) => step.stage === 'same_type');
  assert.equal(scBasic.questionCount, 1, `SINGLE_CHOICE pool prices exactly its own question (got ${scBasic.questionCount})`);
  assert.equal(scBasic.limitedByContent, true, 'a 1-question pool is honestly flagged as limited');
  assert.equal(scSame.questionCount, 1);
  assert.equal(scPrescription.dataStatus, 'LIMITED_CONTENT');
  record('subtype-partition', `mixed node: OS_PV pool (3/2, OK) vs SINGLE_CHOICE pool (1/1, LIMITED_CONTENT) — pools are subtype-partitioned, scarcity is explicit`);
}

/** Cross-subject sweep: one coherent evidence surface, four subjects kept apart. */
async function runCrossSubjectSweep() {
  const patterns = await getJson(`${apiUrl}/coach/error-patterns?days=7`, ids.studentHeaders);
  assert.equal(patterns.totals.wrongCount, 16,
    `evidence totals = 12 subject wrongs + 4 mixed wrongs, no cross-subject double counting (got ${patterns.totals.wrongCount})`);
  const rowSubjects = [...new Set(patterns.patterns.map((row) => row.subject))].sort();
  assert.deepEqual(rowSubjects, SUBJECTS.map((entry) => entry.subject).sort(),
    'all four subjects appear in one pattern surface, attribution intact');

  const diagnosis = await getJson(`${apiUrl}/coach/error-diagnosis?days=7`, ids.studentHeaders);
  for (const entry of SUBJECTS) {
    const rows = diagnosis.findings.filter((row) => row.nodeId === ids.nodes[entry.key]);
    assert.equal(rows.length, 1, `${entry.name}: the single finding survives the full journey`);
  }

  const forgetting = await getJson(`${apiUrl}/coach/forgetting-risk`, ids.studentHeaders);
  for (const entry of SUBJECTS) {
    assert.ok(forgetting.rows.some((row) => row.nodeId === ids.nodes[entry.key]),
      `${entry.name}: forgetting surface covers the subject after its journey`);
  }
  assert.ok(!forgetting.rows.some((row) => row.nodeId === ids.nodes.mixed),
    'the wrong-only mixed node (mastery < learning domain) is NOT declared a forgetting risk — weak ≠ forgotten');

  const anon = await fetch(`${apiUrl}/coach/training-prescription`);
  assert.equal(anon.status, 401);
  record('sweep', `cross-subject: totals=16, subjects=${rowSubjects.length}/4, forgetting covers 4/4 subject nodes, 401 guard holds`);
}

async function runJourney() {
  const invite = randomBytes(18).toString('base64url');
  await prisma.invitationCode.create({
    data: {
      codeHash: createHmac('sha256', jwtSecret).update(invite.trim()).digest('hex'),
      codePrefix: invite.slice(0, 6), label: 'four subject chain',
      maxUses: 5, startsAt: new Date(Date.now() - 60_000), expiresAt: new Date(Date.now() + 86_400_000),
      createdById: ids.admin,
    },
  });
  ids.studentEmail = `fsj-student-${runId}@integration.test`;
  const registered = await postJson(`${apiUrl}/auth/register`, {
    email: ids.studentEmail, password, name: '四科闭环学生', inviteCode: invite,
  });
  ids.student = registered?.user?.id ?? registered?.id;
  await prisma.user.update({ where: { id: ids.student }, data: { trialStatus: 'ACTIVE', accountStatus: 'ACTIVE' } });
  const token = (await postJson(`${apiUrl}/auth/login`, { email: ids.studentEmail, password })).accessToken;
  ids.studentHeaders = { authorization: `Bearer ${token}` };

  await postJson(`${apiUrl}/onboarding/complete`, {
    examYear: 2027, targetScore: 110, currentScore: 60, remainingDays: 120, dailyHours: 3, weakestSubject: '操作系统',
  }, ids.studentHeaders);

  // Baseline: four subjects, zero ability state anywhere.
  const map = await getJson(`${apiUrl}/knowledge/mastery`, ids.studentHeaders);
  assert.equal(map.items.length, 0, 'clean account starts with no mastery rows in ANY subject');
  record('day0', `registered + onboarded; mastery map empty across all ${SUBJECTS.length} subjects`);

  for (const entry of SUBJECTS) {
    await runSubjectJourney(entry);
  }
  await runSubtypePartition();
  await runCrossSubjectSweep();
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
      await prisma.questionFamily.deleteMany({ where: { id: { startsWith: `fsj-fam-fsj-${runId}` } } }).catch(() => {});
      await prisma.knowledgePoint.deleteMany({ where: { id: { startsWith: `fsj-pt-${runId}` } } }).catch(() => {});
      await prisma.knowledgeNode.deleteMany({ where: { id: { startsWith: `fsj-node-${runId}` } } }).catch(() => {});
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
    console.log(`\nFOUR-SUBJECT CLOSED-LOOP HARNESS PASSED (${steps.length} stages)`);
    await runCleanup();
    process.exit(0);
  } catch (error) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    console.error('\nFOUR-SUBJECT CLOSED-LOOP HARNESS FAILED:', error?.message ?? error);
    if (activeApi?.getOutput) console.error(activeApi.getOutput().slice(-8000));
    await runCleanup();
    process.exit(1);
  }
})();
