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
    const key = Object.keys(dependencies).find((candidate) => specifier.includes(candidate));
    if (key) return dependencies[key];
    if (specifier.includes('@nestjs/common')) return { Injectable: () => (target) => target, Optional: () => (target, _key, _index) => undefined };
    throw new Error(`Unexpected dependency: ${specifier}`);
  };
  Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
  return module.exports;
}

function emptySnapshot(userId = 'u-1') {
  return {
    source: 'dashboard_facts', userId, asOf: generatedAt,
    stateFacts: { source: 'empty', goal: null, mastery: null, weakPoints: [], activity: null },
    wrongQuestionFacts: { source: 'empty', total: 0, unresolved: 0, reviewed: 0, resolved: 0, latestWrongAt: null, dueCount: 0 },
    todayPlanFacts: { source: 'empty', planId: null, phase: null, status: null, todayTaskCount: 0, completedTaskCount: 0, completionRate: 0, reviewDueCount: 0, asOf: generatedAt },
    practiceFacts: { source: 'empty', totalCount: 0, latestSubmittedAt: null, records: [] },
    sessionFacts: { source: 'empty', activeCount: 0, latestActiveAt: null, sessions: [] },
    assessmentFacts: { source: 'empty', attemptCount: 0, bestScore: null, latestScore: null, latestAccuracyRate: null, latestSubmittedAt: null },
  };
}

function fullSnapshot() {
  return {
    ...emptySnapshot(),
    stateFacts: { source: 'student_state', goal: { stage: '强化', targetScore: 120 }, mastery: { averageMastery: 68 }, weakPoints: [{ knowledgeNodeId: 'kp-1', title: '页表', accuracyRate: 40 }], activity: { streakDays: 5 } },
    wrongQuestionFacts: { source: 'wrong_question_projection', total: 3, unresolved: 2, reviewed: 1, resolved: 1, latestWrongAt: '2026-08-23T00:00:00.000Z', dueCount: 2 },
    todayPlanFacts: { source: 'today_plan_projection', planId: 'plan-1', phase: '强化', status: 'ACTIVE', todayTaskCount: 4, completedTaskCount: 2, completionRate: 50, reviewDueCount: 2, asOf: generatedAt },
    practiceFacts: { source: 'practice_record', totalCount: 2, latestSubmittedAt: generatedAt, records: [{ id: 'r-1', userId: 'u-1', questionId: 'q-1', knowledgePointId: 'kp-1', correct: false, timeSpentSec: 80, mistakeReason: '概念混淆', submittedAt: generatedAt, variantQuestionId: null }, { id: 'r-2', userId: 'u-1', questionId: 'q-2', knowledgePointId: 'kp-2', correct: true, timeSpentSec: 40, mistakeReason: null, submittedAt: generatedAt, variantQuestionId: null }] },
    sessionFacts: { source: 'learning_session', activeCount: 1, latestActiveAt: generatedAt, sessions: [{ id: 's-1', userId: 'u-1', type: 'practice', startedAt: generatedAt, lastActiveAt: generatedAt, completed: false }] },
    assessmentFacts: { source: 'assessment', attemptCount: 2, bestScore: 86, latestScore: 82, latestAccuracyRate: 80, latestSubmittedAt: generatedAt },
  };
}

async function loadAdapter() {
  return loadCommonJs('apps/api/src/study/dashboard.adapter.ts');
}

async function loadProjection() {
  const snapshotModule = await loadCommonJs('apps/api/src/study/dashboard.snapshot.ts');
  return loadCommonJs('apps/api/src/study/dashboard-projection.service.ts', {
    'dashboard.snapshot': snapshotModule,
    'student-state-projection.service': {},
    'wrong-question-projection.service': {},
    'today-plan-projection.service': {},
    'practice-projection.service': {},
    'assessment-projection.service': {},
  });
}

