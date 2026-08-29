import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

test('buildTrialProgressDto preserves legacy DTO shape and item order from student-state signals', () => {
  const { buildTrialProgressDto } = require('../apps/api/src/study/student-state-trial-progress.adapter.ts');

  const result = buildTrialProgressDto({
    snapshot: snapshot({
      goal: {
        ...baseGoal(),
        diagnosis: null,
        onboardingCompletedAt: '2026-08-20T00:00:00.000Z',
      },
      wrongQuestionSummary: {
        source: 'practice_record_wrong_question_review',
        total: 3,
        unresolved: 2,
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
    }),
    completedTaskCount: 0,
    completedPracticeSetCount: 0,
    wrongReviewCount: 0,
    feedbackCount: 1,
  });

  assert.deepEqual(result, {
    userId: 'u-1',
    title: '15 分钟体验任务',
    completedCount: 4,
    totalCount: 5,
    completionRate: 80,
    items: [
      {
        id: 'diagnostic',
        title: '提交入学诊断',
        description: '生成目标分、当前阶段和第一版学习计划。',
        completed: true,
        actionAnchor: '#dashboard',
      },
      {
        id: 'daily-task',
        title: '完成一个今日任务',
        description: '体验每日计划如何记录完成度和下一步建议。',
        completed: true,
        actionAnchor: '#plan',
      },
      {
        id: 'practice-set',
        title: '提交推荐题组',
        description: '体验系统按薄弱点生成题组并同步报告。',
        completed: false,
        actionAnchor: '#question',
      },
      {
        id: 'wrong-review',
        title: '标记一次错题复盘',
        description: '体验错题状态、相似题和复盘建议。',
        completed: true,
        actionAnchor: '#wrong-book',
      },
      {
        id: 'feedback',
        title: '提交体验反馈',
        description: '提交站内反馈或打开问卷补充建议。',
        completed: true,
        actionAnchor: '#feedback',
      },
    ],
    nextAction: '提交推荐题组',
  });
});

test('buildTrialProgressDto reports all-complete state from supplemental read signals', () => {
  const { buildTrialProgressDto } = require('../apps/api/src/study/student-state-trial-progress.adapter.ts');

  const result = buildTrialProgressDto({
    snapshot: snapshot({
      goal: {
        ...baseGoal(),
        diagnosis: '图与排序薄弱',
        onboardingCompletedAt: null,
      },
      wrongQuestionSummary: {
        source: 'practice_record_wrong_question_review',
        total: 0,
        unresolved: 0,
        reviewed: 0,
        resolved: 2,
        latestWrongAt: null,
      },
      studyTasks: {
        today: [],
        counts: {
          pending: 1,
          inProgress: 0,
          postponed: 0,
          completed: 0,
        },
      },
    }),
    completedTaskCount: 2,
    completedPracticeSetCount: 1,
    wrongReviewCount: 1,
    feedbackCount: 1,
  });

  assert.equal(result.completedCount, 5);
  assert.equal(result.totalCount, 5);
  assert.equal(result.completionRate, 100);
  assert.deepEqual(
    result.items.map((item) => [item.id, item.completed]),
    [
      ['diagnostic', true],
      ['daily-task', true],
      ['practice-set', true],
      ['wrong-review', true],
      ['feedback', true],
    ],
  );
  assert.equal(result.nextAction, '已完成全部体验任务，可以邀请同学填写问卷。');
});

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
