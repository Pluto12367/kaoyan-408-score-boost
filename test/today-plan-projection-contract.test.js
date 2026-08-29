import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadModule(path) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const localRequire = (specifier) => {
    if (specifier.includes('today-plan.snapshot')) return snapshotContractExports;
    if (specifier.includes('@nestjs/common')) return { Injectable: () => (target) => target, Optional: () => (target, _key, _index) => undefined };
    throw new Error(`Unexpected dependency in pure projection test: ${specifier}`);
  };
  Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
  return module.exports;
}

async function loadSnapshotContract() {
  const source = await readFile(new URL('../apps/api/src/study/today-plan.snapshot.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    fileName: 'today-plan.snapshot.ts',
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const localRequire = (specifier) => {
    throw new Error(`Unexpected snapshot dependency: ${specifier}`);
  };
  Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
  return module.exports;
}

let snapshotContractExports;

const asOf = new Date('2026-08-24T08:00:00.000Z');

function studentState() {
  return {
    userId: 'u-1',
    asOf: asOf.toISOString(),
    goal: {},
    mastery: { source: 'user_knowledge_mastery', averageMastery: 62, weakCount: 1, reviewCount: 2, masteredCount: 3, lastUpdatedAt: '2026-08-23T00:00:00.000Z' },
    weakPoints: [{ knowledgeNodeId: 'kp-1', subject: '操作系统', chapter: '内存管理', title: '页表', masteryRate: 35, accuracyRate: 40, attempts: 5, wrongCount: 3 }],
    wrongQuestionSummary: { source: 'practice_record_wrong_question_review', total: 2, unresolved: 2, reviewed: 1, resolved: 0, latestWrongAt: '2026-08-23T00:00:00.000Z' },
    reviewDue: { dueCount: 7, overdueCount: 2, nextReviewAt: '2026-08-23T00:00:00.000Z', items: [{ questionId: 'q-1', nextReviewAt: '2026-08-23T00:00:00.000Z', reviewCount: 2, stability: 'learning', overdue: true }] },
    studyTasks: {
      today: [{ id: 'task-1', title: '页表专项', status: 'in_progress', scheduledDate: '2026-08-24', completed: false, completedAt: null, priority: '高', mode: '专项训练', questionCount: 10, minutes: 30, completedQuestionCount: 3, correctCount: 2, minutesSpent: 8, reachedTarget: false }],
      counts: { pending: 0, inProgress: 1, postponed: 0, completed: 0 },
    },
    assessmentSummary: { attemptCount: 0, bestScore: 0, latestAccuracyRate: 0, improvementText: '' },
  };
}

function planRow(status = 'in_progress') {
  return {
    id: 'plan-1', phase: '强化', status: 'ACTIVE',
    startDate: new Date('2026-08-18T00:00:00.000Z'), endDate: new Date('2026-08-24T00:00:00.000Z'),
    createdAt: new Date('2026-08-18T00:00:00.000Z'), checkpoint: 'checkpoint-fact',
    tasks: [{ id: 'task-1', title: '页表专项', status, scheduledDate: new Date('2026-08-24T00:00:00.000Z'), completed: status === 'completed', completedAt: status === 'completed' ? new Date('2026-08-24T07:00:00.000Z') : null, priority: '高', mode: '专项训练', questionCount: 10, minutes: 30 }],
  };
}

function service({ plan = null, state = studentState(), wrong = { dueItems: [] } } = {}) {
  return { plan: new (globalThis.TodayPlanProjectionService)(
    { studyPlan: { findFirst: async () => plan } },
    { getSnapshot: async () => state },
    { getSnapshot: async () => wrong },
  ) };
}

async function createService(options = {}) {
  const { TodayPlanProjectionService } = await loadModule('apps/api/src/study/today-plan-projection.service.ts');
  return new TodayPlanProjectionService(
    { studyPlan: { findFirst: async () => options.plan ?? null } },
    { getSnapshot: async () => options.state ?? studentState() },
    { getSnapshot: async () => options.wrong ?? { dueItems: [] } },
  );
}

async function withDatabase(fn) {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://test';
  try { return await fn(); } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
}

snapshotContractExports = await loadSnapshotContract();

test('planFacts preserve StudyPlan facts and exclude presentation copy', async () => {
  const service = await createService({ plan: planRow() });
  await withDatabase(async () => {
    const snapshot = await service.getSnapshot('u-1', asOf);
    assert.equal(snapshot.planFacts.planId, 'plan-1');
    assert.equal(snapshot.planFacts.phase, '强化');
    assert.equal(snapshot.planFacts.status, 'ACTIVE');
    assert.equal(snapshot.planFacts.checkpointState, 'checkpoint-fact');
    assert.equal(JSON.stringify(snapshot).includes('nextAction'), false);
    assert.equal(JSON.stringify(snapshot).includes('recommendation'), false);
  });
});

test('taskFacts preserve source status and completion facts', async () => {
  const service = await createService({ plan: { ...planRow('completed'), tasks: [{ ...planRow('completed').tasks[0], scheduledDate: '2026-08-24' }] } });
  await withDatabase(async () => {
    const snapshot = await service.getSnapshot('u-1', asOf);
    const task = snapshot.taskFacts.todayTasks[0];
    assert.equal(task.status, 'completed');
    assert.equal(task.completed, true);
    assert.equal(task.completedAt, '2026-08-24T07:00:00.000Z');
    assert.equal(snapshot.taskFacts.todayTasks[0].progress.completedQuestionCount, 3);
    assert.equal(JSON.stringify(task).includes('nextAction'), false);
    assert.equal(JSON.stringify(task).includes('priorityTasks'), false);
  });
});

test('reviewFacts reuse StudentState and do not recompute due values', async () => {
  const expected = studentState().reviewDue;
  const service = await createService({ plan: planRow(), wrong: { dueItems: [{ questionId: 'different-q' }] } });
  await withDatabase(async () => {
    const snapshot = await service.getSnapshot('u-1', asOf);
    assert.deepEqual(snapshot.reviewFacts, expected);
    assert.equal(snapshot.reviewFacts.dueCount, 7);
    assert.equal(JSON.stringify(snapshot.reviewFacts).includes('nextAction'), false);
  });
});

test('activityFacts reuse state activity inputs without recommendation fields', async () => {
  const state = studentState();
  state.studyTasks.today = [];
  const service = await createService({ plan: planRow(), state });
  await withDatabase(async () => {
    const snapshot = await service.getSnapshot('u-1', asOf);
    assert.equal(snapshot.activityFacts.streakDays, 0);
    assert.equal(snapshot.activityFacts.isActiveToday, false);
    assert.equal(snapshot.activityFacts.latestActivityAt, state.wrongQuestionSummary.latestWrongAt);
    assert.equal(JSON.stringify(snapshot.activityFacts).includes('recommendation'), false);
  });
});

test('masteryFacts are copied from StudentState without recalculation', async () => {
  const state = studentState();
  const service = await createService({ plan: planRow(), state });
  await withDatabase(async () => {
    const snapshot = await service.getSnapshot('u-1', asOf);
    assert.equal(snapshot.masteryFacts.averageMastery, state.mastery.averageMastery);
    assert.deepEqual(snapshot.masteryFacts.weakPoints, state.weakPoints);
  });
});

test('scoreFacts are empty when no score projection is supplied', async () => {
  const service = await createService({ plan: planRow() });
  await withDatabase(async () => {
    const snapshot = await service.getSnapshot('u-1', asOf);
    assert.equal(snapshot.scoreFacts.available, false);
    assert.equal(snapshot.scoreFacts.generatedAt, null);
    assert.equal(snapshot.scoreFacts.raw, null);
  });
});

test('projection source does not depend on StudyService, Controller, or DTO adapter', async () => {
  const source = await readFile(new URL('../apps/api/src/study/today-plan-projection.service.ts', import.meta.url), 'utf8');
  assert.equal(source.includes('StudyService'), false);
  assert.equal(source.includes('Controller'), false);
  assert.equal(source.includes('Adapter'), false);
  assert.equal(source.includes('priorityTasks'), false);
  assert.equal(source.includes('nextAction'), false);
  assert.equal(source.includes('recommendation'), false);
});
