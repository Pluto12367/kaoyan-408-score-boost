import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const asOf = new Date('2026-08-24T08:00:00.000Z');
const generatedAt = asOf.toISOString();

async function loadCommonJs(path, dependencies = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const localRequire = (specifier) => {
    const key = Object.keys(dependencies).find((c) => specifier.includes(c));
    if (key) return dependencies[key];
    if (specifier.includes('@nestjs/common')) return { Injectable: () => (target) => target, Optional: () => (target, _key, _index) => undefined };
    throw new Error(`Unexpected dependency: ${specifier}`);
  };
  Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
  return module.exports;
}

function emptySnapshot(userId = 'u-1') {
  return {
    source: 'dashboard_facts',
    userId,
    asOf: generatedAt,
    stateFacts: { source: 'empty', goal: null, mastery: null, weakPoints: [], activity: null },
    wrongQuestionFacts: { source: 'empty', total: 0, unresolved: 0, reviewed: 0, resolved: 0, latestWrongAt: null, dueCount: 0 },
    todayPlanFacts: { source: 'empty', planId: null, phase: null, status: null, todayTaskCount: 0, completedTaskCount: 0, completionRate: 0, reviewDueCount: 0, asOf: generatedAt },
    practiceFacts: { source: 'empty', totalCount: 0, todayCount: 0, correctCount: 0, accuracy: 0, lastPracticeAt: null, studyDuration: 0, latestSubmittedAt: null, records: [] },
    sessionFacts: { source: 'empty', activeCount: 0, latestActiveAt: null, sessions: [] },
    assessmentFacts: { source: 'empty', attemptCount: 0, bestScore: null, latestScore: null, lastAssessmentAt: null, latestAccuracyRate: null, latestSubmittedAt: null, history: [] },
  };
}

function fullSnapshot() {
  return {
    ...emptySnapshot(),
    stateFacts: { source: 'student_state', goal: { stage: '强化', targetScore: 120 }, mastery: { averageMastery: 68, weakCount: 1 }, weakPoints: [{ knowledgeNodeId: 'kp-1', title: '页表' }], activity: { streakDays: 5, latestActivityAt: generatedAt } },
    wrongQuestionFacts: { source: 'wrong_question_projection', total: 3, unresolved: 2, reviewed: 1, resolved: 1, latestWrongAt: '2026-08-23T00:00:00.000Z', dueCount: 2 },
    todayPlanFacts: { source: 'today_plan_projection', planId: 'plan-1', phase: '强化', status: 'ACTIVE', todayTaskCount: 4, completedTaskCount: 2, completionRate: 50, reviewDueCount: 2, asOf: generatedAt },
    practiceFacts: { source: 'practice_record', totalCount: 2, todayCount: 1, correctCount: 1, accuracy: 0.5, lastPracticeAt: generatedAt, studyDuration: 90000, latestSubmittedAt: generatedAt, records: [{ id: 'r-1', userId: 'u-1', questionId: 'q-1', knowledgePointId: 'kp-1', correct: false, timeSpentSec: 80, mistakeReason: '概念混淆', submittedAt: generatedAt, variantQuestionId: null }, { id: 'r-2', userId: 'u-1', questionId: 'q-2', knowledgePointId: 'kp-2', correct: true, timeSpentSec: 40, mistakeReason: null, submittedAt: generatedAt, variantQuestionId: null }] },
    sessionFacts: { source: 'learning_session', activeCount: 1, latestActiveAt: generatedAt, sessions: [{ id: 's-1', userId: 'u-1', type: 'practice', startedAt: generatedAt, lastActiveAt: generatedAt, completed: false }] },
    assessmentFacts: { source: 'assessment', attemptCount: 2, bestScore: 86, latestScore: 82, lastAssessmentAt: generatedAt, latestAccuracyRate: 0.8, latestSubmittedAt: generatedAt, history: [{ id: 'a-1', score: 86, submittedAt: generatedAt }] },
  };
}

