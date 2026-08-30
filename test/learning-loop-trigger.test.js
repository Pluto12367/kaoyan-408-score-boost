import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

const { LearningLoopTriggerService } = require('../apps/api/src/study/learning-loop-trigger.service.ts');
const { StudyService } = require('../apps/api/src/study/study.service.ts');
const { loadTodayScoreCenterPlan } = require('../apps/api/src/score-center/repository.ts');

function createHarness(overrides = {}) {
  const events = overrides.events ?? [];
  const plans = overrides.plans ?? [];
  const state = {
    tasks: overrides.tasks ?? [
      { id: 'task-1', completed: true, status: 'completed', scheduledDate: '2026-08-31' },
    ],
    user: overrides.user ?? { examYear: 2026, dailyHours: 2 },
  };
  const learningLoopRepository = {
    loadTasksForDate: async () => state.tasks,
    loadUserRecommendationConfig: async () => state.user,
  };
  const userEvents = {
    async hasTriggerKey(userId, triggerKey) {
      return events.some((event) => event.userId === userId && event.payload?.triggerKey === triggerKey);
    },
    async record(userId, type, payload) {
      events.push({ userId, type, payload });
    },
  };
  const recommendation = {
    async generateDailyPlanFromState(userId, input) {
      plans.push({ userId, input });
      return { id: 'plan-1' };
    },
  };
  const service = new LearningLoopTriggerService(learningLoopRepository, recommendation, userEvents);
  return { service, events, plans };
}

test('task complete trigger generates next-day plan and emits one plan.generated event', async () => {
  const { service, events, plans } = createHarness();

  const result = await service.maybeGenerateLearningLoopPlan('u-1', {
    triggerType: 'task.complete',
    sourceId: 'task-1',
    scheduledDate: '2026-08-31',
  });

  assert.equal(result.status, 'generated');
  assert.equal(plans.length, 1);
  assert.equal(plans[0].input.scheduledDate, '2026-09-01');
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'plan.generated');
  assert.deepEqual(events[0].payload, {
    planId: 'plan-1',
    scheduledDate: '2026-09-01',
    triggerType: 'task.complete',
    sourceId: 'task-1',
    triggerKey: 'learning-loop:u-1:2026-09-01',
  });
});

test('duplicate trigger is skipped by triggerKey', async () => {
  const { service, events, plans } = createHarness({ events: [{
    userId: 'u-1',
    type: 'plan.generated',
    payload: { triggerKey: 'learning-loop:u-1:2026-09-01' },
  }] });

  const result = await service.maybeGenerateLearningLoopPlan('u-1', {
    triggerType: 'task.complete', sourceId: 'task-1', scheduledDate: '2026-08-31',
  });

  assert.equal(result.status, 'skipped');
  assert.equal(plans.length, 0);
  assert.equal(events.length, 1);
});

test('generation failure is contained and does not emit plan.generated', async () => {
  const harness = createHarness();
  harness.service['recommendation'].generateDailyPlanFromState = async () => {
    throw new Error('recommendation unavailable');
  };

  const result = await harness.service.maybeGenerateLearningLoopPlan('u-1', {
    triggerType: 'stage_assessment', sourceId: 'session-1', scheduledDate: '2026-08-31',
  });

  assert.equal(result.status, 'failed');
  assert.equal(harness.events.length, 0);
});

test('stage assessment trigger requires no incomplete task before generating', async () => {
  const { service, plans } = createHarness({
    tasks: [{ id: 'task-1', completed: false, status: 'pending', scheduledDate: '2026-08-31' }],
  });

  const result = await service.maybeGenerateLearningLoopPlan('u-1', {
    triggerType: 'stage_assessment', sourceId: 'session-1', scheduledDate: '2026-08-31',
  });

  assert.equal(result.status, 'generated');
  assert.equal(plans.length, 1);
});

