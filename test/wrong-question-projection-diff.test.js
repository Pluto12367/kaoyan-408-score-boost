import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

const { StudyService } = require('../apps/api/src/study/study.service.ts');
const { buildWrongQuestionSnapshot } = require('../apps/api/src/study/wrong-question.snapshot.ts');

const USER_ID = 'u-wrong-diff';
const CURRENT_ID = 'q-current-diff';
const RESOLVED_ID = 'q-resolved-diff';
const VARIANT_ID = 'q-variant-diff';
const MASTERED_DUE_ID = 'q-mastered-diff';
const FUTURE_DUE_ID = 'q-future-diff';
const KNOWLEDGE_POINT_ID = 'co-cache';

test('wrong question snapshot currentWrongItems match legacy listWrongQuestions membership', () => {
  const { service, snapshot } = createDiffHarness();

  const legacy = service.listWrongQuestions(USER_ID);

  assert.deepEqual(snapshot.currentWrongItems.map((item) => item.questionId), legacy.map((item) => item.questionId));
  assert.deepEqual(
    snapshot.currentWrongItems.map((item) => ({
      questionId: item.questionId,
      wrongCount: item.wrongCount,
      latestMistakeReason: item.latestMistakeReason,
      latestSubmittedAt: item.latestSubmittedAt,
      knowledgePointId: item.knowledgePointId,
    })),
    legacy.map((item) => ({
      questionId: item.questionId,
      wrongCount: item.wrongCount,
      latestMistakeReason: item.latestMistakeReason,
      latestSubmittedAt: item.latestSubmittedAt,
      knowledgePointId: item.knowledgePointId,
    })),
  );
});

test('wrong question snapshot resolvedItems count matches legacy resolvedCount', () => {
  const { service, snapshot } = createDiffHarness();

  const legacySummary = service.getWrongQuestionSummary(USER_ID);

  assert.equal(snapshot.resolvedItems.length, legacySummary.resolvedCount);
  assert.deepEqual(snapshot.resolvedItems.map((item) => item.questionId), [RESOLVED_ID]);
});

test('wrong question snapshot dueItems match legacy getDueReviews membership', () => {
  const { service, snapshot } = createDiffHarness();

  const legacyDue = service.getDueReviews(USER_ID);

  assert.deepEqual(snapshot.dueItems.map((item) => item.questionId), legacyDue.items.map((item) => item.questionId));
  assert.deepEqual(
    snapshot.dueItems.map((item) => ({
      questionId: item.questionId,
      stem: item.stem,
      knowledgePointTitle: item.knowledgePointTitle,
      subject: item.subject,
      nextReviewAt: item.nextReviewAt,
      reviewCount: item.reviewCount,
      stability: item.stability,
    })),
    legacyDue.items.map((item) => ({
      questionId: item.questionId,
      stem: item.stem,
      knowledgePointTitle: item.knowledgePointTitle,
      subject: item.subject,
      nextReviewAt: item.nextReviewAt,
      reviewCount: item.reviewCount,
      stability: item.stability,
    })),
  );
});

test('wrong question snapshot masteryCriteria variantCorrectCount matches legacy listWrongQuestions', () => {
  const { service, snapshot } = createDiffHarness();

  const legacyCurrent = service.listWrongQuestions(USER_ID).find((item) => item.questionId === CURRENT_ID);
  const snapshotCurrent = snapshot.currentWrongItems.find((item) => item.questionId === CURRENT_ID);

  assert.equal(snapshotCurrent?.masteryCriteria.variantCorrectCount, legacyCurrent?.masteryCriteria.variantCorrectCount);
  assert.deepEqual(snapshotCurrent?.masteryCriteria, {
    stability: 'review',
    consecutiveCorrect: 1,
    variantCorrectCount: 1,
  });
});

