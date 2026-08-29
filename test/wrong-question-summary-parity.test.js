import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

const { StudyService } = require('../apps/api/src/study/study.service.ts');
const { WrongQuestionProjectionService } = require('../apps/api/src/study/wrong-question-projection.service.ts');
const { WrongQuestionQueryService } = require('../apps/api/src/study/wrong-question-query.service.ts');

const USER_ID = 'u-summary-parity';
const FIXED_NOW = '2026-08-24T08:30:00.000Z';
const POINT_ID = 'co-cache';

test('WrongQuestionQueryService summary parity matches legacy summary fields', async () => {
  const facts = createFacts();
  const legacyService = createLegacyService(facts);
  const queryService = new WrongQuestionQueryService(new WrongQuestionProjectionService(createReadOnlyPrisma(facts)));

  mock.timers.enable({ apis: ['Date'], now: new Date(FIXED_NOW) });
  try {
    const legacy = legacyService.getWrongQuestionSummary(USER_ID);
    const actual = await withDatabaseUrl(() => queryService.getWrongQuestionSummaryCompat(USER_ID));

    assert.deepEqual(pickSummaryStableFields(actual), pickSummaryStableFields(legacy));
    assert.equal(actual.resolvedCount, 2);
    assert.equal(
      actual.priorityRedoItems.some((item) => item.questionId === 'q-resolved-flag-latest-wrong'),
      true,
    );
  } finally {
    mock.timers.reset();
  }
});

function pickSummaryStableFields(summary) {
  return {
    pendingCount: summary.pendingCount,
    reviewedCount: summary.reviewedCount,
    resolvedCount: summary.resolvedCount,
    totalWrongCount: summary.totalWrongCount,
    masteryStats: summary.masteryStats,
    mistakeReasonStats: summary.mistakeReasonStats,
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
  service.knowledgePoints.splice(0, service.knowledgePoints.length, ...facts.knowledgePointsForLegacy);
  service.records.splice(0, service.records.length, ...facts.practiceRecordsForLegacy);
  service.wrongQuestionReviewDatesByUser.set(USER_ID, new Map([
    ['q-current-reviewed', '2026-08-22T12:00:00.000Z'],
  ]));
  service.reviewSchedules.clear();
  for (const schedule of facts.reviewSchedulesForLegacy) {
    service.reviewSchedules.set(`${schedule.userId}@${schedule.questionId}`, schedule);
  }
  return service;
}

function createFacts() {
  const questionsForLegacy = [
    question('q-current-pending', '当前未复盘错题'),
    question('q-current-reviewed', '当前已复盘错题'),
    question('q-resolved-flag-latest-wrong', 'Review 标记已解决但最新仍错'),
    question('q-resolved-a', '最新正确解决题 A'),
    question('q-resolved-b', '最新正确解决题 B'),
  ];
  const practiceRecordsForLegacy = [
    practiceRecord('r-1', 'q-current-pending', false, '概念不清', '2026-08-20T08:00:00.000Z'),
    practiceRecord('r-2', 'q-current-reviewed', false, '审题问题', '2026-08-20T09:00:00.000Z'),
    practiceRecord('r-3', 'q-resolved-flag-latest-wrong', false, '计算失误', '2026-08-20T10:00:00.000Z'),
    practiceRecord('r-4', 'q-resolved-a', false, null, '2026-08-20T11:00:00.000Z'),
    practiceRecord('r-5', 'q-resolved-a', true, null, '2026-08-21T08:00:00.000Z'),
    practiceRecord('r-6', 'q-resolved-b', false, '知识点混淆', '2026-08-21T09:00:00.000Z'),
    practiceRecord('r-7', 'q-resolved-b', true, null, '2026-08-22T08:00:00.000Z'),
    practiceRecord('r-8', 'q-current-pending', false, '概念不清', '2026-08-22T09:00:00.000Z'),
  ];
  const reviewSchedulesForLegacy = [
    reviewSchedule('q-current-pending', 'learning', 0),
    reviewSchedule('q-current-reviewed', 'review', 1),
    reviewSchedule('q-resolved-flag-latest-wrong', 'mastered', 3),
  ];
  const knowledgePointsForLegacy = [
    {
      id: POINT_ID,
      title: 'Cache 映射与替换',
      subject: '计算机组成原理',
      chapter: '存储系统',
      importance: 5,
      frequency: 5,
      prerequisites: [],
    },
  ];
  return {
    questionsForLegacy,
    practiceRecordsForLegacy,
    reviewSchedulesForLegacy,
    knowledgePointsForLegacy,
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
      { questionId: 'q-current-reviewed', reviewedAt: new Date('2026-08-22T12:00:00.000Z'), resolved: false, resolvedAt: null },
      { questionId: 'q-resolved-flag-latest-wrong', reviewedAt: null, resolved: true, resolvedAt: new Date('2026-08-22T13:00:00.000Z') },
    ],
    reviewSchedules: reviewSchedulesForLegacy.map((schedule) => ({
      questionId: schedule.questionId,
      stability: schedule.stability,
      consecutiveCorrect: schedule.consecutiveCorrect,
      nextReviewAt: new Date(schedule.nextReviewAt),
      reviewCount: schedule.reviewCount,
      lastReviewedAt: null,
      selfReportedReason: null,
      inferredReason: '概念不清',
      note: '',
      redoCorrect: false,
      timeSpentSec: 60,
    })),
    reviewAttempts: [],
    questions: questionsForLegacy.map((item) => ({
      id: item.id,
      stem: item.stem,
      answer: item.answer,
      analysis: item.analysis,
      knowledgePoints: item.knowledgePointIds.map((knowledgePointId) => ({ knowledgePointId })),
    })),
    knowledgePoints: knowledgePointsForLegacy.map((point) => ({
      id: point.id,
      title: point.title,
      subject: point.subject,
      chapter: point.chapter,
      importance: point.importance,
    })),
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

function practiceRecord(id, questionId, correct, mistakeReason, submittedAt) {
  return {
    id,
    userId: USER_ID,
    questionId,
    knowledgePointId: POINT_ID,
    knowledgePointIds: [POINT_ID],
    selectedAnswer: correct ? 'B' : 'A',
    correct,
    timeSpentSec: 60,
    expectedTimeSec: 60,
    mistakeReason,
    submittedAt,
    variantQuestionId: null,
  };
}

function reviewSchedule(questionId, stability, consecutiveCorrect) {
  return {
    questionId,
    userId: USER_ID,
    inferredReason: '概念不清',
    selfReportedReason: undefined,
    note: '',
    lastWrongRecordId: 'r-latest',
    redoCorrect: false,
    timeSpentSec: 60,
    consecutiveCorrect,
    stability,
    nextReviewAt: '2026-08-24T07:00:00.000Z',
    reviewCount: 1,
    lastReviewedAt: undefined,
  };
}

function question(id, stem) {
  return {
    id,
    stem,
    options: ['A', 'B', 'C', 'D'],
    answer: 'B',
    analysis: `${stem} analysis`,
    difficulty: '中等',
    type: '选择题',
    source: 'unit',
    expectedTimeSec: 60,
    knowledgePointIds: [POINT_ID],
  };
}

function disabledRepository() {
  return { enabled: false };
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
  process.env.DATABASE_URL = 'postgresql://unit-test/wrong-question-summary-parity';
  try {
    return await run();
  } finally {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
}
