import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// LE-V10 F2 — Exam Diagnosis projection (pure).
// Honesty rules under test (docs/feature2-exam-diagnosis-plan.md):
//   - score150 is an ESTIMATE (objective accuracy × 80-point 408 objective
//     structure + real subjective self-score) and always labels its basis
//   - missing target score → gapDecomposition null (never a fake baseline)
//   - recovery plan never generated → closure null + explicit reason
//   - questions that cannot be attributed to nodes are counted, not dropped
//   - no engine writes, no storage — deleting the module removes a projection

const DIAG_URL = new URL('../apps/api/src/study/exam-diagnosis.ts', import.meta.url);

async function loadDiagnosis() {
  const source = await readFile(DIAG_URL, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(() => {
    throw new Error('exam-diagnosis must stay dependency-free');
  }, module, module.exports);
  return module.exports;
}

// ---------------------------------------------------------------------------
// Fixtures — mirrors the getExamReport response shape (study.service.ts).
// ---------------------------------------------------------------------------

const report = (overrides = {}) => ({
  sessionId: 'sess-1',
  userId: 'u-1',
  summary: {
    totalQuestions: 20,
    answeredCount: 19,
    unansweredCount: 1,
    correctCount: 12,
    accuracyRate: 60,
    objectiveQuestionCount: 18,
    objectiveCorrectCount: 11,
    objectiveAccuracyRate: 61,
    subjectiveQuestionCount: 2,
    subjectiveEarnedScore: 21,
    subjectiveMaxScore: 45,
    subjectiveScoreRate: 47,
    totalTimeSec: 9000,
    timeLimitSec: 10800,
    overtime: false,
  },
  subjectBreakdown: [
    { subject: '数据结构', totalQuestions: 6, correctCount: 4, accuracyRate: 67, totalTimeSec: 3000, avgTimeSec: 500 },
    { subject: '操作系统', totalQuestions: 5, correctCount: 2, accuracyRate: 40, totalTimeSec: 2600, avgTimeSec: 520 },
    { subject: '计算机网络', totalQuestions: 5, correctCount: 4, accuracyRate: 80, totalTimeSec: 2000, avgTimeSec: 400 },
    { subject: '计算机组成原理', totalQuestions: 4, correctCount: 2, accuracyRate: 50, totalTimeSec: 1400, avgTimeSec: 350 },
  ],
  knowledgePointLosses: [
    { knowledgePointId: 'kp-os', title: '死锁与同步', subject: '操作系统', wrongCount: 3 },
  ],
  unansweredQuestions: [{ questionId: 'q-x', stem: '…' }],
  ...overrides,
});

const nodeIndex = (overrides = {}) => ({
  nodesByQuestion: {
    'q-wrong-1': [{ knowledgeNodeId: 'OS-DEADLOCK', name: '死锁', subject: '操作系统' }],
    'q-wrong-2': [{ knowledgeNodeId: 'OS-DEADLOCK', name: '死锁', subject: '操作系统' }],
    'q-wrong-3': [{ knowledgeNodeId: 'OS-DEADLOCK', name: '死锁', subject: '操作系统' }],
    'q-wrong-4': [{ knowledgeNodeId: 'CN-TCP', name: 'TCP 拥塞控制', subject: '计算机网络' }],
  },
  snapshotByNode: {
    'OS-DEADLOCK': { recent5Frequency: 5 },
    'CN-TCP': { recent5Frequency: 2 },
  },
  ...overrides,
});

const lostQuestionIds = ['q-wrong-1', 'q-wrong-2', 'q-wrong-3', 'q-wrong-4', 'q-unmapped'];

// ---------------------------------------------------------------------------
// score150Estimate — objective accuracy × 80 structure + real self-score
// ---------------------------------------------------------------------------

test('score150 estimate: objective projection + real subjective self-score, basis labelled', async () => {
  const { buildExamDiagnosis } = await loadDiagnosis();
  const diagnosis = buildExamDiagnosis({
    report: report(),
    lostQuestionIds,
    nodeIndex: nodeIndex(),
    nodeFrequency: { 'OS-DEADLOCK': 5, 'CN-TCP': 2 },
    recovery: { exposedTasks: 3, completedTasks: 1 },
    targetScore: null,
    asOf: '2026-09-08T00:00:00.000Z',
  });

  // objective: 61% × 80 = 48.8 → round 49; subjective real: 21 → 70? estimate = 49 + 21 = 70
  assert.equal(diagnosis.score150Estimate.value, 70);
  assert.equal(diagnosis.score150Estimate.objectiveMax, 80);
  assert.equal(diagnosis.score150Estimate.objectiveEarnedEstimate, 49);
  assert.equal(diagnosis.score150Estimate.subjectiveEarned, 21);
  assert.match(diagnosis.score150Estimate.basis, /估算/);
  assert.match(diagnosis.score150Estimate.basis, /80/);
  assert.match(diagnosis.score150Estimate.basis, /自评/);
  assert.equal(diagnosis.source, 'derived');
});

test('score150 estimate: subjective score is capped at the subjective max (self-score noise guard)', async () => {
  const { buildExamDiagnosis } = await loadDiagnosis();
  const noisy = report({ summary: { ...report().summary, subjectiveEarnedScore: 60 } });
  const diagnosis = buildExamDiagnosis({
    report: noisy,
    lostQuestionIds: [],
    nodeIndex: nodeIndex(),
    nodeFrequency: {},
    recovery: null,
    targetScore: null,
    asOf: '2026-09-08T00:00:00.000Z',
  });
  assert.ok(
    diagnosis.score150Estimate.subjectiveEarned <= diagnosis.score150Estimate.subjectiveMax,
    'self-score above max is capped, never trusted blindly',
  );
});

// ---------------------------------------------------------------------------
// perSubject — objective scope labelled
// ---------------------------------------------------------------------------

test('perSubject rows carry the objective scope estimate with subject max', async () => {
  const { buildExamDiagnosis } = await loadDiagnosis();
  const diagnosis = buildExamDiagnosis({
    report: report(),
    lostQuestionIds,
    nodeIndex: nodeIndex(),
    nodeFrequency: {},
    recovery: null,
    targetScore: null,
    asOf: '2026-09-08T00:00:00.000Z',
  });
  const os = diagnosis.perSubject.find((row) => row.subject === '操作系统');
  assert.equal(os.questions, 5);
  assert.equal(os.accuracyRate, 40);
  // 5 objective questions × 2 分 = 10 max; earned = 40% × 10 = 4
  assert.equal(os.objectiveMax, 10);
  assert.equal(os.objectiveEarnedEstimate, 4);
  assert.match(os.scopeNote, /客观题/);
});

// ---------------------------------------------------------------------------
// nodeLoss — attribution with frequency enrichment, honest unmapped count
// ---------------------------------------------------------------------------

test('nodeLoss: attributes losses to nodes, enriches frequency, counts unmapped honestly', async () => {
  const { buildExamDiagnosis } = await loadDiagnosis();
  const diagnosis = buildExamDiagnosis({
    report: report(),
    lostQuestionIds,
    nodeIndex: nodeIndex(),
    nodeFrequency: { 'OS-DEADLOCK': 5, 'CN-TCP': 2 },
    recovery: null,
    targetScore: null,
    asOf: '2026-09-08T00:00:00.000Z',
  });
  assert.equal(diagnosis.nodeLossUnmappedCount, 1, 'the unattributed question is counted');
  const deadlock = diagnosis.nodeLoss.find((row) => row.knowledgeNodeId === 'OS-DEADLOCK');
  assert.equal(deadlock.lostCount, 3);
  assert.equal(deadlock.recent5Frequency, 5);
  assert.equal(deadlock.stars, 5);
  assert.ok(
    diagnosis.nodeLoss.findIndex((row) => row.knowledgeNodeId === 'OS-DEADLOCK')
      < diagnosis.nodeLoss.findIndex((row) => row.knowledgeNodeId === 'CN-TCP'),
    'sorted by lostCount × frequency descending',
  );
  assert.ok(diagnosis.nodeLoss.length <= 5, 'nodeLoss is bounded');
});

test('nodeLoss: empty losses yield an honest empty section', async () => {
  const { buildExamDiagnosis } = await loadDiagnosis();
  const diagnosis = buildExamDiagnosis({
    report: report({
      knowledgePointLosses: [],
      unansweredQuestions: [],
    }),
    lostQuestionIds: [],
    nodeIndex: nodeIndex(),
    nodeFrequency: {},
    recovery: null,
    targetScore: null,
    asOf: '2026-09-08T00:00:00.000Z',
  });
  assert.deepEqual([...diagnosis.nodeLoss], []);
  assert.equal(diagnosis.nodeLossUnmappedCount, 0);
});

// ---------------------------------------------------------------------------
// gapDecomposition — only with a real target
// ---------------------------------------------------------------------------

test('gapDecomposition: computed against the target with an estimate note; null without target', async () => {
  const { buildExamDiagnosis } = await loadDiagnosis();
  const base = {
    report: report(),
    lostQuestionIds,
    nodeIndex: nodeIndex(),
    nodeFrequency: {},
    asOf: '2026-09-08T00:00:00.000Z',
  };
  const withTarget = buildExamDiagnosis({ ...base, recovery: null, targetScore: 120 });
  assert.equal(withTarget.gapDecomposition.targetScore, 120);
  assert.equal(withTarget.gapDecomposition.predictedScore150, 70);
  assert.equal(withTarget.gapDecomposition.gap, 50);
  assert.match(withTarget.gapDecomposition.note, /估算/);

  const withoutTarget = buildExamDiagnosis({ ...base, recovery: null, targetScore: null });
  assert.equal(withoutTarget.gapDecomposition, null, 'no target → no fake baseline');
});

// ---------------------------------------------------------------------------
// recoveryClosure — plan-not-generated vs real closure rate
// ---------------------------------------------------------------------------

test('recoveryClosure: plan-not-generated yields null with an explicit reason', async () => {
  const { buildExamDiagnosis } = await loadDiagnosis();
  const diagnosis = buildExamDiagnosis({
    report: report(),
    lostQuestionIds,
    nodeIndex: nodeIndex(),
    nodeFrequency: {},
    recovery: null,
    targetScore: null,
    asOf: '2026-09-08T00:00:00.000Z',
  });
  assert.equal(diagnosis.recoveryClosure, null);
  assert.equal(diagnosis.recoveryClosureReason, 'recovery_plan_not_generated');
});

test('recoveryClosure: rate computed from completion facts, always honest', async () => {
  const { buildExamDiagnosis } = await loadDiagnosis();
  const diagnosis = buildExamDiagnosis({
    report: report(),
    lostQuestionIds,
    nodeIndex: nodeIndex(),
    nodeFrequency: {},
    recovery: { exposedTasks: 3, completedTasks: 1 },
    targetScore: null,
    asOf: '2026-09-08T00:00:00.000Z',
  });
  assert.equal(diagnosis.recoveryClosure.exposedTasks, 3);
  assert.equal(diagnosis.recoveryClosure.completedTasks, 1);
  assert.equal(diagnosis.recoveryClosure.closureRate, 33);
});

// ---------------------------------------------------------------------------
// purity
// ---------------------------------------------------------------------------

test('purity: dependency-free, no clock, no randomness', async () => {
  const source = await readFile(DIAG_URL, 'utf8');
  const imports = [...source.matchAll(/^import\s+(?:[^'"]+from\s+)?['"]([^'"]+)['"]/gm)].map((match) => match[1]);
  assert.deepEqual(imports, [], 'exam-diagnosis stays dependency-free');
  assert.doesNotMatch(source, /Date\.now|Math\.random/);
});

test('M1 wiring: endpoint, DI, module registration, and the additive report field', async () => {
  const controller = await readFile(new URL('../apps/api/src/study/study.controller.ts', import.meta.url), 'utf8');
  assert.match(controller, /@Get\('exam\/diagnosis\/:sessionId'\)/);
  assert.match(controller, /ExamDiagnosisService/);
  assert.match(controller, /ServiceUnavailableException/, 'no database → explicit unavailability');
  assert.match(controller, /getExamDiagnosis\(sessionId, user\.id\)/, 'self-only access');

  const service = await readFile(new URL('../apps/api/src/study/exam-diagnosis.service.ts', import.meta.url), 'utf8');
  assert.match(service, /getExamReport\(sessionId, userId\)/, 'ownership enforced inside the existing report');
  assert.match(service, /resolveKnowledgeNodesForQuestion/);
  assert.match(service, /loadLatestFrequencyForNodes/);
  assert.match(service, /studyTaskCompletion\.count/, 'closure rate comes from completion facts');
  assert.match(service, /exam-review-\$\{sessionId\}-day-/, 'deterministic post-exam task ids');
  assert.doesNotMatch(service, /\.create\(|\.update\(|\.delete\(/, 'read-only service');

  const studyService = await readFile(new URL('../apps/api/src/study/study.service.ts', import.meta.url), 'utf8');
  assert.match(studyService, /lostQuestionIds,/, 'report gains the additive lost-question-ids field');

  const moduleSource = await readFile(new URL('../apps/api/src/study/study.module.ts', import.meta.url), 'utf8');
  assert.match(moduleSource, /ExamDiagnosisService/);
});
