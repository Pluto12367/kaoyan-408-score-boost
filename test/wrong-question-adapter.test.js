import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

test('toLegacyWrongQuestions maps currentWrongItems to legacy WrongQuestion DTOs', () => {
  const {
    toLegacyWrongQuestions,
  } = require('../apps/api/src/study/wrong-question.adapter.ts');

  const result = toLegacyWrongQuestions(snapshotFixture());

  assert.deepEqual(result, [
    {
      questionId: 'q-pending',
      stem: '页表题',
      answer: 'A',
      analysis: '页表解析',
      knowledgePointId: 'kp-os',
      knowledgePointTitle: '页式存储管理',
      subject: '操作系统',
      chapter: '内存管理',
      wrongCount: 2,
      latestMistakeReason: '概念不清',
      latestSubmittedAt: '2026-08-23T08:00:00.000Z',
      reviewStatus: 'pending',
      reviewedAt: null,
      masteryStatus: '未掌握',
      masteryCriteria: {
        stability: 'learning',
        consecutiveCorrect: 0,
        variantCorrectCount: 0,
      },
      importance: 5,
    },
    {
      questionId: 'q-reviewed',
      stem: '链表题',
      answer: undefined,
      analysis: undefined,
      knowledgePointId: 'kp-ds',
      knowledgePointTitle: '链表',
      subject: '数据结构',
      chapter: '线性表',
      wrongCount: 1,
      latestMistakeReason: null,
      latestSubmittedAt: '2026-08-22T08:00:00.000Z',
      reviewStatus: 'reviewed',
      reviewedAt: '2026-08-22T10:00:00.000Z',
      masteryStatus: '复习中',
      masteryCriteria: {
        stability: 'review',
        consecutiveCorrect: 1,
        variantCorrectCount: 2,
      },
      importance: 4,
    },
  ]);
});

test('toLegacyWrongQuestionSummary derives resolvedCount and adapter-only summary fields', () => {
  const {
    toLegacyWrongQuestionSummary,
  } = require('../apps/api/src/study/wrong-question.adapter.ts');

  const result = toLegacyWrongQuestionSummary(snapshotFixture(), '2026-08-24T08:30:00.000Z');

  assert.equal(result.userId, 'u-1');
  assert.equal(result.pendingCount, 1);
  assert.equal(result.reviewedCount, 1);
  assert.equal(result.resolvedCount, 1);
  assert.equal(result.totalWrongCount, 2);
  assert.deepEqual(result.masteryStats, [
    { status: '未掌握', count: 1 },
    { status: '复习中', count: 1 },
    { status: '已掌握', count: 0 },
  ]);
  assert.deepEqual(result.mistakeReasonStats, [
    { reason: '概念不清', count: 2 },
    { reason: '待归因', count: 1 },
  ]);
  assert.deepEqual(result.priorityRedoItems, [
    {
      questionId: 'q-pending',
      stem: '页表题',
      knowledgePointTitle: '页式存储管理',
      wrongCount: 2,
      latestMistakeReason: '概念不清',
      reviewStatus: 'pending',
      nextAction: '先标记复盘，写出错误原因后再重做。',
    },
    {
      questionId: 'q-reviewed',
      stem: '链表题',
      knowledgePointTitle: '链表',
      wrongCount: 1,
      latestMistakeReason: null,
      reviewStatus: 'reviewed',
      nextAction: '进入重做模式，确认是否已经真正解决。',
    },
  ]);
  assert.deepEqual(result.nextReviewActions, [
    '先复盘 1 道待处理错题，补全错因。',
    '优先重做 页式存储管理，它的错误次数最高。',
    '已有 1 道错题通过重做解决，继续保持闭环。',
  ]);
  assert.equal(result.generatedAt, '2026-08-24T08:30:00.000Z');
});

test('toLegacyDueReviews maps dueItems to legacy due review DTO and legacy nextAction', () => {
  const {
    toLegacyDueReviews,
  } = require('../apps/api/src/study/wrong-question.adapter.ts');

  const result = toLegacyDueReviews(snapshotFixture());

  assert.deepEqual(result, {
    userId: 'u-1',
    dueCount: 1,
    items: [
      {
        questionId: 'q-pending',
        userId: 'u-1',
        selfReportedReason: '定义没记牢',
        redoCorrect: false,
        timeSpentSec: 70,
        consecutiveCorrect: 0,
        stability: 'learning',
        nextReviewAt: '2026-08-24T07:30:00.000Z',
        reviewCount: 1,
        lastReviewedAt: undefined,
        inferredReason: '概念不清',
        note: '',
        stem: '页表题',
        knowledgePointTitle: '页式存储管理',
        subject: '操作系统',
      },
    ],
    nextAction: '今天有 1 道错题需要复习，优先从最早到期的开始。',
  });
});

