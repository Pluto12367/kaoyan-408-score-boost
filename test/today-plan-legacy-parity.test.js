import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const asOf = new Date('2026-08-24T08:00:00.000Z');
const generatedAt = '2026-08-24T08:00:00.000Z';

async function loadCommonJs(path, dependencies = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const localRequire = (specifier) => {
    const match = Object.keys(dependencies).find((key) => specifier.includes(key));
    if (match) return dependencies[match];
    if (specifier.includes('@nestjs/common')) return { Injectable: () => (target) => target, Optional: () => (target, _key, _index) => undefined };
    throw new Error(`Unexpected dependency: ${specifier}`);
  };
  Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
  return module.exports;
}

function makeTask(overrides = {}) {
  return {
    id: 'task-1', knowledgePointId: 'kp-1', questionIds: ['q-1'], subject: '操作系统', chapter: '内存管理',
    title: '页表专项', minutes: 30, questionCount: 10, mode: '专项训练', priority: '高',
    scheduledDate: '2026-08-24', status: 'pending', completed: false, completedAt: null, startedAt: null,
    postponeCount: 0, nextAvailableAt: null,
    progress: { completedQuestionCount: 2, correctCount: 1, minutesSpent: 6, reachedTarget: false },
    ...overrides,
  };
}

function makeSnapshot(overrides = {}) {
  return {
    source: 'today_plan_student_state_score_center', userId: 'u-1', asOf: asOf.toISOString(),
    planFacts: { planId: 'plan-1', phase: '强化', status: 'ACTIVE', windowStart: '2026-08-18', windowEnd: '2026-08-24', generatedAt: generatedAt, checkpointState: '今日检查点' },
    taskFacts: {
      todayTasks: [makeTask()], counts: { pending: 1, inProgress: 0, postponed: 0, completed: 0 },
      weekDays: [{ date: '2026-08-24', taskCount: 1, completedTasks: 0, totalMinutes: 30, focusKnowledgePointId: 'kp-1', focusCompleted: false }],
    },
    reviewFacts: { dueCount: 1, overdueCount: 0, nextReviewAt: '2026-08-24T07:00:00.000Z', items: [{ questionId: 'q-1', nextReviewAt: '2026-08-24T07:00:00.000Z', reviewCount: 1, stability: 'learning', overdue: false }] },
    activityFacts: { streakDays: 2, isActiveToday: true, latestActivityAt: '2026-08-24T07:30:00.000Z' },
    masteryFacts: { source: 'user_knowledge_mastery', averageMastery: 60, weakCount: 1, reviewCount: 2, masteredCount: 3, lastUpdatedAt: generatedAt, weakPoints: [] },
    scoreFacts: { available: false, generatedAt: null, raw: null },
    ...overrides,
  };
}

async function loadAdapter() {
  return loadCommonJs('apps/api/src/study/today-plan.adapter.ts');
}

async function loadProjection() {
  const snapshot = await loadCommonJs('apps/api/src/study/today-plan.snapshot.ts');
  return loadCommonJs('apps/api/src/study/today-plan-projection.service.ts', {
    'today-plan.snapshot': snapshot,
    'student-state-projection.service': {},
    'wrong-question-projection.service': {},
    '../prisma/prisma.service': {},
  });
}

