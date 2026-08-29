import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

const { StudyService } = require('../apps/api/src/study/study.service.ts');
const { WrongQuestionProjectionService } = require('../apps/api/src/study/wrong-question-projection.service.ts');
const {
  toLegacyDueReviews,
  toLegacyWrongQuestionSummary,
  toLegacyWrongQuestions,
} = require('../apps/api/src/study/wrong-question.adapter.ts');

const USER_ID = 'u-legacy-read-parity';
const CURRENT_PENDING_ID = 'q-current-pending';
const CURRENT_REVIEWED_ID = 'q-current-reviewed';
const RESOLVED_ID = 'q-resolved';
const VARIANT_ID = 'q-variant';
const FUTURE_ID = 'q-future';
const MASTERED_ID = 'q-mastered';
const CO_POINT_ID = 'co-cache';
const OS_POINT_ID = 'os-sync';
const FIXED_NOW = '2026-08-24T08:30:00.000Z';

test('wrong question read model preserves legacy listWrongQuestions DTO fields', async () => {
  const facts = createFacts();
  const legacy = createLegacyService(facts).listWrongQuestions(USER_ID);
  const actual = await readViaProjectionAndAdapter(facts, toLegacyWrongQuestions);

  assert.deepEqual(actual, legacy);
});

test('wrong question read model preserves legacy getWrongQuestionSummary DTO fields', async () => {
  const facts = createFacts();
  const service = createLegacyService(facts);

  mock.timers.enable({ apis: ['Date'], now: new Date(FIXED_NOW) });
  try {
    const legacy = service.getWrongQuestionSummary(USER_ID);
    const actual = await readViaProjectionAndAdapter(facts, (snapshot) =>
      toLegacyWrongQuestionSummary(snapshot, FIXED_NOW),
    );

    assert.deepEqual(actual, legacy);
  } finally {
    mock.timers.reset();
  }
});

test('wrong question read model preserves legacy getDueReviews DTO fields', async () => {
  const facts = createFacts();
  const service = createLegacyService(facts);

  mock.timers.enable({ apis: ['Date'], now: new Date(FIXED_NOW) });
  try {
    const legacy = service.getDueReviews(USER_ID);
    const actual = await readViaProjectionAndAdapter(facts, toLegacyDueReviews);

    assert.deepEqual(normalizeDueReviews(actual), normalizeDueReviews(legacy));
  } finally {
    mock.timers.reset();
  }
});

async function readViaProjectionAndAdapter(facts, adapt) {
  const projection = new WrongQuestionProjectionService(createReadOnlyPrisma(facts));
  const snapshot = await withDatabaseUrl(() => projection.getSnapshot(USER_ID, FIXED_NOW));
  return adapt(snapshot);
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
    [CURRENT_REVIEWED_ID, '2026-08-22T12:00:00.000Z'],
  ]));
  service.reviewSchedules.clear();
  for (const schedule of facts.reviewSchedulesForLegacy) {
    service.reviewSchedules.set(`${schedule.userId}@${schedule.questionId}`, schedule);
  }
  return service;
}

