import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

test('StudentStateReminderQueryService builds compatible reminders from snapshot plus read-only facts', async () => {
  const { StudentStateReminderQueryService } = require('../apps/api/src/study/student-state-reminder-query.service.ts');
  const snapshotCalls = [];
  const readCalls = [];
  const writeCalls = [];
  const service = new StudentStateReminderQueryService(
    {
      async getSnapshot(userId, asOf) {
        snapshotCalls.push({ userId, asOf: asOf.toISOString() });
        return snapshot();
      },
    },
    createReadOnlyPrisma(readCalls, writeCalls),
  );

  const result = await withDatabaseUrl(() =>
    service.getStudyRemindersCompat('u-1', new Date('2026-08-24T08:30:00.000Z')),
  );

  assert.deepEqual(snapshotCalls, [
    { userId: 'u-1', asOf: '2026-08-24T08:30:00.000Z' },
  ]);
  assert.deepEqual(writeCalls, []);
  assert.deepEqual(readCalls.map((call) => call.name).sort(), [
    'feedbackSubmission.count',
    'learningSession.count',
    'practiceRecord.findMany',
    'studyTaskCompletion.count',
    'wrongQuestionReview.count',
  ]);
  assert.equal(result.userId, 'u-1');
  assert.equal(result.title, '今日提分提醒');
  assert.equal(result.generatedAt, '2026-08-24T08:30:00.000Z');
  assert.deepEqual(result.items, [
    {
      id: 'weakness-node-os-sync',
      type: 'weakness',
      priority: 'high',
      title: '优先补强 进程同步',
      reason: '当前正确率 25%，提分空间较大。',
      actionText: '去练推荐题组',
      actionAnchor: '#question',
    },
    {
      id: 'wrong-q-due',
      type: 'wrong-question',
      priority: 'high',
      title: '先复盘一道错题',
      reason: '到期复盘题目 已累计 2 次错误记录。',
      actionText: '去复盘',
      actionAnchor: '#wrong-book',
    },
    {
      id: 'task-task-next',
      type: 'daily-task',
      priority: 'medium',
      title: '完成今日任务：进程同步专项训练',
      reason: '围绕当前薄弱点安排。',
      actionText: '去看计划',
      actionAnchor: '#plan',
    },
    {
      id: 'trial-progress',
      type: 'trial',
      priority: 'medium',
      title: '完成剩余体验任务',
      reason: '还有 1 个核心流程待体验，便于后续填问卷。',
      actionText: '去体验',
      actionAnchor: '#trial',
    },
  ]);
});