async function project(snapshot, plan = null) {
  const { TodayPlanProjectionService } = await loadProjection();
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://parity';
  try {
    const service = new TodayPlanProjectionService(
      { studyPlan: { findFirst: async () => plan } },
      { getSnapshot: async () => ({
        userId: snapshot.userId,
        asOf: snapshot.asOf,
        goal: {},
        mastery: snapshot.masteryFacts,
        weakPoints: snapshot.masteryFacts.weakPoints,
        wrongQuestionSummary: { latestWrongAt: null },
        reviewDue: snapshot.reviewFacts,
        studyTasks: { today: snapshot.taskFacts.todayTasks, counts: snapshot.taskFacts.counts },
        assessmentSummary: {},
      }) },
      { getSnapshot: async () => ({ dueItems: [] }) },
    );
    return service.getSnapshot(snapshot.userId, asOf);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
}

function legacyShape(dto) {
  return {
    summary: dto.summary,
    priorityTasks: dto.priorityTasks.map((task) => ({ id: task.id, title: task.title, status: task.status, progress: task.progress })),
    weekProgress: dto.weekProgress,
    reviewDue: dto.reviewDue,
    checkpoint: dto.checkpoint,
    scoreCenter: dto.scoreCenter,
  };
}

test('Case 1: no StudyPlan produces empty plan facts and legacy-safe output', async () => {
  const { toLegacyTodayPlan } = await loadAdapter();
  const source = makeSnapshot({ planFacts: { planId: null, phase: '', status: 'EMPTY', windowStart: '', windowEnd: '', generatedAt: null, checkpointState: null }, taskFacts: { todayTasks: [], counts: { pending: 0, inProgress: 0, postponed: 0, completed: 0 }, weekDays: [] }, reviewFacts: { dueCount: 0, overdueCount: 0, nextReviewAt: null, items: [] } });
  const projected = await project(source);
  const dto = toLegacyTodayPlan(projected, generatedAt);
  assert.equal(dto.phase, '');
  assert.equal(dto.summary.totalTasks, 0);
  assert.equal(dto.reviewDue, 0);
  assert.deepEqual(dto.priorityTasks, []);
});

test('Case 2: plan with multiple tasks preserves ids, titles, statuses, and adapter order', async () => {
  const { toLegacyTodayPlan } = await loadAdapter();
  const source = makeSnapshot({ taskFacts: { todayTasks: [makeTask({ id: 'task-low', title: '低任务', priority: '低' }), makeTask({ id: 'task-high', title: '高任务', priority: '高', status: 'in_progress' })], counts: { pending: 1, inProgress: 1, postponed: 0, completed: 0 }, weekDays: [] } });
  const dto = toLegacyTodayPlan({ ...source, taskFacts: source.taskFacts }, generatedAt);
  assert.deepEqual(dto.priorityTasks.map((task) => [task.id, task.title, task.status]), [['task-high', '高任务', 'in_progress'], ['task-low', '低任务', 'pending']]);
});

test('Case 3: completed task preserves completion and progress parity', async () => {
  const { toLegacyTodayPlan } = await loadAdapter();
  const task = makeTask({ status: 'completed', completed: true, completedAt: generatedAt, progress: { completedQuestionCount: 10, correctCount: 8, minutesSpent: 30, reachedTarget: true } });
  const source = makeSnapshot({ taskFacts: { todayTasks: [task], counts: { pending: 0, inProgress: 0, postponed: 0, completed: 1 }, weekDays: [] } });
  const dto = toLegacyTodayPlan(source, generatedAt);
  assert.equal(dto.summary.completedTasks, 1);
  assert.equal(dto.priorityTasks[0].status, 'completed');
  assert.equal(dto.priorityTasks[0].progress.reachedTarget, true);
});

test('Case 4: postponed task keeps postponed status and availability facts', async () => {
  const { toLegacyTodayPlan } = await loadAdapter();
  const task = makeTask({ status: 'postponed', postponeCount: 2, nextAvailableAt: '2026-08-25T08:00:00.000Z' });
  const source = makeSnapshot({ taskFacts: { todayTasks: [task], counts: { pending: 0, inProgress: 0, postponed: 1, completed: 0 }, weekDays: [] } });
  const dto = toLegacyTodayPlan(source, generatedAt);
  assert.equal(dto.priorityTasks[0].status, 'postponed');
  assert.equal(dto.priorityTasks[0].postponeCount, 2);
  assert.equal(dto.priorityTasks[0].nextAvailableAt, '2026-08-25T08:00:00.000Z');
});

test('Case 5: review due preserves due count and item identity without recomputation', async () => {
  const { toLegacyTodayPlan } = await loadAdapter();
  const source = makeSnapshot({ reviewFacts: { dueCount: 9, overdueCount: 4, nextReviewAt: '2026-08-23T07:00:00.000Z', items: [{ questionId: 'q-due', nextReviewAt: '2026-08-23T07:00:00.000Z', reviewCount: 4, stability: 'review', overdue: true }] } });
  const dto = toLegacyTodayPlan(await project(source), generatedAt);
  assert.equal(dto.reviewDue, 9);
  assert.equal(dto.reviewDue, source.reviewFacts.dueCount);
});

test('Case 6: activity facts remain represented in summary without current-time dependence', async () => {
  const { toLegacyTodayPlan } = await loadAdapter();
  const source = makeSnapshot({ activityFacts: { streakDays: 7, isActiveToday: true, latestActivityAt: '2026-08-24T07:00:00.000Z' } });
  const dto = toLegacyTodayPlan(source, generatedAt);
  assert.equal(dto.summary.streakDays, 7);
  assert.equal(dto.generatedAt, generatedAt);
});

test('legacy shape is stable and conversion does not mutate snapshot or leak UI fields into it', async () => {
  const { toLegacyTodayPlan } = await loadAdapter();
  const source = makeSnapshot();
  const before = JSON.stringify(source);
  const dto = toLegacyTodayPlan(source, generatedAt);
  assert.deepEqual(legacyShape(dto).reviewDue, source.reviewFacts.dueCount);
  assert.equal(JSON.stringify(source), before);
  for (const forbidden of ['nextAction', 'recommendation', 'priorityTasks', 'checkpointMessage']) {
    assert.equal(JSON.stringify(source).includes(forbidden), false);
  }
});
