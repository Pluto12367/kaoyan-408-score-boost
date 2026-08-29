import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadModule(path, dependencies = {}) {
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

const asOf = new Date('2026-08-24T08:00:00.000Z');

function baseState() {
  return {
    userId: 'u-1', asOf: asOf.toISOString(),
    goal: { stage: '强化' }, mastery: { source: 'user_knowledge_mastery', averageMastery: 60 },
    weakPoints: [], wrongQuestionSummary: { latestWrongAt: '2026-08-23T00:00:00.000Z' },
    reviewDue: { dueCount: 1 }, studyTasks: { today: [], counts: {} },
  };
}

test('DashboardProjectionService boundary: no StudyService/Controller/Prisma/Adapter dependencies', async () => {
  const source = await readFile(new URL('../apps/api/src/study/dashboard-projection.service.ts', import.meta.url), 'utf8');
  for (const forbidden of ['StudyService', 'Controller', 'Prisma', 'PrismaService', 'Adapter']) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must not be in DashboardProjectionService`);
  }
  assert.match(source, /StudentStateProjectionService/);
  assert.match(source, /WrongQuestionProjectionService/);
  assert.match(source, /TodayPlanProjectionService/);
  assert.match(source, /PracticeProjectionService/);
  assert.match(source, /AssessmentProjectionService/);
});

test('DashboardProjectionService does not contain presentation strategy fields', async () => {
  const source = await readFile(new URL('../apps/api/src/study/dashboard-projection.service.ts', import.meta.url), 'utf8');
  for (const forbidden of ['recommendation', 'nextAction', 'priorityCard', 'checkpointMessage', 'recommendationStrategy', 'uiConfig', 'actionText']) {
    assert.equal(source.toLowerCase().includes(forbidden.toLowerCase()), false, `${forbidden} must not be present`);
  }
  for (const forbiddenCalc of ['calculateAccuracy', 'calculateMastery', 'deriveWrongStatus', 'deriveTaskStatus']) {
    assert.equal(source.includes(forbiddenCalc), false, `${forbiddenCalc} must not be present`);
  }
});

test('practiceFacts must be direct passthrough from PracticeProjectionService without recomputation', async () => {
  const snapshot = await loadModule('apps/api/src/study/dashboard.snapshot.ts');
  const mod = await loadModule('apps/api/src/study/dashboard-projection.service.ts', {
    'dashboard.snapshot': snapshot,
    'student-state-projection.service': {},
    'wrong-question-projection.service': {},
    'today-plan-projection.service': {},
    'practice-projection.service': {},
    'assessment-projection.service': {},
  });
  const practice = { source: 'practice_record', totalCount: 7, todayCount: 3, correctCount: 5, accuracy: 0.714285, lastPracticeAt: asOf.toISOString(), studyDuration: 123456, latestSubmittedAt: asOf.toISOString(), records: [] };
  const service = new mod.DashboardProjectionService(
    { getSnapshot: async () => baseState() },
    { getSnapshot: async () => ({ currentWrongItems: [], resolvedItems: [], dueItems: [], latestWrongAt: null }) },
    { getSnapshot: async () => ({ asOf: asOf.toISOString(), planFacts: { planId: null, phase: null, status: null }, taskFacts: { todayTasks: [] }, reviewFacts: { dueCount: 0 }, summary: { todayTaskCount: 0, completedTaskCount: 0, completionRate: 0, reviewDueCount: 0 } }) },
    { getFacts: async () => practice },
    { getFacts: async () => ({ source: 'empty', attemptCount: 0, bestScore: null, latestScore: null, lastAssessmentAt: null, latestAccuracyRate: null, latestSubmittedAt: null, history: [] }) },
  );
  const previous = process.env.DATABASE_URL; process.env.DATABASE_URL = 'postgres://test';
  try {
    const result = await service.getSnapshot('u-1', asOf);
    assert.deepEqual(result.practiceFacts, practice);
  } finally { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; }
});

test('assessmentFacts must be direct passthrough without recomputing bestScore', async () => {
  const snapshot = await loadModule('apps/api/src/study/dashboard.snapshot.ts');
  const mod = await loadModule('apps/api/src/study/dashboard-projection.service.ts', {
    'dashboard.snapshot': snapshot,
    'student-state-projection.service': {},
    'wrong-question-projection.service': {},
    'today-plan-projection.service': {},
    'practice-projection.service': {},
    'assessment-projection.service': {},
  });
  const assessment = { source: 'assessment', attemptCount: 4, bestScore: 97, latestScore: 88, lastAssessmentAt: asOf.toISOString(), latestAccuracyRate: 0.92, latestSubmittedAt: asOf.toISOString(), history: [] };
  const service = new mod.DashboardProjectionService(
    { getSnapshot: async () => baseState() },
    { getSnapshot: async () => ({ currentWrongItems: [], resolvedItems: [], dueItems: [], latestWrongAt: null }) },
    { getSnapshot: async () => ({ asOf: asOf.toISOString(), planFacts: { planId: null, phase: null, status: null }, taskFacts: { todayTasks: [] }, reviewFacts: { dueCount: 0 }, summary: { todayTaskCount: 0, completedTaskCount: 0, completionRate: 0, reviewDueCount: 0 } }) },
    { getFacts: async () => ({ source: 'empty', totalCount: 0, todayCount: 0, correctCount: 0, accuracy: 0, lastPracticeAt: null, studyDuration: 0, latestSubmittedAt: null, records: [] }) },
    { getFacts: async () => assessment },
  );
  const previous = process.env.DATABASE_URL; process.env.DATABASE_URL = 'postgres://test';
  try {
    const result = await service.getSnapshot('u-1', asOf);
    assert.deepEqual(result.assessmentFacts, assessment);
  } finally { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; }
});

test('todayPlanFacts must be passed through from TodayPlanProjectionService without computing completionRate', async () => {
  const snapshot = await loadModule('apps/api/src/study/dashboard.snapshot.ts');
  const mod = await loadModule('apps/api/src/study/dashboard-projection.service.ts', {
    'dashboard.snapshot': snapshot,
    'student-state-projection.service': {},
    'wrong-question-projection.service': {},
    'today-plan-projection.service': {},
    'practice-projection.service': {},
    'assessment-projection.service': {},
  });
  const todayPlan = { asOf: asOf.toISOString(), planFacts: { planId: 'plan-1', phase: '强化', status: 'ACTIVE' }, taskFacts: { todayTasks: [{ id: 't1', completed: true, status: 'completed' }, { id: 't2', completed: false, status: 'pending' }] }, reviewFacts: { dueCount: 5 }, summary: { todayTaskCount: 2, completedTaskCount: 1, completionRate: 50, reviewDueCount: 5 } };
  const service = new mod.DashboardProjectionService(
    { getSnapshot: async () => baseState() },
    { getSnapshot: async () => ({ currentWrongItems: [], resolvedItems: [], dueItems: [], latestWrongAt: null }) },
    { getSnapshot: async () => todayPlan },
    { getFacts: async () => ({ source: 'empty', totalCount: 0, todayCount: 0, correctCount: 0, accuracy: 0, lastPracticeAt: null, studyDuration: 0, latestSubmittedAt: null, records: [] }) },
    { getFacts: async () => ({ source: 'empty', attemptCount: 0, bestScore: null, latestScore: null, lastAssessmentAt: null, latestAccuracyRate: null, latestSubmittedAt: null, history: [] }) },
  );
  const previous = process.env.DATABASE_URL; process.env.DATABASE_URL = 'postgres://test';
  try {
    const result = await service.getSnapshot('u-1', asOf);
    assert.equal(result.todayPlanFacts.planId, 'plan-1');
    assert.equal(result.todayPlanFacts.todayTaskCount, 2);
    assert.equal(result.todayPlanFacts.completedTaskCount, 1);
    assert.equal(result.todayPlanFacts.completionRate, 50);
    assert.equal(result.todayPlanFacts.reviewDueCount, 5);
  } finally { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; }
});

test('wrongQuestionFacts must be from WrongQuestionProjectionService, not StudentState', async () => {
  const snapshot = await loadModule('apps/api/src/study/dashboard.snapshot.ts');
  const mod = await loadModule('apps/api/src/study/dashboard-projection.service.ts', {
    'dashboard.snapshot': snapshot,
    'student-state-projection.service': {},
    'wrong-question-projection.service': {},
    'today-plan-projection.service': {},
    'practice-projection.service': {},
    'assessment-projection.service': {},
  });
  const wrongSnapshot = {
    currentWrongItems: [{ questionId: 'q1', latestSubmittedAt: '2026-08-23T01:00:00.000Z' }, { questionId: 'q2', latestSubmittedAt: '2026-08-23T12:00:00.000Z' }],
    resolvedItems: [{ questionId: 'q3' }],
    dueItems: [{ questionId: 'q1' }],
    latestWrongAt: '2026-08-23T12:00:00.000Z',
  };
  const service = new mod.DashboardProjectionService(
    { getSnapshot: async () => ({ ...baseState(), wrongQuestionSummary: { latestWrongAt: 'SHOULD_NOT_USE' } }) },
    { getSnapshot: async () => wrongSnapshot },
    { getSnapshot: async () => ({ asOf: asOf.toISOString(), planFacts: { planId: null, phase: null, status: null }, taskFacts: { todayTasks: [] }, reviewFacts: { dueCount: 0 }, summary: { todayTaskCount: 0, completedTaskCount: 0, completionRate: 0, reviewDueCount: 0 } }) },
    { getFacts: async () => ({ source: 'empty', totalCount: 0, todayCount: 0, correctCount: 0, accuracy: 0, lastPracticeAt: null, studyDuration: 0, latestSubmittedAt: null, records: [] }) },
    { getFacts: async () => ({ source: 'empty', attemptCount: 0, bestScore: null, latestScore: null, lastAssessmentAt: null, latestAccuracyRate: null, latestSubmittedAt: null, history: [] }) },
  );
  const previous = process.env.DATABASE_URL; process.env.DATABASE_URL = 'postgres://test';
  try {
    const result = await service.getSnapshot('u-1', asOf);
    assert.equal(result.wrongQuestionFacts.total, 2);
    assert.equal(result.wrongQuestionFacts.latestWrongAt, '2026-08-23T12:00:00.000Z');
    assert.notEqual(result.wrongQuestionFacts.latestWrongAt, 'SHOULD_NOT_USE');
  } finally { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; }
});
