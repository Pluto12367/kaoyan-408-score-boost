import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

test('StudentStateTrialProgressQueryService builds trial progress from snapshot plus read-only counts', async () => {
  const { StudentStateTrialProgressQueryService } = require('../apps/api/src/study/student-state-trial-progress-query.service.ts');
  const snapshotCalls = [];
  const readCalls = [];
  const writeCalls = [];
  const service = new StudentStateTrialProgressQueryService(
    {
      async getSnapshot(userId, asOf) {
        snapshotCalls.push({ userId, asOf: asOf.toISOString() });
        return snapshot({
          goal: {
            ...baseGoal(),
            onboardingCompletedAt: '2026-08-20T00:00:00.000Z',
          },
        });
      },
    },
    createReadOnlyPrisma(readCalls, writeCalls),
  );

  const result = await withDatabaseUrl(() =>
    service.getTrialProgressCompat('u-1', new Date('2026-08-24T08:30:00.000Z')),
  );

  assert.deepEqual(snapshotCalls, [
    { userId: 'u-1', asOf: '2026-08-24T08:30:00.000Z' },
  ]);
  assert.deepEqual(writeCalls, []);
  assert.deepEqual(readCalls, [
    { name: 'studyTaskCompletion.count', query: { where: { userId: 'u-1' } } },
    {
      name: 'learningSession.count',
      query: {
        where: {
          userId: 'u-1',
          type: 'practice_set',
          completed: true,
        },
      },
    },
    { name: 'wrongQuestionReview.count', query: { where: { userId: 'u-1' } } },
    { name: 'feedbackSubmission.count', query: { where: { userId: 'u-1' } } },
  ]);
  assert.equal(result.userId, 'u-1');
  assert.equal(result.title, '15 分钟体验任务');
  assert.equal(result.completedCount, 4);
  assert.equal(result.totalCount, 5);
  assert.equal(result.completionRate, 80);
  assert.deepEqual(
    result.items.map((item) => [item.id, item.completed]),
    [
      ['diagnostic', true],
      ['daily-task', true],
      ['practice-set', true],
      ['wrong-review', true],
      ['feedback', false],
    ],
  );
  assert.equal(result.nextAction, '提交体验反馈');
});

test('StudentStateTrialProgressQueryService does not access prisma without DATABASE_URL', async () => {
  const { StudentStateTrialProgressQueryService } = require('../apps/api/src/study/student-state-trial-progress-query.service.ts');
  const snapshotCalls = [];
  const readCalls = [];
  const writeCalls = [];
  const service = new StudentStateTrialProgressQueryService(
    {
      async getSnapshot(userId, asOf) {
        snapshotCalls.push({ userId, asOf: asOf.toISOString() });
        return snapshot({
          userId,
          goal: {
            ...baseGoal(),
            diagnosis: '图与排序薄弱',
          },
          wrongQuestionSummary: {
            source: 'practice_record_wrong_question_review',
            total: 2,
            unresolved: 1,
            reviewed: 1,
            resolved: 0,
            latestWrongAt: '2026-08-23T10:00:00.000Z',
          },
          studyTasks: {
            today: [],
            counts: {
              pending: 0,
              inProgress: 0,
              postponed: 0,
              completed: 1,
            },
          },
        });
      },
    },
    createReadOnlyPrisma(readCalls, writeCalls),
  );

  const result = await withoutDatabaseUrl(() =>
    service.getTrialProgressCompat('u-demo', '2026-08-24T09:00:00.000Z'),
  );

  assert.deepEqual(snapshotCalls, [
    { userId: 'u-demo', asOf: '2026-08-24T09:00:00.000Z' },
  ]);
  assert.deepEqual(readCalls, []);
  assert.deepEqual(writeCalls, []);
  assert.equal(result.userId, 'u-demo');
  assert.equal(result.completedCount, 3);
  assert.equal(result.completionRate, 60);
  assert.deepEqual(
    result.items.map((item) => [item.id, item.completed]),
    [
      ['diagnostic', true],
      ['daily-task', true],
      ['practice-set', false],
      ['wrong-review', true],
      ['feedback', false],
    ],
  );
});