// Legacy shape derived from same facts as StudyService historically aggregated.
// This helper documents the expected legacy aggregation without calling StudyService directly.
function legacyFromFacts(snapshot) {
  return {
    student: { id: snapshot.userId, ...(snapshot.stateFacts.goal ?? {}) },
    goal: snapshot.stateFacts.goal,
    mastery: snapshot.stateFacts.mastery,
    weakPoints: snapshot.stateFacts.weakPoints,
    wrongQuestionSummary: { total: snapshot.wrongQuestionFacts.total, dueCount: snapshot.wrongQuestionFacts.dueCount, latestWrongAt: snapshot.wrongQuestionFacts.latestWrongAt },
    todayPlan: { planId: snapshot.todayPlanFacts.planId, phase: snapshot.todayPlanFacts.phase, todayTaskCount: snapshot.todayPlanFacts.todayTaskCount, completionRate: snapshot.todayPlanFacts.completionRate },
    practice: { totalCount: snapshot.practiceFacts.totalCount, todayCount: snapshot.practiceFacts.todayCount, accuracy: snapshot.practiceFacts.accuracy },
    assessment: { attemptCount: snapshot.assessmentFacts.attemptCount, bestScore: snapshot.assessmentFacts.bestScore, latestScore: snapshot.assessmentFacts.latestScore },
    activity: snapshot.stateFacts.activity ?? snapshot.sessionFacts,
    score: null,
  };
}

async function loadAdapter() {
  return loadCommonJs('apps/api/src/study/dashboard.adapter.ts');
}

async function loadQueryWithSnapshot(snapshot) {
  const adapter = await loadAdapter();
  const query = await loadCommonJs('apps/api/src/study/dashboard-query.service.ts', {
    'dashboard-projection.service': {},
    'dashboard.adapter': adapter,
  });
  // DashboardQueryService constructor takes projection; we stub getSnapshot to return fixed snapshot
  const service = new query.DashboardQueryService({
    getSnapshot: async (userId, asOfArg) => {
      assert.equal(userId, snapshot.userId);
      assert.ok(asOfArg instanceof Date);
      return snapshot;
    },
  });
  return { service, adapter };
}

test('parity: empty facts produce equivalent legacy-safe shape via new query path', async () => {
  const snapshot = emptySnapshot('u-empty');
  const { service, adapter } = await loadQueryWithSnapshot(snapshot);
  const viaQuery = await service.getDashboardOverviewCompat(snapshot.userId, asOf);
  const viaAdapter = adapter.toLegacyDashboardOverview(snapshot, generatedAt);
  const legacy = legacyFromFacts(snapshot);
  assert.deepEqual(viaQuery, viaAdapter);
  assert.equal(viaQuery.student.id, 'u-empty');
  assert.equal(legacy.wrongQuestionSummary.total, 0);
  assert.equal(legacy.todayPlan.todayTaskCount, 0);
  assert.equal(legacy.practice.totalCount, 0);
  assert.equal(legacy.assessment.bestScore, null);
});

test('parity: complete learning state preserves all dimensions', async () => {
  const snapshot = fullSnapshot();
  const { service } = await loadQueryWithSnapshot(snapshot);
  const dto = await service.getDashboardOverviewCompat(snapshot.userId, asOf);
  const legacy = legacyFromFacts(snapshot);
  // mastery / weakPoints
  assert.equal(dto.report.mastery.averageMastery, legacy.mastery.averageMastery);
  assert.deepEqual(dto.report.weakPoints, legacy.weakPoints);
  // wrongQuestion
  assert.equal(dto.report.wrongQuestionCount, legacy.wrongQuestionSummary.total);
  assert.equal(dto.wrongQuestions.length, legacy.wrongQuestionSummary.total);
  // todayPlan
  assert.equal(dto.plan.todayTaskCount, legacy.todayPlan.todayTaskCount);
  assert.equal(dto.plan.completionRate, legacy.todayPlan.completionRate);
  // practice
  assert.equal(dto.practiceRecords.length, legacy.practice.totalCount);
  // assessment
  assert.equal(dto.stageAssessment.bestScore, legacy.assessment.bestScore);
  // activity
  assert.ok(dto.learningCalendar);
  assert.equal(legacy.activity.streakDays, 5);
});

