import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadAdapter() {
  const source = await readFile(new URL('../apps/api/src/study/today-plan.adapter.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    fileName: 'today-plan.adapter.ts',
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const localRequire = (specifier) => {
    throw new Error(`Unexpected adapter dependency: ${specifier}`);
  };
  Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
  return module.exports;
}

function snapshot(overrides = {}) {
  return {
    source: 'today_plan_student_state_score_center',
    userId: 'u-1',
    asOf: '2026-08-24T08:00:00.000Z',
    planFacts: {
      planId: 'plan-1', phase: '强化', status: 'ACTIVE', windowStart: '2026-08-18', windowEnd: '2026-08-24',
      generatedAt: '2026-08-18T00:00:00.000Z', checkpointState: 'checkpoint-fact',
    },
    taskFacts: {
      todayTasks: [
        { id: 'task-low', knowledgePointId: 'kp-2', questionIds: null, title: '低优先级', subject: '数据结构', chapter: '线性表', minutes: 20, questionCount: 5, mode: '专项训练', priority: '低', scheduledDate: '2026-08-24', status: 'pending', completed: false, completedAt: null, startedAt: null, postponeCount: 0, nextAvailableAt: null, progress: null },
        { id: 'task-high', knowledgePointId: 'kp-1', questionIds: ['q-1'], title: '高优先级', subject: '操作系统', chapter: '内存管理', minutes: 30, questionCount: 10, mode: '错题回炉', priority: '高', scheduledDate: '2026-08-24', status: 'in_progress', completed: false, completedAt: null, startedAt: '2026-08-24T07:00:00.000Z', postponeCount: 0, nextAvailableAt: null, progress: { completedQuestionCount: 2, correctCount: 1, minutesSpent: 6, reachedTarget: false } },
      ],
      counts: { pending: 1, inProgress: 1, postponed: 0, completed: 0 },
      weekDays: [{ date: '2026-08-24', taskCount: 2, completedTasks: 0, totalMinutes: 50, focusKnowledgePointId: 'kp-1', focusCompleted: false }],
    },
    reviewFacts: { dueCount: 2, overdueCount: 1, nextReviewAt: '2026-08-23T07:00:00.000Z', items: [{ questionId: 'q-1', nextReviewAt: '2026-08-23T07:00:00.000Z', reviewCount: 1, stability: 'learning', overdue: true }, { questionId: 'q-2', nextReviewAt: '2026-08-24T07:00:00.000Z', reviewCount: 2, stability: 'review', overdue: false }] },
    activityFacts: { streakDays: 4, isActiveToday: true, latestActivityAt: '2026-08-24T07:30:00.000Z' },
    masteryFacts: { source: 'user_knowledge_mastery', averageMastery: 60, weakCount: 1, reviewCount: 2, masteredCount: 3, lastUpdatedAt: '2026-08-23T00:00:00.000Z', weakPoints: [] },
    scoreFacts: { available: false, generatedAt: null, raw: null },
    ...overrides,
  };
}

test('snapshot converts to legacy TodayPlan DTO', async () => {
  const { toLegacyTodayPlan } = await loadAdapter();
  const result = toLegacyTodayPlan(snapshot(), '2026-08-24T09:00:00.000Z');
  assert.equal(result.userId, 'u-1');
  assert.equal(result.phase, '强化');
  assert.equal(result.generatedAt, '2026-08-24T09:00:00.000Z');
  assert.equal(result.reviewDue, 2);
  assert.equal(result.summary.streakDays, 4);
  assert.equal(result.priorityTasks.length, 2);
  assert.equal(result.weekProgress[0].date, '2026-08-24');
  assert.equal(result.checkpoint, 'checkpoint-fact');
  assert.equal(result.scoreCenter, null);
});

test('empty snapshot returns legacy-safe empty DTO', async () => {
  const { toLegacyTodayPlan } = await loadAdapter();
  const empty = snapshot({
    planFacts: { planId: null, phase: '', status: 'EMPTY', windowStart: '', windowEnd: '', generatedAt: null, checkpointState: null },
    taskFacts: { todayTasks: [], counts: { pending: 0, inProgress: 0, postponed: 0, completed: 0 }, weekDays: [] },
    reviewFacts: { dueCount: 0, overdueCount: 0, nextReviewAt: null, items: [] },
    activityFacts: { streakDays: 0, isActiveToday: false, latestActivityAt: null },
    scoreFacts: { available: false, generatedAt: null, raw: null },
  });
  const result = toLegacyTodayPlan(empty);
  assert.equal(result.userId, 'u-1');
  assert.deepEqual(result.priorityTasks, []);
  assert.deepEqual(result.weekProgress, []);
  assert.equal(result.reviewDue, 0);
  assert.equal(result.scoreCenter, null);
});

test('task sorting uses only task facts and does not introduce recommendation logic', async () => {
  const { toLegacyTodayPlan } = await loadAdapter();
  const result = toLegacyTodayPlan(snapshot());
  assert.deepEqual(result.priorityTasks.map((task) => task.id), ['task-high', 'task-low']);
  assert.equal(result.priorityTasks[0].reason.includes('计划'), true);
  assert.equal(result.priorityTasks[0].nextAction.includes('开始'), true);
});

test('reviewDue is copied directly from reviewFacts', async () => {
  const { toLegacyTodayPlan } = await loadAdapter();
  const source = snapshot();
  const result = toLegacyTodayPlan(source);
  assert.equal(result.reviewDue, source.reviewFacts.dueCount);
});

test('adapter does not mutate the snapshot', async () => {
  const { toLegacyTodayPlan } = await loadAdapter();
  const source = snapshot();
  const before = JSON.stringify(source);
  toLegacyTodayPlan(source);
  assert.equal(JSON.stringify(source), before);
});

test('adapter is pure and has no database or framework dependency', async () => {
  const source = await readFile(new URL('../apps/api/src/study/today-plan.adapter.ts', import.meta.url), 'utf8');
  for (const forbidden of ['Prisma', '@nestjs', 'StudyService', 'Controller', 'Repository', 'fetch(', 'prisma.']) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must not be used by adapter`);
  }
});
