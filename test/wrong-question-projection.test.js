import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

test('WrongQuestionProjectionService reads facts and returns a partitioned WrongQuestionSnapshot', async () => {
  const { WrongQuestionProjectionService } = require('../apps/api/src/study/wrong-question-projection.service.ts');
  const readCalls = [];
  const writeCalls = [];
  const service = new WrongQuestionProjectionService(createReadOnlyPrisma(readCalls, writeCalls, {
    practiceRecords: [
      practiceRecord({ id: 'r-1', questionId: 'q-current', correct: false, submittedAt: new Date('2026-08-21T08:00:00.000Z'), mistakeReason: '概念不清' }),
      practiceRecord({ id: 'r-2', questionId: 'q-resolved', correct: false, knowledgePointId: 'kp-ds', submittedAt: new Date('2026-08-21T09:00:00.000Z'), mistakeReason: null }),
      practiceRecord({ id: 'r-3', questionId: 'q-resolved', correct: true, knowledgePointId: 'kp-ds', submittedAt: new Date('2026-08-22T09:00:00.000Z'), mistakeReason: null }),
      practiceRecord({ id: 'r-4', questionId: 'q-current', correct: false, submittedAt: new Date('2026-08-23T08:00:00.000Z'), mistakeReason: '概念不清' }),
      practiceRecord({ id: 'r-5', questionId: 'q-variant', correct: true, submittedAt: new Date('2026-08-23T09:00:00.000Z'), variantQuestionId: 'q-current' }),
    ],
    wrongQuestionReviews: [
      { questionId: 'q-current', reviewedAt: new Date('2026-08-22T10:00:00.000Z'), resolved: true, resolvedAt: new Date('2026-08-22T11:00:00.000Z') },
    ],
    reviewSchedules: [
      reviewSchedule({ id: 's-current', questionId: 'q-current', nextReviewAt: new Date('2026-08-24T07:30:00.000Z') }),
      reviewSchedule({ id: 's-future', questionId: 'q-future', nextReviewAt: new Date('2026-08-25T07:30:00.000Z') }),
      reviewSchedule({ id: 's-mastered', questionId: 'q-mastered', stability: 'mastered', consecutiveCorrect: 3, nextReviewAt: new Date('2026-08-23T07:30:00.000Z') }),
    ],
    reviewAttempts: [
      {
        schedule: { questionId: 'q-current' },
        redoCorrect: false,
        timeSpentSec: 70,
        reportedReason: '定义没记牢',
        inferredReason: '概念不清',
        nextIntervalDays: 1,
        reviewedAt: new Date('2026-08-22T10:00:00.000Z'),
      },
    ],
    questions: [
      { id: 'q-current', stem: '页表项包含哪些字段？', answer: 'A', analysis: '页号到块号映射。', knowledgePoints: [{ knowledgePointId: 'kp-os' }] },
      { id: 'q-resolved', stem: '链表删除结点需要维护什么？', answer: 'B', analysis: '维护前驱指针。', knowledgePoints: [{ knowledgePointId: 'kp-ds' }] },
    ],
    knowledgePoints: [
      { id: 'kp-os', title: '页式存储管理', subject: '操作系统', chapter: '内存管理', importance: 5 },
      { id: 'kp-ds', title: '链表', subject: '数据结构', chapter: '线性表', importance: 4 },
    ],
  }));

  const snapshot = await withDatabaseUrl(() => service.getSnapshot('u-1', new Date('2026-08-24T08:00:00.000Z')));

  assert.deepEqual(writeCalls, []);
  assert.deepEqual(readCalls.map((call) => call.name), [
    'practiceRecord.findMany',
    'wrongQuestionReview.findMany',
    'reviewSchedule.findMany',
    'reviewAttempt.findMany',
    'question.findMany',
    'knowledgePoint.findMany',
  ]);
  assert.equal(readCalls[0].query.where.userId, 'u-1');
  assert.deepEqual(readCalls[0].query.orderBy, [
    { submittedAt: 'asc' },
    { id: 'asc' },
  ]);
  assert.equal(readCalls[3].query.where.schedule.userId, 'u-1');

  assert.equal(snapshot.userId, 'u-1');
  assert.equal(snapshot.asOf, '2026-08-24T08:00:00.000Z');
  assert.deepEqual(snapshot.currentWrongItems.map((item) => item.questionId), ['q-current']);
  assert.deepEqual(snapshot.resolvedItems.map((item) => item.questionId), ['q-resolved']);
  assert.deepEqual(snapshot.dueItems.map((item) => item.questionId), ['q-current']);
  assert.deepEqual(snapshot.mistakeReasonStats, [
    { reason: '概念不清', count: 2 },
    { reason: '待归因', count: 1 },
  ]);
  assert.deepEqual(snapshot.currentWrongItems[0].masteryCriteria, {
    stability: 'learning',
    consecutiveCorrect: 0,
    variantCorrectCount: 1,
  });
});