test('AnswerReceipt replay path does not invoke the learning-loop trigger', async () => {
  const source = await readFile('apps/api/src/study/study.service.ts', 'utf8');
  const replayStart = source.indexOf('private async resolveExistingAnswerReceipt(');
  const replayEnd = source.indexOf('private async createPracticeRecordFromExistingPending(', replayStart);
  const replayMethod = source.slice(replayStart, replayEnd);

  assert.match(replayMethod, /status === 'SUCCEEDED'\) return/);
  assert.doesNotMatch(replayMethod, /maybeGenerateLearningLoopPlan/);
});

test('today score-center plan remains queryable after tomorrow plan is created', async () => {
  const plans = [
    {
      id: 'tomorrow-plan', userId: 'u-1', source: 'score-center', status: 'ACTIVE',
      createdAt: new Date('2026-08-31T01:00:00Z'),
      tasks: [{ id: 'tomorrow-task', scheduledDate: '2026-09-01', generatedRank: 1 }],
    },
    {
      id: 'today-plan', userId: 'u-1', source: 'score-center', status: 'ARCHIVED',
      createdAt: new Date('2026-08-30T01:00:00Z'),
      tasks: [{ id: 'today-task', scheduledDate: '2026-08-30', generatedRank: 1 }],
    },
  ];
  const prisma = {
    studyPlan: {
      findFirst: async ({ where }) => plans
        .filter((plan) => plan.userId === where.userId && plan.source === where.source)
        .filter((plan) => plan.tasks.some((task) => task.scheduledDate === where.tasks.some.scheduledDate))
        .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null,
    },
  };

  const today = await loadTodayScoreCenterPlan(prisma, 'u-1', '2026-08-30');
  const tomorrow = await loadTodayScoreCenterPlan(prisma, 'u-1', '2026-09-01');
  assert.equal(today.id, 'today-plan');
  assert.equal(tomorrow.id, 'tomorrow-plan');
});

test('repository boundary keeps Prisma access out of the trigger service', async () => {
  const source = await readFile('apps/api/src/study/learning-loop-trigger.service.ts', 'utf8');
  assert.doesNotMatch(source, /prisma\./);
  assert.match(source, /LearningLoopRepository/);
});

test('StudyService keeps task completion successful when plan generation fails', async () => {
  const completionRows = [];
  const eventRows = [];
  const unavailable = { enabled: false };
  const learningProgress = {
    enabled: true,
    async saveTaskCompletion(input) { completionRows.push(input); },
  };
  const userEvents = {
    async record(userId, type, payload) { eventRows.push({ userId, type, payload }); },
  };
  const authenticatedUsers = {
    get: (id) => ({ id, name: 'Student', role: 'student' }),
  };
  const trigger = {
    async maybeGenerateLearningLoopPlan() { throw new Error('recommendation unavailable'); },
  };
  const dependencies = [
    { listQuestions: () => [], findQuestionById: async () => null },
    unavailable,
    { enabled: false, save: async (record) => record },
    learningProgress,
    unavailable,
    unavailable,
    unavailable,
    unavailable,
    unavailable,
    unavailable,
    { enabled: false, saveSchedule: async () => {} },
    unavailable,
    { enabled: false },
    unavailable,
    authenticatedUsers,
    unavailable,
    unavailable,
    unavailable,
    userEvents,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    trigger,
  ];
  const service = new StudyService(...dependencies);
  const task = {
    id: 'task-1', knowledgePointId: 'kp-1', subject: '数据结构', chapter: '', title: 'Task',
    mode: '训练', minutes: 30, questionCount: 1, scheduledDate: '2026-08-30', priority: '高',
    reason: '', nextAction: '', status: 'pending', postponeCount: 0,
  };
  service.sevenDayPlansByUser.set('u-1', {
    id: 'plan-1', userId: 'u-1', phase: '强化', targetScore: 120, remainingDays: 90,
    dailyHours: 2, checkpoint: '', startDate: '2026-08-30', tasks: [task],
  });

  const result = await service.completeStudyTask('task-1', {
    userId: 'u-1', completedQuestionCount: 1, correctCount: 1, minutesSpent: 5, selfRating: 3,
  });

  assert.equal(result.status, 'completed');
  assert.equal(completionRows.length, 1);
  assert.deepEqual(eventRows.map((event) => event.type), ['task.complete']);
});
