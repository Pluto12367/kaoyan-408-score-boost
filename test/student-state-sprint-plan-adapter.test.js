import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

function baseSnapshot(overrides = {}) {
  return {
    userId: 'u-1',
    asOf: '2026-08-24T08:00:00.000Z',
    goal: {
      targetSchool: '南京大学',
      targetScore: 90,
      currentScore: 62,
      dailyHours: 3,
      remainingDays: 45,
      stage: '冲刺',
      weakestSubject: '操作系统',
      diagnosis: '需要集中补弱',
      examYear: 2027,
      onboardingCompletedAt: '2026-08-01T00:00:00.000Z',
    },
    mastery: {
      source: 'user_knowledge_mastery',
      nodeCount: 12,
      practicedNodeCount: 8,
      averageMastery: 58,
      weakCount: 2,
      reviewCount: 1,
      masteredCount: 3,
      lastUpdatedAt: '2026-08-24T07:00:00.000Z',
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
      {
        knowledgeNodeId: 'node-co-cache',
        subject: '计算机组成原理',
        chapter: '存储系统',
        title: 'Cache 映射与替换',
        masteryRate: 42,
        accuracyRate: 33,
        attempts: 6,
        wrongCount: 4,
      },
    ],
    wrongQuestionSummary: {
      source: 'practice_record_wrong_question_review',
      total: 4,
      unresolved: 4,
      reviewed: 0,
      resolved: 0,
      latestWrongAt: '2026-08-23T10:00:00.000Z',
    },
    reviewDue: {
      dueCount: 0,
      overdueCount: 0,
      nextReviewAt: null,
      items: [],
    },
    studyTasks: {
      today: [
        {
          id: 'task-os',
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
      bestScore: 62,
      latestAccuracyRate: 58,
      improvementText: '较上次提升 6 分',
    },
    ...overrides,
  };
}

test('buildSprintPlanDto builds a legacy-compatible seven-day plan from student-state fields', () => {
  const { buildSprintPlanDto } = require('../apps/api/src/study/student-state-sprint-plan.adapter.ts');

  const result = buildSprintPlanDto({
    snapshot: baseSnapshot(),
    generatedAt: new Date('2026-08-24T08:30:00.000Z'),
    dates: [
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
      '2026-08-28',
      '2026-08-29',
      '2026-08-30',
    ],
    dailyTargetQuestionCount: 30,
    todayPracticeCount: 0,
    accuracyRate: 58,
  });

  assert.deepEqual(result, {
    userId: 'u-1',
    title: '7 天冲刺计划',
    currentStage: '冲刺',
    scoreGap: 28,
    targetScore: 90,
    currentScore: 62,
    remainingDays: 45,
    weeklyQuestionTarget: 204,
    weeklyReviewTarget: 39,
    risks: [
      '剩余时间偏紧，需要优先保证高频考点和真题回看。',
      '错题本仍有 4 道待处理，建议每天至少复盘 5 道。',
      '当前正确率 58%，本周先稳住基础题正确率。',
      '今天还没有练习记录，建议先完成一组短题。',
    ],
    days: [
      {
        dayIndex: 1,
        date: '2026-08-24',
        focus: '进程同步',
        minutes: 180,
        questionTarget: 30,
        reviewTarget: 5,
        reason: '围绕 进程同步 做短周期补强，和当前薄弱点保持一致。',
      },
      {
        dayIndex: 2,
        date: '2026-08-25',
        focus: 'Cache 映射与替换',
        minutes: 180,
        questionTarget: 30,
        reviewTarget: 5,
        reason: '围绕 Cache 映射与替换 做短周期补强，和当前薄弱点保持一致。',
      },
      {
        dayIndex: 3,
        date: '2026-08-26',
        focus: '进程同步',
        minutes: 180,
        questionTarget: 22,
        reviewTarget: 6,
        reason: '每 3 天安排一次错题回看，避免只刷题不消化。',
      },
      {
        dayIndex: 4,
        date: '2026-08-27',
        focus: 'Cache 映射与替换',
        minutes: 180,
        questionTarget: 30,
        reviewTarget: 5,
        reason: '围绕 Cache 映射与替换 做短周期补强，和当前薄弱点保持一致。',
      },
      {
        dayIndex: 5,
        date: '2026-08-28',
        focus: '进程同步',
        minutes: 180,
        questionTarget: 30,
        reviewTarget: 5,
        reason: '围绕 进程同步 做短周期补强，和当前薄弱点保持一致。',
      },
      {
        dayIndex: 6,
        date: '2026-08-29',
        focus: 'Cache 映射与替换',
        minutes: 180,
        questionTarget: 22,
        reviewTarget: 6,
        reason: '每 3 天安排一次错题回看，避免只刷题不消化。',
      },
      {
        dayIndex: 7,
        date: '2026-08-30',
        focus: '阶段小测与错题回看',
        minutes: 180,
        questionTarget: 40,
        reviewTarget: 7,
        reason: '第 7 天用小测校验本周补弱效果，并回看仍未稳定的错题。',
      },
    ],
    generatedAt: '2026-08-24T08:30:00.000Z',
  });
});

test('buildSprintPlanDto falls back to student-state tasks and stable-risk copy', () => {
  const { buildSprintPlanDto } = require('../apps/api/src/study/student-state-sprint-plan.adapter.ts');

  const snapshot = baseSnapshot({
    userId: 'u-2',
    goal: {
      ...baseSnapshot().goal,
      targetScore: 75,
      currentScore: 82,
      dailyHours: null,
      remainingDays: 120,
      stage: '基础',
    },
    weakPoints: [],
    wrongQuestionSummary: {
      source: 'practice_record_wrong_question_review',
      total: 0,
      unresolved: 0,
      reviewed: 0,
      resolved: 2,
      latestWrongAt: null,
    },
    studyTasks: {
      today: [
        {
          id: 'task-ds',
          title: '线性表基础巩固',
          status: 'pending',
          scheduledDate: '2026-08-24',
          completed: false,
          completedAt: null,
          priority: '中',
          mode: '练习',
          questionCount: 8,
          minutes: 20,
          completedQuestionCount: 0,
          correctCount: 0,
          minutesSpent: 0,
          reachedTarget: false,
        },
      ],
      counts: {
        pending: 1,
        inProgress: 0,
        postponed: 0,
        completed: 0,
      },
    },
  });

  const result = buildSprintPlanDto({
    snapshot,
    generatedAt: '2026-08-24T09:00:00.000Z',
    dates: [
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
      '2026-08-28',
      '2026-08-29',
      '2026-08-30',
    ],
    dailyTargetQuestionCount: 100,
    todayPracticeCount: 3,
    accuracyRate: 72,
  });

  assert.equal(result.scoreGap, 0);
  assert.equal(result.currentStage, '基础');
  assert.equal(result.weeklyQuestionTarget, 414);
  assert.equal(result.weeklyReviewTarget, 11);
  assert.deepEqual(result.risks, [
    '当前节奏稳定，本周重点保持练习连续性和错题复盘质量。',
  ]);
  assert.deepEqual(result.days.map((day) => day.focus), [
    '线性表基础巩固',
    '线性表基础巩固',
    '线性表基础巩固',
    '线性表基础巩固',
    '线性表基础巩固',
    '线性表基础巩固',
    '阶段小测与错题回看',
  ]);
  assert.deepEqual(
    result.days.map((day) => day.minutes),
    [180, 180, 180, 180, 180, 180, 180],
  );
});