test('WrongQuestionProjectionService returns an empty snapshot without touching Prisma when database is disabled', async () => {
  const { WrongQuestionProjectionService } = require('../apps/api/src/study/wrong-question-projection.service.ts');
  const readCalls = [];
  const writeCalls = [];
  const service = new WrongQuestionProjectionService(createReadOnlyPrisma(readCalls, writeCalls));

  const snapshot = await withoutDatabaseUrl(() => service.getSnapshot('u-empty', '2026-08-24T08:00:00.000Z'));

  assert.deepEqual(readCalls, []);
  assert.deepEqual(writeCalls, []);
  assert.deepEqual(snapshot, {
    source: 'practice_record_wrong_question_review_review_schedule',
    userId: 'u-empty',
    asOf: '2026-08-24T08:00:00.000Z',
    currentWrongItems: [],
    resolvedItems: [],
    dueItems: [],
    mistakeReasonStats: [],
  });
});

function practiceRecord(overrides) {
  return {
    id: 'r-default',
    questionId: 'q-current',
    knowledgePointId: 'kp-os',
    selectedAnswer: 'A',
    correct: false,
    timeSpentSec: 90,
    mistakeReason: '概念不清',
    submittedAt: new Date('2026-08-21T08:00:00.000Z'),
    variantQuestionId: null,
    ...overrides,
  };
}

function reviewSchedule(overrides) {
  return {
    id: 's-default',
    questionId: 'q-current',
    stability: 'learning',
    consecutiveCorrect: 0,
    nextReviewAt: new Date('2026-08-24T07:30:00.000Z'),
    reviewCount: 1,
    lastReviewedAt: null,
    selfReportedReason: '定义没记牢',
    inferredReason: '概念不清',
    note: '复习页表',
    redoCorrect: false,
    timeSpentSec: 70,
    ...overrides,
  };
}

function createReadOnlyPrisma(readCalls, writeCalls, options = {}) {
  const write = (name) => async () => {
    writeCalls.push(name);
    throw new Error(`${name} must not be called`);
  };
  const read = (name, result) => async (query) => {
    readCalls.push({ name, query });
    return result;
  };
  const model = (name, result) => ({
    findMany: read(`${name}.findMany`, result),
    findUnique: read(`${name}.findUnique`, null),
    count: read(`${name}.count`, 0),
    create: write(`${name}.create`),
    update: write(`${name}.update`),
    upsert: write(`${name}.upsert`),
    delete: write(`${name}.delete`),
    deleteMany: write(`${name}.deleteMany`),
  });
  return {
    practiceRecord: model('practiceRecord', options.practiceRecords ?? []),
    wrongQuestionReview: model('wrongQuestionReview', options.wrongQuestionReviews ?? []),
    reviewSchedule: model('reviewSchedule', options.reviewSchedules ?? []),
    reviewAttempt: model('reviewAttempt', options.reviewAttempts ?? []),
    question: model('question', options.questions ?? []),
    knowledgePoint: model('knowledgePoint', options.knowledgePoints ?? []),
    $transaction: write('$transaction'),
  };
}

async function withDatabaseUrl(run) {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://unit-test/wrong-question-projection';
  try {
    return await run();
  } finally {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
}

async function withoutDatabaseUrl(run) {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    return await run();
  } finally {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
}
