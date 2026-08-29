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

function state() {
  return {
    userId: 'u-1', asOf: asOf.toISOString(),
    goal: { stage: '强化' }, mastery: { source: 'user_knowledge_mastery', averageMastery: 60, weakCount: 1, reviewCount: 0, masteredCount: 2 },
    weakPoints: [{ knowledgeNodeId: 'kp-1', title: '页表' }],
    wrongQuestionSummary: { total: 2, unresolved: 1, reviewed: 1, resolved: 1, latestWrongAt: '2026-08-23T00:00:00.000Z' },
    reviewDue: { dueCount: 3, overdueCount: 1, nextReviewAt: '2026-08-23T00:00:00.000Z', items: [{ questionId: 'q-1', nextReviewAt: '2026-08-23T00:00:00.000Z', reviewCount: 1, stability: 'learning', overdue: true }] },
    studyTasks: { today: [{ id: 'task-1' }], counts: { pending: 1, inProgress: 0, postponed: 0, completed: 0 } },
    assessmentSummary: { attemptCount: 2, bestScore: 80, latestAccuracyRate: 75 },
  };
}

async function createService(options = {}) {
  const snapshot = await loadModule('apps/api/src/study/dashboard.snapshot.ts');
  const projection = await loadModule('apps/api/src/study/dashboard-projection.service.ts', {
    'dashboard.snapshot': snapshot,
    'student-state-projection.service': {},
    'wrong-question-projection.service': {},
    'today-plan-projection.service': {},
    'practice-projection.service': {},
    'assessment-projection.service': {},
  });
  const calls = { state: [], wrong: [], plan: [], practice: [], assessment: [] };
  const defaultPractice = { source: 'practice_record', totalCount: 0, todayCount: 0, correctCount: 0, accuracy: 0, lastPracticeAt: null, studyDuration: 0, latestSubmittedAt: null, records: [] };
  const defaultAssessment = { source: 'assessment', attemptCount: 0, bestScore: null, latestScore: null, lastAssessmentAt: null, latestAccuracyRate: null, latestSubmittedAt: null, history: [] };
  const service = new projection.DashboardProjectionService(
    { getSnapshot: async (...args) => { calls.state.push(args); return options.state ?? state(); } },
    { getSnapshot: async (...args) => { calls.wrong.push(args); return options.wrong ?? { currentWrongItems: [], resolvedItems: [], dueItems: [] }; } },
    { getSnapshot: async (...args) => { calls.plan.push(args); return options.plan ?? { planFacts: { planId: null, phase: '', status: 'EMPTY' }, taskFacts: { todayTasks: [], counts: { completed: 0 } }, reviewFacts: { dueCount: 0 }, asOf: asOf.toISOString() }; } },
    { getFacts: async (...args) => { calls.practice.push(args); return options.practice ?? defaultPractice; } },
    { getFacts: async (...args) => { calls.assessment.push(args); return options.assessment ?? defaultAssessment; } },
  );
  return { service, calls };
}

test('empty data returns an empty DashboardSnapshot', async () => {
  const { service } = await createService({ state: null, wrong: null, plan: null });
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const result = await service.getSnapshot('u-empty', asOf);
    assert.equal(result.userId, 'u-empty');
    assert.equal(result.source, 'dashboard_facts');
    assert.equal(result.stateFacts.source, 'empty');
    assert.equal(result.wrongQuestionFacts.total, 0);
    assert.equal(result.todayPlanFacts.planId, null);
    assert.equal(result.practiceFacts.source, 'empty');
    assert.equal(result.assessmentFacts.source, 'empty');
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
  }
});