function createFacts() {
  const questionsForLegacy = [
    question({ id: CURRENT_PENDING_ID, stem: 'Cache 当前未复盘错题', knowledgePointIds: [CO_POINT_ID] }),
    question({ id: CURRENT_REVIEWED_ID, stem: '同步当前已复盘错题', knowledgePointIds: [OS_POINT_ID] }),
    question({ id: RESOLVED_ID, stem: 'Cache 已解决错题', knowledgePointIds: [CO_POINT_ID] }),
    question({ id: VARIANT_ID, stem: 'Cache 变式题', knowledgePointIds: [CO_POINT_ID] }),
    question({ id: FUTURE_ID, stem: 'Cache 未来复习题', knowledgePointIds: [CO_POINT_ID] }),
    question({ id: MASTERED_ID, stem: '同步已掌握复习题', knowledgePointIds: [OS_POINT_ID] }),
  ];
  const practiceRecordsForLegacy = [
    practiceRecord({
      id: 'r-1',
      questionId: CURRENT_PENDING_ID,
      knowledgePointId: CO_POINT_ID,
      correct: false,
      mistakeReason: '概念不清',
      submittedAt: '2026-08-20T08:00:00.000Z',
    }),
    practiceRecord({
      id: 'r-2',
      questionId: CURRENT_REVIEWED_ID,
      knowledgePointId: OS_POINT_ID,
      correct: false,
      mistakeReason: '审题问题',
      submittedAt: '2026-08-20T09:00:00.000Z',
    }),
    practiceRecord({
      id: 'r-3',
      questionId: RESOLVED_ID,
      knowledgePointId: CO_POINT_ID,
      correct: false,
      mistakeReason: null,
      submittedAt: '2026-08-20T10:00:00.000Z',
    }),
    practiceRecord({
      id: 'r-4',
      questionId: RESOLVED_ID,
      knowledgePointId: CO_POINT_ID,
      correct: true,
      mistakeReason: null,
      submittedAt: '2026-08-21T10:00:00.000Z',
    }),
    practiceRecord({
      id: 'r-5',
      questionId: CURRENT_PENDING_ID,
      knowledgePointId: CO_POINT_ID,
      correct: false,
      mistakeReason: '概念不清',
      submittedAt: '2026-08-22T08:00:00.000Z',
    }),
    practiceRecord({
      id: 'r-6',
      questionId: CURRENT_REVIEWED_ID,
      knowledgePointId: OS_POINT_ID,
      correct: false,
      mistakeReason: '审题问题',
      submittedAt: '2026-08-22T09:00:00.000Z',
    }),
    practiceRecord({
      id: 'r-7',
      questionId: VARIANT_ID,
      knowledgePointId: CO_POINT_ID,
      correct: true,
      mistakeReason: null,
      submittedAt: '2026-08-22T11:00:00.000Z',
      variantQuestionId: CURRENT_PENDING_ID,
    }),
  ];
  const reviewSchedulesForLegacy = [
    reviewSchedule({
      questionId: CURRENT_PENDING_ID,
      stability: 'learning',
      consecutiveCorrect: 0,
      nextReviewAt: '2026-08-24T07:00:00.000Z',
      reviewCount: 1,
      selfReportedReason: undefined,
      inferredReason: '概念不清',
      note: '',
      redoCorrect: false,
      timeSpentSec: 60,
    }),
    reviewSchedule({
      questionId: CURRENT_REVIEWED_ID,
      stability: 'review',
      consecutiveCorrect: 1,
      nextReviewAt: '2026-08-24T07:30:00.000Z',
      reviewCount: 2,
      selfReportedReason: '读题漏条件',
      inferredReason: '审题问题',
      note: '注意同步信号量初值',
      redoCorrect: true,
      timeSpentSec: 50,
    }),
    reviewSchedule({
      questionId: FUTURE_ID,
      stability: 'learning',
      consecutiveCorrect: 0,
      nextReviewAt: '2026-08-25T07:30:00.000Z',
      reviewCount: 1,
      selfReportedReason: undefined,
      inferredReason: '概念不清',
      note: '',
      redoCorrect: false,
      timeSpentSec: 40,
    }),
    reviewSchedule({
      questionId: MASTERED_ID,
      stability: 'mastered',
      consecutiveCorrect: 3,
      nextReviewAt: '2026-08-23T07:30:00.000Z',
      reviewCount: 3,
      selfReportedReason: '已会',
      inferredReason: '掌握',
      note: '',
      redoCorrect: true,
      timeSpentSec: 30,
    }),
  ];
  const knowledgePointsForLegacy = [
    knowledgePoint({
      id: CO_POINT_ID,
      title: 'Cache 映射与替换',
      subject: '计算机组成原理',
      chapter: '存储系统',
      importance: 5,
    }),
    knowledgePoint({
      id: OS_POINT_ID,
      title: '进程同步与互斥',
      subject: '操作系统',
      chapter: '进程管理',
      importance: 4,
    }),
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
      {
        questionId: CURRENT_REVIEWED_ID,
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

function disabledRepository() {
  return { enabled: false };
}

function normalizeDueReviews(response) {
  return {
    userId: response.userId,
    dueCount: response.dueCount,
    nextAction: response.nextAction,
    items: response.items.map((item) => ({
      questionId: item.questionId,
      userId: item.userId,
      selfReportedReason: item.selfReportedReason,
      redoCorrect: item.redoCorrect,
      timeSpentSec: item.timeSpentSec,
      consecutiveCorrect: item.consecutiveCorrect,
      stability: item.stability,
      nextReviewAt: item.nextReviewAt,
      reviewCount: item.reviewCount,
      lastReviewedAt: item.lastReviewedAt,
      inferredReason: item.inferredReason,
      note: item.note,
      stem: item.stem,
      knowledgePointTitle: item.knowledgePointTitle,
      subject: item.subject,
    })),
  };
}

function practiceRecord(overrides = {}) {
  return {
    id: overrides.id,
    userId: USER_ID,
    questionId: overrides.questionId,
    knowledgePointId: overrides.knowledgePointId,
    knowledgePointIds: [overrides.knowledgePointId],
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
    inferredReason: overrides.inferredReason,
    selfReportedReason: overrides.selfReportedReason,
    note: overrides.note,
    lastWrongRecordId: 'r-latest',
    redoCorrect: overrides.redoCorrect,
    timeSpentSec: overrides.timeSpentSec,
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
    analysis: `${overrides.stem} analysis`,
    difficulty: '中等',
    type: '选择题',
    source: 'unit',
    expectedTimeSec: 60,
    knowledgePointIds: overrides.knowledgePointIds,
  };
}

function knowledgePoint(overrides) {
  return {
    frequency: 5,
    prerequisites: [],
    ...overrides,
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
  process.env.DATABASE_URL = 'postgresql://unit-test/wrong-question-legacy-read-parity';
  try {
    return await run();
  } finally {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
}