function createReadOnlyPrisma(readCalls, writeCalls, options = {}) {
  const write = (name) => async () => {
    writeCalls.push(name);
    throw new Error(`${name} must not be called`);
  };
  const read = (name, result) => async (query) => {
    readCalls.push({ name, query });
    return result;
  };
  return {
    studyTaskCompletion: {
      count: read('studyTaskCompletion.count', options.completedTaskCount ?? 1),
      findMany: read('studyTaskCompletion.findMany', []),
      findFirst: read('studyTaskCompletion.findFirst', null),
      create: write('studyTaskCompletion.create'),
      update: write('studyTaskCompletion.update'),
      upsert: write('studyTaskCompletion.upsert'),
      delete: write('studyTaskCompletion.delete'),
    },
    learningSession: {
      count: read('learningSession.count', options.completedPracticeSetCount ?? 1),
      findMany: read('learningSession.findMany', []),
      findFirst: read('learningSession.findFirst', null),
      create: write('learningSession.create'),
      update: write('learningSession.update'),
      upsert: write('learningSession.upsert'),
      delete: write('learningSession.delete'),
    },
    wrongQuestionReview: {
      count: read('wrongQuestionReview.count', options.wrongReviewCount ?? 1),
      findMany: read('wrongQuestionReview.findMany', []),
      findFirst: read('wrongQuestionReview.findFirst', null),
      create: write('wrongQuestionReview.create'),
      update: write('wrongQuestionReview.update'),
      upsert: write('wrongQuestionReview.upsert'),
      delete: write('wrongQuestionReview.delete'),
    },
    feedbackSubmission: {
      count: read('feedbackSubmission.count', options.feedbackCount ?? 0),
      findMany: read('feedbackSubmission.findMany', []),
      findFirst: read('feedbackSubmission.findFirst', null),
      create: write('feedbackSubmission.create'),
      update: write('feedbackSubmission.update'),
      upsert: write('feedbackSubmission.upsert'),
      delete: write('feedbackSubmission.delete'),
    },
    $transaction: write('$transaction'),
  };
}

async function withDatabaseUrl(run) {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://unit-test/student-state-trial-progress-query';
  try {
    return await run();
  } finally {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
}

async function withoutDatabaseUrl(run) {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    return await run();
  } finally {
    if (originalDatabaseUrl !== undefined) process.env.DATABASE_URL = originalDatabaseUrl;
  }
}

function snapshot(overrides = {}) {
  return {
    userId: 'u-1',
    asOf: '2026-08-24T08:30:00.000Z',
    goal: baseGoal(),
    mastery: {
      source: 'user_knowledge_mastery',
      nodeCount: 0,
      practicedNodeCount: 0,
      averageMastery: 0,
      weakCount: 0,
      reviewCount: 0,
      masteredCount: 0,
      lastUpdatedAt: null,
    },
    weakPoints: [],
    wrongQuestionSummary: {
      source: 'practice_record_wrong_question_review',
      total: 0,
      unresolved: 0,
      reviewed: 0,
      resolved: 0,
      latestWrongAt: null,
    },
    reviewDue: {
      dueCount: 0,
      overdueCount: 0,
      nextReviewAt: null,
      items: [],
    },
    studyTasks: {
      today: [],
      counts: {
        pending: 0,
        inProgress: 0,
        postponed: 0,
        completed: 0,
      },
    },
    assessmentSummary: {
      attemptCount: 0,
      bestScore: 0,
      latestAccuracyRate: 0,
      improvementText: '暂无评估记录。',
    },
    ...overrides,
  };
}

function baseGoal() {
  return {
    targetSchool: '北京邮电大学',
    targetScore: 110,
    currentScore: 82,
    dailyHours: 3,
    remainingDays: 70,
    stage: '强化',
    weakestSubject: '数据结构',
    diagnosis: null,
    examYear: 2027,
    onboardingCompletedAt: null,
  };
}