test('toLegacyDueReviews keeps legacy empty nextAction', () => {
  const {
    toLegacyDueReviews,
  } = require('../apps/api/src/study/wrong-question.adapter.ts');
  const snapshot = { ...snapshotFixture(), dueItems: [] };

  const result = toLegacyDueReviews(snapshot);

  assert.equal(result.dueCount, 0);
  assert.deepEqual(result.items, []);
  assert.equal(result.nextAction, '暂无到期复习任务，可以开始新的练习。');
});

test('wrong question adapter is pure and does not mutate snapshot with business strategy fields', () => {
  const {
    toLegacyWrongQuestions,
    toLegacyWrongQuestionSummary,
    toLegacyDueReviews,
  } = require('../apps/api/src/study/wrong-question.adapter.ts');
  const snapshot = snapshotFixture();
  const before = JSON.stringify(snapshot);

  toLegacyWrongQuestions(snapshot);
  toLegacyWrongQuestionSummary(snapshot, '2026-08-24T08:30:00.000Z');
  toLegacyDueReviews(snapshot);

  assert.equal(JSON.stringify(snapshot), before);
  for (const forbidden of ['recommendation', 'similarQuestions', 'filters']) {
    assert.equal(JSON.stringify(snapshot).includes(forbidden), false);
  }
});

function snapshotFixture() {
  return {
    source: 'practice_record_wrong_question_review_review_schedule',
    userId: 'u-1',
    asOf: '2026-08-24T08:00:00.000Z',
    currentWrongItems: [
      currentItem({
        questionId: 'q-pending',
        stem: '页表题',
        answer: 'A',
        analysis: '页表解析',
        knowledgePointId: 'kp-os',
        knowledgePointTitle: '页式存储管理',
        subject: '操作系统',
        chapter: '内存管理',
        importance: 5,
        wrongCount: 2,
        latestMistakeReason: '概念不清',
        latestSubmittedAt: '2026-08-23T08:00:00.000Z',
        review: { reviewedAt: null, resolved: null, resolvedAt: null },
        masteryCriteria: { stability: 'learning', consecutiveCorrect: 0, variantCorrectCount: 0 },
      }),
      currentItem({
        questionId: 'q-reviewed',
        stem: '链表题',
        answer: null,
        analysis: null,
        knowledgePointId: 'kp-ds',
        knowledgePointTitle: '链表',
        subject: '数据结构',
        chapter: '线性表',
        importance: 4,
        wrongCount: 1,
        latestMistakeReason: null,
        latestSubmittedAt: '2026-08-22T08:00:00.000Z',
        review: {
          reviewedAt: '2026-08-22T10:00:00.000Z',
          resolved: false,
          resolvedAt: null,
        },
        masteryCriteria: { stability: 'review', consecutiveCorrect: 1, variantCorrectCount: 2 },
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
        questionId: 'q-pending',
        stem: '页表题',
        knowledgePointId: 'kp-os',
        knowledgePointTitle: '页式存储管理',
        subject: '操作系统',
        stability: 'learning',
        consecutiveCorrect: 0,
        nextReviewAt: '2026-08-24T07:30:00.000Z',
        reviewCount: 1,
        lastReviewedAt: null,
        selfReportedReason: '定义没记牢',
        inferredReason: '概念不清',
        note: '',
        redoCorrect: false,
        timeSpentSec: 70,
      },
    ],
    mistakeReasonStats: [
      { reason: '概念不清', count: 2 },
      { reason: '待归因', count: 1 },
    ],
  };
}

function currentItem(overrides = {}) {
  return {
    questionId: valueOr(overrides, 'questionId', 'q-default'),
    stem: valueOr(overrides, 'stem', '默认题'),
    answer: valueOr(overrides, 'answer', 'A'),
    analysis: valueOr(overrides, 'analysis', '默认解析'),
    knowledgePointId: valueOr(overrides, 'knowledgePointId', 'kp-os'),
    knowledgePointTitle: valueOr(overrides, 'knowledgePointTitle', '页式存储管理'),
    subject: valueOr(overrides, 'subject', '操作系统'),
    chapter: valueOr(overrides, 'chapter', '内存管理'),
    importance: valueOr(overrides, 'importance', 5),
    latestCorrect: valueOr(overrides, 'latestCorrect', false),
    latestMistakeReason: valueOr(overrides, 'latestMistakeReason', '概念不清'),
    latestSubmittedAt: valueOr(overrides, 'latestSubmittedAt', '2026-08-23T08:00:00.000Z'),
    wrongCount: valueOr(overrides, 'wrongCount', 1),
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

function valueOr(object, key, fallback) {
  return Object.prototype.hasOwnProperty.call(object, key) ? object[key] : fallback;
}
