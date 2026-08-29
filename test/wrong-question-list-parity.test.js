import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

const { StudyService } = require('../apps/api/src/study/study.service.ts');
const { WrongQuestionProjectionService } = require('../apps/api/src/study/wrong-question-projection.service.ts');
const { WrongQuestionQueryService } = require('../apps/api/src/study/wrong-question-query.service.ts');

const USER_ID = 'u-list-parity';
const OS_SYNC_ID = 'os-sync';
const OS_MEMORY_ID = 'os-memory';
const DS_LIST_ID = 'ds-list';

test('WrongQuestionQueryService list parity matches legacy base list fields', async () => {
  const facts = createFacts();
  const legacy = createLegacyService(facts).listWrongQuestions(USER_ID);
  const actual = await withDatabaseUrl(() => createQueryService(facts).getWrongQuestionsCompat(USER_ID));

  assert.deepEqual(actual.map(pickListFields), legacy.map(pickListFields));
});

const filterCases = [
  {
    name: 'subject',
    filter: { subject: '操作系统' },
  },
  {
    name: 'knowledgePointId',
    filter: { knowledgePointId: OS_SYNC_ID },
  },
  {
    name: 'masteryStatus',
    filter: { masteryStatus: '复习中' },
  },
  {
    name: 'reviewStatus',
    filter: { reviewStatus: 'pending' },
    legacyFilter: (items) => items.filter((item) => item.reviewStatus === 'pending'),
  },
  {
    name: 'chapter',
    filter: { chapter: '内存管理' },
  },
  {
    name: 'mistakeReason',
    filter: { mistakeReason: '计算失误' },
  },
  {
    name: 'minWrongCount',
    filter: { minWrongCount: 2 },
  },
  {
    name: 'importance',
    filter: { importance: 5 },
  },
];

for (const filterCase of filterCases) {
  test(`WrongQuestionQueryService list parity keeps legacy ${filterCase.name} filter`, async () => {
    const facts = createFacts();
    const legacyService = createLegacyService(facts);
    const legacyItems = filterCase.legacyFilter
      ? filterCase.legacyFilter(legacyService.listWrongQuestions(USER_ID))
      : legacyService.listWrongQuestions(USER_ID, filterCase.filter);
    const actual = await withDatabaseUrl(() => createQueryService(facts).getWrongQuestionsCompat(USER_ID, filterCase.filter));

    assert.deepEqual(actual.map(pickListFields), legacyItems.map(pickListFields));
  });
}

test('WrongQuestionQueryService list reviewStatus depends on reviewedAt, not WrongQuestionReview.resolved', async () => {
  const facts = createFacts();
  const actual = await withDatabaseUrl(() => createQueryService(facts).getWrongQuestionsCompat(USER_ID, { reviewStatus: 'pending' }));

  const resolvedFlagLatestWrong = actual.find((item) => item.questionId === 'q-resolved-flag-latest-wrong');

  assert.equal(resolvedFlagLatestWrong?.reviewedAt, null);
  assert.equal(resolvedFlagLatestWrong?.reviewStatus, 'pending');
});

function pickListFields(item) {
  return {
    questionId: item.questionId,
    stem: item.stem,
    knowledgePointId: item.knowledgePointId,
    wrongCount: item.wrongCount,
    latestMistakeReason: item.latestMistakeReason,
    latestSubmittedAt: item.latestSubmittedAt,
    masteryStatus: item.masteryStatus,
    masteryCriteria: item.masteryCriteria,
    importance: item.importance,
    reviewStatus: item.reviewStatus,
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
    ['q-os-reviewed', '2026-08-22T12:00:00.000Z'],
  ]));
  service.reviewSchedules.clear();
  for (const schedule of facts.reviewSchedulesForLegacy) {
    service.reviewSchedules.set(`${schedule.userId}@${schedule.questionId}`, schedule);
  }
  return service;
}

function createQueryService(facts) {
  return new WrongQuestionQueryService(new WrongQuestionProjectionService(createReadOnlyPrisma(facts)));
}

function createFacts() {
  const questionsForLegacy = [
    question('q-os-pending', 'OS 同步当前未复盘错题', OS_SYNC_ID),
    question('q-os-reviewed', 'OS 内存当前已复盘错题', OS_MEMORY_ID),
    question('q-resolved-flag-latest-wrong', 'Review resolved 标记但最新仍错', DS_LIST_ID),
    question('q-latest-correct', '最新正确已解决错题', OS_SYNC_ID),
    question('q-variant', '变式练习题', OS_SYNC_ID),
  ];
  const practiceRecordsForLegacy = [
    practiceRecord('r-1', 'q-os-pending', OS_SYNC_ID, false, '概念不清', '2026-08-20T08:00:00.000Z'),
    practiceRecord('r-2', 'q-os-reviewed', OS_MEMORY_ID, false, '审题问题', '2026-08-20T09:00:00.000Z'),
    practiceRecord('r-3', 'q-resolved-flag-latest-wrong', DS_LIST_ID, false, '计算失误', '2026-08-20T10:00:00.000Z'),
    practiceRecord('r-4', 'q-latest-correct', OS_SYNC_ID, false, '知识点混淆', '2026-08-20T11:00:00.000Z'),
    practiceRecord('r-5', 'q-latest-correct', OS_SYNC_ID, true, null, '2026-08-21T08:00:00.000Z'),
    practiceRecord('r-6', 'q-os-pending', OS_SYNC_ID, false, '概念不清', '2026-08-22T08:00:00.000Z'),
    practiceRecord('r-7', 'q-variant', OS_SYNC_ID, true, null, '2026-08-22T09:00:00.000Z', 'q-os-pending'),
  ];
  const reviewSchedulesForLegacy = [
    reviewSchedule('q-os-pending', 'learning', 0),
    reviewSchedule('q-os-reviewed', 'review', 1),
    reviewSchedule('q-resolved-flag-latest-wrong', 'mastered', 3),
  ];
  const knowledgePointsForLegacy = [
    knowledgePoint(OS_SYNC_ID, '进程同步与互斥', '操作系统', '进程管理', 5),
    knowledgePoint(OS_MEMORY_ID, '页式存储管理', '操作系统', '内存管理', 4),
    knowledgePoint(DS_LIST_ID, '链表', '数据结构', '线性表', 3),
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
      { questionId: 'q-os-reviewed', reviewedAt: new Date('2026-08-22T12:00:00.000Z'), resolved: false, resolvedAt: null },
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

function practiceRecord(id, questionId, knowledgePointId, correct, mistakeReason, submittedAt, variantQuestionId = null) {
  return {
    id,
    userId: USER_ID,
    questionId,
    knowledgePointId,
    knowledgePointIds: [knowledgePointId],
    selectedAnswer: correct ? 'B' : 'A',
    correct,
    timeSpentSec: 60,
    expectedTimeSec: 60,
    mistakeReason,
    submittedAt,
    variantQuestionId,
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

function question(id, stem, knowledgePointId) {
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
    knowledgePointIds: [knowledgePointId],
  };
}

function knowledgePoint(id, title, subject, chapter, importance) {
  return {
    id,
    title,
    subject,
    chapter,
    importance,
    frequency: 5,
    prerequisites: [],
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
  process.env.DATABASE_URL = 'postgresql://unit-test/wrong-question-list-parity';
  try {
    return await run();
  } finally {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
}
