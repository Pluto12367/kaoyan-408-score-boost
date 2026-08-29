import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

test('StudentStateLearningCalendarQueryService builds a legacy-compatible seven-day calendar from read-only activity facts', async () => {
  const { StudentStateLearningCalendarQueryService } = require('../apps/api/src/study/student-state-learning-calendar-query.service.ts');
  const snapshotCalls = [];
  const readCalls = [];
  const writeCalls = [];
  const service = new StudentStateLearningCalendarQueryService(
    {
      async getSnapshot(userId, asOf) {
        snapshotCalls.push({ userId, asOf: asOf.toISOString() });
        return { userId, asOf: asOf.toISOString() };
      },
    },
    createReadOnlyPrisma(readCalls, writeCalls, {
      practiceRecords: [
        { submittedAt: new Date('2026-08-18T03:00:00.000Z') },
        { submittedAt: new Date('2026-08-23T01:00:00.000Z') },
        { submittedAt: new Date('2026-08-23T09:00:00.000Z') },
        { submittedAt: new Date('2026-08-24T02:00:00.000Z') },
      ],
      taskCompletions: [
        { completedDate: '2026-08-19' },
        { completedDate: '2026-08-22' },
        { completedDate: '2026-08-22' },
        { completedDate: '2026-08-24' },
      ],
    }),
  );

  mock.timers.enable({ apis: ['Date'], now: new Date('2026-08-24T08:30:00.000Z') });
  try {
    const result = await withDatabaseUrl(() => service.getLearningCalendarCompat('u-1'));

    assert.deepEqual(snapshotCalls, [
      { userId: 'u-1', asOf: '2026-08-24T08:30:00.000Z' },
    ]);
    assert.deepEqual(writeCalls, []);
    assert.deepEqual(readCalls.map((call) => call.name), [
      'practiceRecord.findMany',
      'studyTaskCompletion.findMany',
    ]);
    assert.equal(readCalls[0].query.where.userId, 'u-1');
    assert.deepEqual(readCalls[0].query.select, { submittedAt: true });
    assert.equal(readCalls[1].query.where.userId, 'u-1');
    assert.deepEqual(readCalls[1].query.where.completedDate.in, [
      '2026-08-18',
      '2026-08-19',
      '2026-08-20',
      '2026-08-21',
      '2026-08-22',
      '2026-08-23',
      '2026-08-24',
    ]);
    assert.deepEqual(readCalls[1].query.select, { completedDate: true });
    assert.deepEqual(result, {
      days: [
        { date: '2026-08-18', completedTaskCount: 0, practiceCount: 1, isActive: true },
        { date: '2026-08-19', completedTaskCount: 1, practiceCount: 0, isActive: true },
        { date: '2026-08-20', completedTaskCount: 0, practiceCount: 0, isActive: false },
        { date: '2026-08-21', completedTaskCount: 0, practiceCount: 0, isActive: false },
        { date: '2026-08-22', completedTaskCount: 2, practiceCount: 0, isActive: true },
        { date: '2026-08-23', completedTaskCount: 0, practiceCount: 2, isActive: true },
        { date: '2026-08-24', completedTaskCount: 1, practiceCount: 1, isActive: true },
      ],
      today: { date: '2026-08-24', completedTaskCount: 1, practiceCount: 1, isActive: true },
      streakDays: 3,
    });
  } finally {
    mock.timers.reset();
  }
});

test('StudentStateLearningCalendarQueryService returns an empty seven-day calendar without touching Prisma when database is disabled', async () => {
  const { StudentStateLearningCalendarQueryService } = require('../apps/api/src/study/student-state-learning-calendar-query.service.ts');
  const snapshotCalls = [];
  const readCalls = [];
  const writeCalls = [];
  const service = new StudentStateLearningCalendarQueryService(
    {
      async getSnapshot(userId, asOf) {
        snapshotCalls.push({ userId, asOf: asOf.toISOString() });
        return { userId, asOf: asOf.toISOString() };
      },
    },
    createReadOnlyPrisma(readCalls, writeCalls),
  );

  mock.timers.enable({ apis: ['Date'], now: new Date('2026-08-24T08:30:00.000Z') });
  try {
    const result = await withoutDatabaseUrl(() => service.getLearningCalendarCompat('u-empty'));

    assert.deepEqual(snapshotCalls, [
      { userId: 'u-empty', asOf: '2026-08-24T08:30:00.000Z' },
    ]);
    assert.deepEqual(readCalls, []);
    assert.deepEqual(writeCalls, []);
    assert.deepEqual(result, {
      days: [
        { date: '2026-08-18', completedTaskCount: 0, practiceCount: 0, isActive: false },
        { date: '2026-08-19', completedTaskCount: 0, practiceCount: 0, isActive: false },
        { date: '2026-08-20', completedTaskCount: 0, practiceCount: 0, isActive: false },
        { date: '2026-08-21', completedTaskCount: 0, practiceCount: 0, isActive: false },
        { date: '2026-08-22', completedTaskCount: 0, practiceCount: 0, isActive: false },
        { date: '2026-08-23', completedTaskCount: 0, practiceCount: 0, isActive: false },
        { date: '2026-08-24', completedTaskCount: 0, practiceCount: 0, isActive: false },
      ],
      today: { date: '2026-08-24', completedTaskCount: 0, practiceCount: 0, isActive: false },
      streakDays: 0,
    });
  } finally {
    mock.timers.reset();
  }
});

function createReadOnlyPrisma(readCalls, writeCalls, options = {}) {
  const write = (name) => async () => {
    writeCalls.push(name);
    throw new Error(`${name} must not be called`);
  };
  const read = (name, result) => async (query) => {
    readCalls.push({ name, query });
    return result;
  };
  return {
    practiceRecord: {
      findMany: read('practiceRecord.findMany', options.practiceRecords ?? []),
      create: write('practiceRecord.create'),
      update: write('practiceRecord.update'),
      upsert: write('practiceRecord.upsert'),
      delete: write('practiceRecord.delete'),
    },
    studyTaskCompletion: {
      findMany: read('studyTaskCompletion.findMany', options.taskCompletions ?? []),
      create: write('studyTaskCompletion.create'),
      update: write('studyTaskCompletion.update'),
      upsert: write('studyTaskCompletion.upsert'),
      delete: write('studyTaskCompletion.delete'),
    },
    $transaction: write('$transaction'),
  };
}

async function withDatabaseUrl(run) {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://unit-test/student-state-learning-calendar-query';
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