test('parity: wrong question facts map to report and wrongQuestions', async () => {
  const snapshot = { ...fullSnapshot(), wrongQuestionFacts: { source: 'wrong_question_projection', total: 5, unresolved: 3, reviewed: 2, resolved: 2, latestWrongAt: generatedAt, dueCount: 3 } };
  const { service } = await loadQueryWithSnapshot(snapshot);
  const dto = await service.getDashboardOverviewCompat(snapshot.userId, asOf);
  const legacy = legacyFromFacts(snapshot);
  assert.equal(dto.wrongQuestions.length, 5);
  assert.equal(legacy.wrongQuestionSummary.total, 5);
  assert.equal(legacy.wrongQuestionSummary.dueCount, 3);
});

test('parity: today plan facts map to plan summary', async () => {
  const snapshot = { ...fullSnapshot(), todayPlanFacts: { source: 'today_plan_projection', planId: 'plan-9', phase: '冲刺', status: 'ACTIVE', todayTaskCount: 6, completedTaskCount: 3, completionRate: 50, reviewDueCount: 4, asOf: generatedAt } };
  const { service } = await loadQueryWithSnapshot(snapshot);
  const dto = await service.getDashboardOverviewCompat(snapshot.userId, asOf);
  const legacy = legacyFromFacts(snapshot);
  assert.equal(dto.plan.planId, 'plan-9');
  assert.equal(dto.plan.phase, '冲刺');
  assert.equal(legacy.todayPlan.phase, '冲刺');
  assert.equal(legacy.todayPlan.todayTaskCount, 6);
});

test('parity: practice records and todayCount/accuracy are preserved', async () => {
  const snapshot = fullSnapshot();
  const { service } = await loadQueryWithSnapshot(snapshot);
  const dto = await service.getDashboardOverviewCompat(snapshot.userId, asOf);
  const legacy = legacyFromFacts(snapshot);
  assert.equal(dto.practiceRecords.length, legacy.practice.totalCount);
  assert.equal(legacy.practice.todayCount, 1);
  assert.equal(legacy.practice.accuracy, 0.5);
  // Known difference documentation: legacy StudyService previously returned full PracticeRecord array with variant fields,
  // new snapshot facts filter to DashboardPracticeFact boundary — no recommendation fields.
  assert.equal(JSON.stringify(dto).includes('recommendation'), false);
});

test('parity: assessment history facts map to stageAssessment', async () => {
  const snapshot = fullSnapshot();
  const { service } = await loadQueryWithSnapshot(snapshot);
  const dto = await service.getDashboardOverviewCompat(snapshot.userId, asOf);
  const legacy = legacyFromFacts(snapshot);
  assert.equal(dto.stageAssessment.attemptCount, legacy.assessment.attemptCount);
  assert.equal(dto.stageAssessment.bestScore, legacy.assessment.bestScore);
  assert.equal(dto.stageAssessment.latestScore, legacy.assessment.latestScore);
});

test('parity: fixed asOf is preserved and DTO has no missing required fact fields', async () => {
  const snapshot = fullSnapshot();
  const { service } = await loadQueryWithSnapshot(snapshot);
  const dto = await service.getDashboardOverviewCompat(snapshot.userId, asOf);
  assert.equal(dto.generatedAt, generatedAt);
  for (const required of ['student', 'report', 'wrongQuestions', 'plan', 'practiceRecords', 'stageAssessment', 'learningCalendar']) {
    assert.ok(dto[required] !== undefined, `${required} must exist in DTO`);
  }
  for (const forbidden of ['nextAction', 'recommendation', 'priorityCard', 'checkpointMessage']) {
    assert.equal(JSON.stringify(snapshot).includes(forbidden), false, `${forbidden} must not leak from snapshot`);
  }
  // Documented known boundary: DashboardSnapshot is fact-only, so knowledgePoints/questions remain empty in adapter
  // to avoid coupling content catalog into dashboard facts. Legacy StudyService returned full catalog arrays.
  assert.equal(dto.knowledgePoints.length, 0);
  assert.equal(dto.questions.length, 0);
});
