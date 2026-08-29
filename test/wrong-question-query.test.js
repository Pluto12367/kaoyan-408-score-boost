import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

test('WrongQuestionQueryService getWrongQuestionsCompat calls projection and filters legacy DTOs', async () => {
  const { WrongQuestionQueryService } = require('../apps/api/src/study/wrong-question-query.service.ts');
  const calls = [];
  const service = new WrongQuestionQueryService(fakeProjection(calls, snapshotFixture()));

  const result = await service.getWrongQuestionsCompat('u-1', {
    subject: '操作系统',
    knowledgePointId: 'kp-os',
    masteryStatus: '未掌握',
    reviewStatus: 'pending',
  });

  assert.deepEqual(calls, [{ userId: 'u-1' }]);
  assert.deepEqual(result.map((item) => ({
    questionId: item.questionId,
    wrongCount: item.wrongCount,
    masteryStatus: item.masteryStatus,
    reviewStatus: item.reviewStatus,
  })), [
    {
      questionId: 'q-pending-os',
      wrongCount: 2,
      masteryStatus: '未掌握',
      reviewStatus: 'pending',
    },
  ]);
});

test('WrongQuestionQueryService getWrongQuestionSummaryCompat calls projection and adapter summary', async () => {
  const { WrongQuestionQueryService } = require('../apps/api/src/study/wrong-question-query.service.ts');
  const calls = [];
  const service = new WrongQuestionQueryService(fakeProjection(calls, snapshotFixture()));

  mock.timers.enable({ apis: ['Date'], now: new Date('2026-08-24T08:30:00.000Z') });
  try {
    const result = await service.getWrongQuestionSummaryCompat('u-1');

    assert.deepEqual(calls, [{ userId: 'u-1' }]);
    assert.deepEqual({
      pendingCount: result.pendingCount,
      reviewedCount: result.reviewedCount,
      resolvedCount: result.resolvedCount,
      totalWrongCount: result.totalWrongCount,
      generatedAt: result.generatedAt,
      firstPriorityAction: result.priorityRedoItems[0]?.nextAction,
    }, {
      pendingCount: 2,
      reviewedCount: 1,
      resolvedCount: 1,
      totalWrongCount: 3,
      generatedAt: '2026-08-24T08:30:00.000Z',
      firstPriorityAction: '先标记复盘，写出错误原因后再重做。',
    });
  } finally {
    mock.timers.reset();
  }
});

test('WrongQuestionQueryService getDueReviewsCompat calls projection and adapter due DTO', async () => {
  const { WrongQuestionQueryService } = require('../apps/api/src/study/wrong-question-query.service.ts');
  const calls = [];
  const service = new WrongQuestionQueryService(fakeProjection(calls, snapshotFixture()));

  const result = await service.getDueReviewsCompat('u-1');

  assert.deepEqual(calls, [{ userId: 'u-1' }]);
  assert.deepEqual(result, {
    userId: 'u-1',
    dueCount: 1,
    items: [
      {
        questionId: 'q-pending-os',
        userId: 'u-1',
        selfReportedReason: undefined,
        redoCorrect: false,
        timeSpentSec: 70,
        consecutiveCorrect: 0,
        stability: 'learning',
        nextReviewAt: '2026-08-24T07:30:00.000Z',
        reviewCount: 1,
        lastReviewedAt: undefined,
        inferredReason: '概念不清',
        note: '',
        stem: 'OS pending',
        knowledgePointTitle: '进程同步与互斥',
        subject: '操作系统',
      },
    ],
    nextAction: '今天有 1 道错题需要复习，优先从最早到期的开始。',
  });
});

function fakeProjection(calls, snapshot) {
  return {
    async getSnapshot(userId) {
      calls.push({ userId });
      return snapshot;
    },
  };
}

function snapshotFixture() {
  return {
    source: 'practice_record_wrong_question_review_review_schedule',
    userId: 'u-1',
    asOf: '2026-08-24T08:00:00.000Z',
    currentWrongItems: [
      currentItem({
        questionId: 'q-pending-os',
        stem: 'OS pending',
        knowledgePointId: 'kp-os',
        knowledgePointTitle: '进程同步与互斥',
        subject: '操作系统',
        chapter: '进程管理',
        wrongCount: 2,
        review: { reviewedAt: null, resolved: null, resolvedAt: null },
        masteryCriteria: { stability: 'learning', consecutiveCorrect: 0, variantCorrectCount: 0 },
      }),
      currentItem({
        questionId: 'q-reviewed-os',
        stem: 'OS reviewed',
        knowledgePointId: 'kp-os',
        knowledgePointTitle: '进程同步与互斥',
        subject: '操作系统',
        chapter: '进程管理',
        wrongCount: 1,
        review: { reviewedAt: '2026-08-22T10:00:00.000Z', resolved: false, resolvedAt: null },
        masteryCriteria: { stability: 'review', consecutiveCorrect: 1, variantCorrectCount: 1 },
      }),
      currentItem({
        questionId: 'q-pending-ds',
        stem: 'DS pending',
        knowledgePointId: 'kp-ds',
        knowledgePointTitle: '链表',
        subject: '数据结构',
        chapter: '线性表',
        wrongCount: 3,
        review: { reviewedAt: null, resolved: null, resolvedAt: null },
        masteryCriteria: { stability: 'learning', consecutiveCorrect: 0, variantCorrectCount: 0 },
      }),
    ],
    resolvedItems: [
      {
        ...currentItem({
          questionId: 'q-resolved',
          latestCorrect: true,
          review: { reviewedAt: null, resolved: null, resolvedAt: null },
        }),
        latestCorrect: true,
        resolvedBy: 'latest_correct',
      },
    ],
    dueItems: [
      {
        questionId: 'q-pending-os',
        stem: 'OS pending',
        knowledgePointId: 'kp-os',
        knowledgePointTitle: '进程同步与互斥',
        subject: '操作系统',
        stability: 'learning',
        consecutiveCorrect: 0,
        nextReviewAt: '2026-08-24T07:30:00.000Z',
        reviewCount: 1,
        lastReviewedAt: null,
        selfReportedReason: null,
        inferredReason: '概念不清',
        note: '',
        redoCorrect: false,
        timeSpentSec: 70,
      },
    ],
    mistakeReasonStats: [
      { reason: '概念不清', count: 2 },
      { reason: '审题问题', count: 1 },
    ],
  };
}

function currentItem(overrides = {}) {
  return {
    questionId: overrides.questionId ?? 'q-default',
    stem: overrides.stem ?? 'Default question',
    answer: 'B',
    analysis: 'Analysis',
    knowledgePointId: overrides.knowledgePointId ?? 'kp-os',
    knowledgePointTitle: overrides.knowledgePointTitle ?? '进程同步与互斥',
    subject: overrides.subject ?? '操作系统',
    chapter: overrides.chapter ?? '进程管理',
    importance: 5,
    latestCorrect: overrides.latestCorrect ?? false,
    latestMistakeReason: '概念不清',
    latestSubmittedAt: '2026-08-23T08:00:00.000Z',
    wrongCount: overrides.wrongCount ?? 1,
    attemptCount: 1,
    attemptHistory: [],
    review: overrides.review ?? { reviewedAt: null, resolved: null, resolvedAt: null },
    reviewHistory: [],
    masteryCriteria: overrides.masteryCriteria ?? {
      stability: 'learning',
      consecutiveCorrect: 0,
      variantCorrectCount: 0,
    },
  };
}
