import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

const { StudyService } = require('../apps/api/src/study/study.service.ts');
const { WrongQuestionProjectionService } = require('../apps/api/src/study/wrong-question-projection.service.ts');

const USER_ID = 'u-adapter-diff';
const CURRENT_ID = 'q-current-adapter';
const RESOLVED_ID = 'q-resolved-adapter';
const VARIANT_ID = 'q-variant-adapter';
const FUTURE_ID = 'q-future-adapter';
const MASTERED_ID = 'q-mastered-adapter';
const KNOWLEDGE_POINT_ID = 'co-cache';

test('wrong question adapter list output matches legacy listWrongQuestions stable fields', async () => {
  const {
    toLegacyWrongQuestions,
  } = require('../apps/api/src/study/wrong-question.adapter.ts');
  const facts = createFacts();
  const legacy = createLegacyService(facts).listWrongQuestions(USER_ID);
  const projection = new WrongQuestionProjectionService(createReadOnlyPrisma(facts));

  const snapshot = await withDatabaseUrl(() => projection.getSnapshot(USER_ID, '2026-08-24T08:00:00.000Z'));
  const result = toLegacyWrongQuestions(snapshot);

  assert.deepEqual(
    result.map(pickListFields),
    legacy.map(pickListFields),
  );
});

test('wrong question adapter summary output matches legacy stable counts', async () => {
  const {
    toLegacyWrongQuestionSummary,
  } = require('../apps/api/src/study/wrong-question.adapter.ts');
  const facts = createFacts();
  const legacy = createLegacyService(facts).getWrongQuestionSummary(USER_ID);
  const projection = new WrongQuestionProjectionService(createReadOnlyPrisma(facts));

  const snapshot = await withDatabaseUrl(() => projection.getSnapshot(USER_ID, '2026-08-24T08:00:00.000Z'));
  const result = toLegacyWrongQuestionSummary(snapshot, '2026-08-24T08:30:00.000Z');

  assert.deepEqual(pickSummaryCounts(result), pickSummaryCounts(legacy));
});

test('wrong question adapter due output matches legacy getDueReviews stable fields', async () => {
  const {
    toLegacyDueReviews,
  } = require('../apps/api/src/study/wrong-question.adapter.ts');
  const facts = createFacts();
  const legacy = createLegacyService(facts).getDueReviews(USER_ID);
  const projection = new WrongQuestionProjectionService(createReadOnlyPrisma(facts));

  const snapshot = await withDatabaseUrl(() => projection.getSnapshot(USER_ID, '2026-08-24T08:00:00.000Z'));
  const result = toLegacyDueReviews(snapshot);

  assert.deepEqual(
    result.items.map(pickDueFields),
    legacy.items.map(pickDueFields),
  );
});

function pickListFields(item) {
  return {
    questionId: item.questionId,
    wrongCount: item.wrongCount,
    masteryStatus: item.masteryStatus,
  };
}

function pickSummaryCounts(summary) {
  return {
    pendingCount: summary.pendingCount,
    reviewedCount: summary.reviewedCount,
    resolvedCount: summary.resolvedCount,
    totalWrongCount: summary.totalWrongCount,
  };
}

function pickDueFields(item) {
  return {
    questionId: item.questionId,
    nextReviewAt: item.nextReviewAt,
  };
}