async function project(source) {
  const { DashboardProjectionService } = await loadProjection();
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://parity';
  try {
    const state = { ...source.stateFacts, assessmentSummary: source.assessmentFacts, wrongQuestionSummary: { latestWrongAt: source.wrongQuestionFacts.latestWrongAt }, reviewDue: { ...source.wrongQuestionFacts }, studyTasks: { today: [], counts: {} } };
    const service = new DashboardProjectionService(
      { getSnapshot: async () => ({ ...state, userId: source.userId, asOf: source.asOf, assessmentSummary: source.assessmentFacts }) },
      { getSnapshot: async () => ({ currentWrongItems: Array.from({ length: source.wrongQuestionFacts.total }, (_, i) => ({ questionId: `q-${i}`, latestSubmittedAt: source.wrongQuestionFacts.latestWrongAt })), resolvedItems: Array.from({ length: source.wrongQuestionFacts.resolved }, (_, i) => ({ questionId: `r-${i}`, review: {} })), dueItems: Array.from({ length: source.wrongQuestionFacts.dueCount }, (_, i) => ({ questionId: `d-${i}` })), latestWrongAt: source.wrongQuestionFacts.latestWrongAt }) },
      { getSnapshot: async () => ({ ...source.todayPlanFacts, planFacts: { planId: source.todayPlanFacts.planId, phase: source.todayPlanFacts.phase, status: source.todayPlanFacts.status }, taskFacts: { todayTasks: Array.from({ length: source.todayPlanFacts.todayTaskCount }, (_, i) => ({ id: `task-${i}`, completed: i < source.todayPlanFacts.completedTaskCount, status: i < source.todayPlanFacts.completedTaskCount ? 'completed' : 'pending' })), counts: {} }, reviewFacts: { dueCount: source.todayPlanFacts.reviewDueCount }, asOf: source.asOf, summary: { todayTaskCount: source.todayPlanFacts.todayTaskCount, completedTaskCount: source.todayPlanFacts.completedTaskCount, completionRate: source.todayPlanFacts.completionRate, reviewDueCount: source.todayPlanFacts.reviewDueCount } }) },
      { getFacts: async () => ({ ...emptySnapshot().practiceFacts, ...source.practiceFacts }) },
      { getFacts: async () => ({ ...emptySnapshot().assessmentFacts, ...source.assessmentFacts }) },
    );
    return service.getSnapshot(source.userId, asOf);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
  }
}

function comparable(dto) {
  return {
    student: dto.student,
    report: dto.report,
    wrongQuestions: dto.wrongQuestions,
    plan: dto.plan,
    practiceRecords: dto.practiceRecords,
    stageAssessment: dto.stageAssessment,
    learningCalendar: dto.learningCalendar,
    scoreCenter: dto.scoreCenter,
  };
}

test('empty facts produce equivalent legacy-safe dashboard shape', async () => {
  const { toLegacyDashboardOverview } = await loadAdapter();
  const source = emptySnapshot('u-empty');
  const dto = toLegacyDashboardOverview(source, generatedAt);
  assert.equal(dto.student.id, 'u-empty');
  assert.deepEqual(dto.wrongQuestions, []);
  assert.deepEqual(dto.practiceRecords, []);
  assert.equal(dto.plan.todayTaskCount, 0);
  assert.equal(dto.scoreCenter, null);
});

test('complete learning state preserves mastery, weak points, wrong summary, plan, activity, and assessment facts', async () => {
  const { toLegacyDashboardOverview } = await loadAdapter();
  const source = fullSnapshot();
  const projected = await project(source);
  const dto = toLegacyDashboardOverview(projected, generatedAt);
  assert.equal(dto.report.mastery.averageMastery, 68);
  assert.deepEqual(dto.report.weakPoints, source.stateFacts.weakPoints);
  assert.equal(dto.wrongQuestions.length, 3);
  assert.equal(dto.report.wrongQuestionCount, 3);
  assert.equal(dto.plan.todayTaskCount, 4);
  assert.equal(dto.plan.completedTaskCount, 2);
  assert.equal(dto.plan.reviewDue, 2);
  assert.equal(dto.practiceRecords.length, 2); // DashboardProjectionService now correctly forwards PracticeProjectionService facts.
  assert.equal(dto.stageAssessment.bestScore, 86); // Assessment facts are now forwarded from AssessmentProjectionService.
  assert.equal(dto.learningCalendar.isActiveToday, false); // Known difference: DashboardProjectionService boundary cleanup does not yet rebuild learningCalendar activity.
});

test('fixed asOf is preserved in new projection and legacy generation time is explicit', async () => {
  const { toLegacyDashboardOverview } = await loadAdapter();
  const source = fullSnapshot();
  const projected = await project(source);
  const dto = toLegacyDashboardOverview(projected, generatedAt);
  assert.equal(projected.asOf, generatedAt);
  assert.equal(dto.generatedAt, generatedAt);
});

test('parity differences are documented as known legacy aggregate boundaries', async () => {
  const { toLegacyDashboardOverview } = await loadAdapter();
  const source = fullSnapshot();
  const dto = toLegacyDashboardOverview(source, generatedAt);
  assert.deepEqual(comparable(dto).student, { id: 'u-1', stage: '强化', targetScore: 120 });
  assert.equal(dto.knowledgePoints.length, 0);
  assert.equal(dto.questions.length, 0);
  assert.equal(dto.practiceRecords.length, 2);
  assert.equal(dto.sessionFacts, undefined);
});

test('parity conversion does not mutate snapshot or add DTO strategy fields to it', async () => {
  const { toLegacyDashboardOverview } = await loadAdapter();
  const source = fullSnapshot();
  const before = JSON.stringify(source);
  toLegacyDashboardOverview(source, generatedAt);
  assert.equal(JSON.stringify(source), before);
  for (const forbidden of ['nextAction', 'recommendation', 'priorityCard', 'checkpointMessage']) assert.equal(JSON.stringify(source).includes(forbidden), false);
});
