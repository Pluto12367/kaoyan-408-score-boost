import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

test('buildStudyRemindersDto builds reminders from active student-state signals in priority order', () => {
  const { buildStudyRemindersDto } = require('../apps/api/src/study/student-state-reminder.adapter.ts');

  const result = buildStudyRemindersDto({
    userId: 'u-1',
    generatedAt: new Date('2026-08-24T08:30:00.000Z'),
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
    wrongQuestion: {
      questionId: 'q-1',
      knowledgePointTitle: 'Cache 映射与替换',
      wrongCount: 2,
      reviewStatus: 'pending',
    },
    todayTasks: [
      {
        id: 'task-done',
        title: '已完成任务',
        status: 'completed',
        scheduledDate: '2026-08-24',
        completed: true,
        completedAt: '2026-08-24T07:00:00.000Z',
        priority: '低',
        mode: '练习',
        questionCount: 5,
        minutes: 10,
        completedQuestionCount: 5,
        correctCount: 5,
        minutesSpent: 10,
        reachedTarget: true,
      },
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
    activity: {
      streakDays: 0,
      todayPracticeCount: 0,
    },
    trial: {
      completedCount: 2,
      totalCount: 5,
    },
  });

  assert.deepEqual(result, {
    userId: 'u-1',
    title: '今日提分提醒',
    generatedAt: '2026-08-24T08:30:00.000Z',
    items: [
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
        id: 'wrong-q-1',
        type: 'wrong-question',
        priority: 'high',
        title: '先复盘一道错题',
        reason: 'Cache 映射与替换 已累计 2 次错误记录。',
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
        reason: '还有 3 个核心流程待体验，便于后续填问卷。',
        actionText: '去体验',
        actionAnchor: '#trial',
      },
    ],
  });
});

test('buildStudyRemindersDto uses feedback follow-up when trial is complete', () => {
  const { buildStudyRemindersDto } = require('../apps/api/src/study/student-state-reminder.adapter.ts');

  const result = buildStudyRemindersDto({
    userId: 'u-2',
    generatedAt: '2026-08-24T09:00:00.000Z',
    weakPoints: [],
    wrongQuestion: null,
    todayTasks: [],
    activity: {
      streakDays: 3,
      todayPracticeCount: 8,
    },
    trial: {
      completedCount: 5,
      totalCount: 5,
    },
  });

  assert.deepEqual(result.items, [
    {
      id: 'feedback-followup',
      type: 'feedback',
      priority: 'low',
      title: '试用完成后记得补充建议',
      reason: '你已走完核心流程，可以将真实备考需求写入问卷。',
      actionText: '去反馈',
      actionAnchor: '#feedback',
    },
  ]);
});