test('projection maps StudentState, wrong-question, and TodayPlan facts', async () => {
  const { service, calls } = await createService({
    wrong: { currentWrongItems: [{ questionId: 'q-1' }, { questionId: 'q-2' }], resolvedItems: [{ questionId: 'q-3' }], dueItems: [{ questionId: 'q-1' }] },
    plan: { asOf: asOf.toISOString(), planFacts: { planId: 'plan-1', phase: '强化', status: 'ACTIVE' }, taskFacts: { todayTasks: [{ id: 'task-1' }, { id: 'task-2' }], counts: { completed: 1 } }, reviewFacts: { dueCount: 4 } },
  });
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://test';
  try {
    const result = await service.getSnapshot('u-1', asOf);
    assert.equal(calls.state[0][1], asOf);
    assert.equal(calls.wrong[0][1], asOf);
    assert.equal(calls.plan[0][1], asOf);
    assert.equal(result.stateFacts.mastery.averageMastery, 60);
    assert.equal(result.wrongQuestionFacts.total, 2);
    assert.equal(result.wrongQuestionFacts.resolved, 1);
    assert.equal(result.wrongQuestionFacts.dueCount, 1);
    assert.equal(result.todayPlanFacts.planId, 'plan-1');
    assert.equal(result.todayPlanFacts.todayTaskCount, 2);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
  }
});

test('practiceFacts are injected directly without recomputation', async () => {
  const practice = { source: 'practice_record', totalCount: 5, todayCount: 2, correctCount: 3, accuracy: 0.6, lastPracticeAt: asOf.toISOString(), studyDuration: 900000, latestSubmittedAt: asOf.toISOString(), records: [{ id: 'r-1', correct: true }] };
  const { service, calls } = await createService({ practice });
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://test';
  try {
    const result = await service.getSnapshot('u-1', asOf);
    assert.equal(calls.practice[0][0], 'u-1');
    assert.equal(calls.practice[0][1], asOf);
    assert.deepEqual(result.practiceFacts, practice);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
  }
});

test('assessmentFacts are injected directly without recomputation', async () => {
  const assessment = { source: 'assessment', attemptCount: 3, bestScore: 92, latestScore: 88, lastAssessmentAt: asOf.toISOString(), latestAccuracyRate: 0.85, latestSubmittedAt: asOf.toISOString(), history: [{ id: 'a-1', score: 92, submittedAt: asOf.toISOString() }] };
  const { service, calls } = await createService({ assessment });
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://test';
  try {
    const result = await service.getSnapshot('u-1', asOf);
    assert.equal(calls.assessment[0][0], 'u-1');
    assert.equal(calls.assessment[0][1], asOf);
    assert.deepEqual(result.assessmentFacts, assessment);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
  }
});

test('asOf is forwarded to all projections and practice/assessment facts', async () => {
  const { service, calls } = await createService();
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://test';
  try {
    await service.getSnapshot('u-1', asOf);
    for (const key of ['state', 'wrong', 'plan', 'practice', 'assessment']) {
      assert.equal(calls[key][0][1], asOf, `${key} asOf should be forwarded`);
    }
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
  }
});

test('projection uses fixed asOf and contains no legacy DTO fields', async () => {
  const { service } = await createService();
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://test';
  try {
    const result = await service.getSnapshot('u-1', asOf);
    assert.equal(result.asOf, asOf.toISOString());
    for (const forbidden of ['nextAction', 'recommendation', 'priorityCard', 'checkpointMessage', 'priorityTasks', 'plan', 'report']) {
      assert.equal(JSON.stringify(result).includes(`"${forbidden}"`), false, `${forbidden} must not be present`);
    }
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
  }
});

test('projection source boundary excludes StudyService and DTO adapter dependencies', async () => {
  const source = await readFile(new URL('../apps/api/src/study/dashboard-projection.service.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /StudyService|Controller|Adapter|Repository|prisma\./);
  assert.match(source, /StudentStateProjectionService/);
  assert.match(source, /WrongQuestionProjectionService/);
  assert.match(source, /TodayPlanProjectionService/);
  assert.match(source, /PracticeProjectionService/);
  assert.match(source, /AssessmentProjectionService/);
});