function createLegacyService(facts) {
  const service = new StudyService(
    new FakeQuestionsService(facts.questionsForLegacy),
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
  service.records.splice(0, service.records.length, ...facts.practiceRecordsForLegacy);
  service.wrongQuestionReviewDatesByUser.set(USER_ID, new Map([[CURRENT_ID, '2026-08-22T12:00:00.000Z']]));
  service.reviewSchedules.clear();
  for (const schedule of facts.reviewSchedulesForLegacy) {
    service.reviewSchedules.set(`${schedule.userId}@${schedule.questionId}`, schedule);
  }
  return service;
}

function createFacts() {
  const questionsForLegacy = [
    question({ id: CURRENT_ID, stem: 'Cache 当前错题' }),
    question({ id: RESOLVED_ID, stem: 'Cache 已解决错题' }),
    question({ id: VARIANT_ID, stem: 'Cache 变式题' }),
    question({ id: FUTURE_ID, stem: 'Cache 未来复习题' }),
    question({ id: MASTERED_ID, stem: 'Cache 已掌握复习题' }),
  ];
  const practiceRecordsForLegacy = [
    practiceRecord({ id: 'r-1', questionId: CURRENT_ID, correct: false, submittedAt: '2026-08-20T08:00:00.000Z', mistakeReason: '概念不清' }),
    practiceRecord({ id: 'r-2', questionId: RESOLVED_ID, correct: false, submittedAt: '2026-08-20T09:00:00.000Z', mistakeReason: null }),
    practiceRecord({ id: 'r-3', questionId: RESOLVED_ID, correct: true, submittedAt: '2026-08-21T09:00:00.000Z', mistakeReason: null }),
    practiceRecord({ id: 'r-4', questionId: CURRENT_ID, correct: false, submittedAt: '2026-08-22T08:00:00.000Z', mistakeReason: '概念不清' }),
    practiceRecord({ id: 'r-5', questionId: VARIANT_ID, correct: true, submittedAt: '2026-08-22T10:00:00.000Z', mistakeReason: null, variantQuestionId: CURRENT_ID }),
  ];
  const reviewSchedulesForLegacy = [
    reviewSchedule({ questionId: CURRENT_ID, stability: 'review', consecutiveCorrect: 1, nextReviewAt: '2000-01-01T00:00:00.000Z', reviewCount: 2 }),
    reviewSchedule({ questionId: FUTURE_ID, stability: 'learning', consecutiveCorrect: 0, nextReviewAt: '2999-01-01T00:00:00.000Z', reviewCount: 1 }),
    reviewSchedule({ questionId: MASTERED_ID, stability: 'mastered', consecutiveCorrect: 3, nextReviewAt: '2000-01-01T00:00:00.000Z', reviewCount: 3 }),
  ];

  return {
    questionsForLegacy,
    practiceRecordsForLegacy,
    reviewSchedulesForLegacy,
    practiceRecords: practiceRecordsForLegacy.map((record) => ({
      id: record.id,
      questionId: record.questionId,
      knowledgePointId: record.knowledgePointId,
      selectedAnswer: record.selectedAnswer,
      correct: record.correct,
      timeSpentSec: record.timeSpentSec,
      mistakeReason: record.mistakeReason,
      submittedAt: new Date(record.submittedAt),
      variantQuestionId: record.variantQuestionId ?? null,
    })),
    wrongQuestionReviews: [
      {
        questionId: CURRENT_ID,
        reviewedAt: new Date('2026-08-22T12:00:00.000Z'),
        resolved: false,
        resolvedAt: null,
      },
    ],
    reviewSchedules: reviewSchedulesForLegacy.map((schedule, index) => ({
      id: `schedule-${index}`,
      questionId: schedule.questionId,
      stability: schedule.stability,
      consecutiveCorrect: schedule.consecutiveCorrect,
      nextReviewAt: new Date(schedule.nextReviewAt),
      reviewCount: schedule.reviewCount,
      lastReviewedAt: schedule.lastReviewedAt ? new Date(schedule.lastReviewedAt) : null,
      selfReportedReason: schedule.selfReportedReason ?? null,
      inferredReason: schedule.inferredReason ?? null,
      note: schedule.note ?? null,
      redoCorrect: schedule.redoCorrect,
      timeSpentSec: schedule.timeSpentSec,
    })),
    reviewAttempts: [],
    questions: questionsForLegacy.map((item) => ({
      id: item.id,
      stem: item.stem,
      answer: item.answer,
      analysis: item.analysis,
      knowledgePoints: item.knowledgePointIds.map((knowledgePointId) => ({ knowledgePointId })),
    })),
    knowledgePoints: [
      {
        id: KNOWLEDGE_POINT_ID,
        title: 'Cache 映射与替换',
        subject: '计算机组成原理',
        chapter: '存储系统',
        importance: 5,
      },
    ],
  };
}

function createReadOnlyPrisma(facts) {
  const write = (name) => async () => {
    throw new Error(`${name} must not be called`);
  };
  const read = (result) => async () => result;
  const model = (result) => ({
    findMany: read(result),
    create: write('create'),
    update: write('update'),
    upsert: write('upsert'),
    delete: write('delete'),
    deleteMany: write('deleteMany'),
  });
  return {
    practiceRecord: model(facts.practiceRecords),
    wrongQuestionReview: model(facts.wrongQuestionReviews),
    reviewSchedule: model(facts.reviewSchedules),
    reviewAttempt: model(facts.reviewAttempts),
    question: model(facts.questions),
    knowledgePoint: model(facts.knowledgePoints),
    $transaction: write('$transaction'),
  };
}

function disabledRepository() {
  return { enabled: false };
}

function practiceRecord(overrides = {}) {
  return {
    id: overrides.id,
    userId: USER_ID,
    questionId: overrides.questionId,
    knowledgePointId: KNOWLEDGE_POINT_ID,
    knowledgePointIds: [KNOWLEDGE_POINT_ID],
    selectedAnswer: 'A',
    correct: overrides.correct,
    timeSpentSec: 60,
    expectedTimeSec: 60,
    mistakeReason: overrides.mistakeReason,
    submittedAt: overrides.submittedAt,
    variantQuestionId: overrides.variantQuestionId ?? null,
  };
}

function reviewSchedule(overrides = {}) {
  return {
    questionId: overrides.questionId,
    userId: USER_ID,
    inferredReason: '概念不清',
    selfReportedReason: '概念混淆',
    note: '',
    lastWrongRecordId: 'r-4',
    redoCorrect: false,
    timeSpentSec: 60,
    consecutiveCorrect: overrides.consecutiveCorrect,
    stability: overrides.stability,
    nextReviewAt: overrides.nextReviewAt,
    reviewCount: overrides.reviewCount,
    lastReviewedAt: undefined,
  };
}

function question(overrides) {
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

class FakeQuestionsService {
  constructor(questions) {
    this.questions = questions;
  }

  listQuestions() {
    return this.questions;
  }
}

async function withDatabaseUrl(run) {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://unit-test/wrong-question-adapter-diff';
  try {
    return await run();
  } finally {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
}