test('StudentStateReminderQueryService sends complete empty signals to the adapter', async () => {
  const { StudentStateReminderQueryService } = require('../apps/api/src/study/student-state-reminder-query.service.ts');
  const service = new StudentStateReminderQueryService(
    { async getSnapshot() { return emptySnapshot(); } },
    createReadOnlyPrisma([], [], {
      practiceRecords: [],
      completedTaskCount: 0,
      completedPracticeSetCount: 0,
      wrongReviewCount: 0,
      feedbackCount: 0,
    }),
  );

  const result = await withDatabaseUrl(() =>
    service.getStudyRemindersCompat('u-empty', '2026-08-24T09:00:00.000Z'),
  );

  assert.deepEqual(result, {
    userId: 'u-empty',
    title: '今日提分提醒',
    generatedAt: '2026-08-24T09:00:00.000Z',
    items: [
      {
        id: 'calendar-activity',
        type: 'habit',
        priority: 'medium',
        title: '今天还需要一次有效练习',
        reason: '学习日历会记录任务和练习，帮助你保持复习节奏。',
        actionText: '去刷题',
        actionAnchor: '#question',
      },
      {
        id: 'trial-progress',
        type: 'trial',
        priority: 'medium',
        title: '完成剩余体验任务',
        reason: '还有 5 个核心流程待体验，便于后续填问卷。',
        actionText: '去体验',
        actionAnchor: '#trial',
      },
    ],
  });
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
    practiceRecord: {
      findMany: read('practiceRecord.findMany', options.practiceRecords ?? [
        { submittedAt: new Date('2026-08-24T01:00:00.000Z') },
        { submittedAt: new Date('2026-08-23T01:00:00.000Z') },
      ]),
      create: write('practiceRecord.create'),
      update: write('practiceRecord.update'),
      upsert: write('practiceRecord.upsert'),
      delete: write('practiceRecord.delete'),
    },
    studyTaskCompletion: {
      count: read('studyTaskCompletion.count', options.completedTaskCount ?? 1),
      create: write('studyTaskCompletion.create'),
      update: write('studyTaskCompletion.update'),
      upsert: write('studyTaskCompletion.upsert'),
      delete: write('studyTaskCompletion.delete'),
    },
    learningSession: {
      count: read('learningSession.count', options.completedPracticeSetCount ?? 1),
      create: write('learningSession.create'),
      update: write('learningSession.update'),
      upsert: write('learningSession.upsert'),
      delete: write('learningSession.delete'),
    },
    wrongQuestionReview: {
      count: read('wrongQuestionReview.count', options.wrongReviewCount ?? 1),
      create: write('wrongQuestionReview.create'),
      update: write('wrongQuestionReview.update'),
      upsert: write('wrongQuestionReview.upsert'),
      delete: write('wrongQuestionReview.delete'),
    },
    feedbackSubmission: {
      count: read('feedbackSubmission.count', options.feedbackCount ?? 0),
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
  process.env.DATABASE_URL = 'postgresql://unit-test/student-state-reminder-query';
  try {
    return await run();
  } finally {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
}

function snapshot() {
  return {
    userId: 'u-1',
    asOf: '2026-08-24T08:30:00.000Z',
    goal: {
      targetSchool: '北京邮电大学',
      targetScore: 115,
      currentScore: 82,
      dailyHours: 4,
      remainingDays: 120,
      stage: '强化',
      weakestSubject: '操作系统',
      diagnosis: '进程同步薄弱',
      examYear: 2027,
      onboardingCompletedAt: '2026-08-20T00:00:00.000Z',
    },
    mastery: {
      source: 'user_knowledge_mastery',
      nodeCount: 2,
      practicedNodeCount: 2,
      averageMastery: 60,
      weakCount: 1,
      reviewCount: 0,
      masteredCount: 1,
      lastUpdatedAt: '2026-08-23T09:00:00.000Z',
    },
    weakPoints: [
      {
        knowledgeNodeId: 'node-os-sync',
        subject: '操作系统',
        chapter: '进程管理',
        title: '进程同步',
        masteryRate: 38,
        accuracyRate: 25,
        attempts: 4,
        wrongCount: 3,
      },
    ],
    wrongQuestionSummary: {
      source: 'practice_record_wrong_question_review',
      total: 2,
      unresolved: 2,
      reviewed: 0,
      resolved: 0,
      latestWrongAt: '2026-08-23T10:00:00.000Z',
    },
    reviewDue: {
      dueCount: 1,
      overdueCount: 0,
      nextReviewAt: '2026-08-24T00:00:00.000Z',
      items: [
        {
          questionId: 'q-due',
          nextReviewAt: '2026-08-24T00:00:00.000Z',
          reviewCount: 2,
          stability: 'learning',
          overdue: false,
        },
      ],
    },
    studyTasks: {
      today: [
        {
          id: 'task-next',
          title: '进程同步专项训练',
          status: 'pending',
          scheduledDate: '2026-08-24',
          completed: false,
          completedAt: null,
          priority: '高',
          mode: '练习',
          questionCount: 12,
          minutes: 30,
          completedQuestionCount: 0,
          correctCount: 0,
          minutesSpent: 0,
          reachedTarget: false,
          reason: '围绕当前薄弱点安排。',
        },
      ],
      counts: {
        pending: 1,
        inProgress: 0,
        postponed: 0,
        completed: 0,
      },
    },
    assessmentSummary: {
      attemptCount: 1,
      bestScore: 92,
      latestAccuracyRate: 76,
      improvementText: '继续保持。',
    },
  };
}

function emptySnapshot() {
  return {
    ...snapshot(),
    userId: 'u-empty',
    goal: {
      targetSchool: null,
      targetScore: null,
      currentScore: null,
      dailyHours: null,
      remainingDays: null,
      stage: null,
      weakestSubject: null,
      diagnosis: null,
      examYear: null,
      onboardingCompletedAt: null,
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
  };
}