function createDiffHarness() {
  const service = new StudyService(
    new FakeQuestionsService(),
    disabledRepository(),
    disabledRepository(),
    disabledRepository(),
    disabledRepository(),
    disabledRepository(),
    disabledRepository(),
    disabledRepository(),
    disabledRepository(),
    disabledRepository(),
    disabledRepository(),
    disabledRepository(),
    disabledRepository(),
    disabledRepository(),
    disabledRepository(),
    disabledRepository(),
    disabledRepository(),
    disabledRepository(),
    disabledRepository(),
  );
  const records = [
    practiceRecord({ id: 'r-1', questionId: CURRENT_ID, correct: false, submittedAt: '2026-08-20T08:00:00.000Z', mistakeReason: '概念不清' }),
    practiceRecord({ id: 'r-2', questionId: RESOLVED_ID, correct: false, submittedAt: '2026-08-20T09:00:00.000Z', mistakeReason: null }),
    practiceRecord({ id: 'r-3', questionId: RESOLVED_ID, correct: true, submittedAt: '2026-08-21T09:00:00.000Z', mistakeReason: null }),
    practiceRecord({ id: 'r-4', questionId: CURRENT_ID, correct: false, submittedAt: '2026-08-22T08:00:00.000Z', mistakeReason: '概念不清' }),
    practiceRecord({ id: 'r-5', questionId: VARIANT_ID, correct: true, submittedAt: '2026-08-22T10:00:00.000Z', variantQuestionId: CURRENT_ID, mistakeReason: null }),
  ];
  service.records.splice(0, service.records.length, ...records);
  service.wrongQuestionReviewDatesByUser.set(USER_ID, new Map([[CURRENT_ID, '2026-08-22T12:00:00.000Z']]));
  const currentSchedule = reviewSchedule({
    questionId: CURRENT_ID,
    stability: 'review',
    consecutiveCorrect: 1,
    nextReviewAt: '2000-01-01T00:00:00.000Z',
    reviewCount: 2,
  });
  const masteredSchedule = reviewSchedule({
    questionId: MASTERED_DUE_ID,
    stability: 'mastered',
    consecutiveCorrect: 3,
    nextReviewAt: '2000-01-01T00:00:00.000Z',
    reviewCount: 3,
  });
  const futureSchedule = reviewSchedule({
    questionId: FUTURE_DUE_ID,
    stability: 'learning',
    consecutiveCorrect: 0,
    nextReviewAt: '2999-01-01T00:00:00.000Z',
    reviewCount: 1,
  });
  service.reviewSchedules.clear();
  service.reviewSchedules.set(scheduleKey(USER_ID, CURRENT_ID), currentSchedule);
  service.reviewSchedules.set(scheduleKey(USER_ID, MASTERED_DUE_ID), masteredSchedule);
  service.reviewSchedules.set(scheduleKey(USER_ID, FUTURE_DUE_ID), futureSchedule);

  const questions = new FakeQuestionsService().listQuestions();
  const snapshot = buildWrongQuestionSnapshot({
    userId: USER_ID,
    asOf: '2026-08-24T08:00:00.000Z',
    practiceRecords: records,
    wrongQuestionReviews: [
      {
        questionId: CURRENT_ID,
        reviewedAt: '2026-08-22T12:00:00.000Z',
        resolved: false,
        resolvedAt: null,
      },
    ],
    reviewSchedules: [currentSchedule, masteredSchedule, futureSchedule],
    reviewAttempts: [],
    questions: questions.map((question) => ({
      id: question.id,
      stem: question.stem,
      answer: question.answer,
      analysis: question.analysis,
      knowledgePointIds: question.knowledgePointIds,
    })),
    knowledgePoints: service.knowledgePoints,
  });
  return { service, snapshot };
}

function disabledRepository() {
  return { enabled: false };
}

function scheduleKey(userId, questionId) {
  return `${userId}@${questionId}`;
}

function practiceRecord(overrides = {}) {
  return {
    id: overrides.id ?? `record-${overrides.questionId ?? CURRENT_ID}`,
    userId: USER_ID,
    questionId: overrides.questionId ?? CURRENT_ID,
    knowledgePointId: KNOWLEDGE_POINT_ID,
    knowledgePointIds: [KNOWLEDGE_POINT_ID],
    selectedAnswer: 'A',
    correct: overrides.correct ?? false,
    timeSpentSec: 60,
    expectedTimeSec: 60,
    mistakeReason: overrides.mistakeReason ?? (overrides.correct ? null : '概念不清'),
    submittedAt: overrides.submittedAt ?? '2026-08-20T08:00:00.000Z',
    variantQuestionId: overrides.variantQuestionId ?? null,
  };
}

function reviewSchedule(overrides = {}) {
  return {
    questionId: overrides.questionId ?? CURRENT_ID,
    userId: USER_ID,
    inferredReason: '概念不清',
    selfReportedReason: '概念混淆',
    note: '',
    lastWrongRecordId: 'r-4',
    redoCorrect: false,
    timeSpentSec: 60,
    consecutiveCorrect: overrides.consecutiveCorrect ?? 0,
    stability: overrides.stability ?? 'learning',
    nextReviewAt: overrides.nextReviewAt ?? '2000-01-01T00:00:00.000Z',
    reviewCount: overrides.reviewCount ?? 0,
    lastReviewedAt: undefined,
  };
}

class FakeQuestionsService {
  listQuestions() {
    return [
      question({ id: CURRENT_ID, stem: 'Cache 当前错题' }),
      question({ id: RESOLVED_ID, stem: 'Cache 已解决错题' }),
      question({ id: VARIANT_ID, stem: 'Cache 变式题' }),
      question({ id: MASTERED_DUE_ID, stem: 'Cache 已掌握到期题' }),
      question({ id: FUTURE_DUE_ID, stem: 'Cache 未来复习题' }),
    ];
  }
}

function question(overrides = {}) {
  return {
    id: overrides.id,
    stem: overrides.stem,
    options: ['A', 'B', 'C', 'D'],
    answer: 'B',
    analysis: 'Cache analysis',
    difficulty: '中等',
    type: '选择题',
    source: 'unit',
    expectedTimeSec: 60,
    knowledgePointIds: [KNOWLEDGE_POINT_ID],
  };
}
