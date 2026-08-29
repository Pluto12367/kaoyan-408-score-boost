import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

test('ActivityProjectionService builds ordered activity days from practice and task facts', () => {
  const { ActivityProjectionService } = require('../apps/api/src/study/activity-projection.service.ts');
  const service = new ActivityProjectionService();

  const result = service.buildSnapshot({
    dates: [
      '2026-08-18',
      '2026-08-19',
      '2026-08-20',
      '2026-08-21',
      '2026-08-22',
      '2026-08-23',
      '2026-08-24',
    ],
    practiceRecords: [
      { submittedAt: new Date('2026-08-18T02:00:00.000Z') },
      { submittedAt: new Date('2026-08-23T04:00:00.000Z') },
      { submittedAt: new Date('2026-08-23T06:00:00.000Z') },
      { submittedAt: new Date('2026-08-24T01:00:00.000Z') },
    ],
    taskCompletions: [
      { completedDate: '2026-08-19' },
      { completedDate: '2026-08-22' },
      { completedDate: '2026-08-22' },
      { completedDate: '2026-08-24' },
    ],
  });

  assert.deepEqual(result.days, [
    { date: '2026-08-18', completedTaskCount: 0, practiceCount: 1, isActive: true },
    { date: '2026-08-19', completedTaskCount: 1, practiceCount: 0, isActive: true },
    { date: '2026-08-20', completedTaskCount: 0, practiceCount: 0, isActive: false },
    { date: '2026-08-21', completedTaskCount: 0, practiceCount: 0, isActive: false },
    { date: '2026-08-22', completedTaskCount: 2, practiceCount: 0, isActive: true },
    { date: '2026-08-23', completedTaskCount: 0, practiceCount: 2, isActive: true },
    { date: '2026-08-24', completedTaskCount: 1, practiceCount: 1, isActive: true },
  ]);
  assert.deepEqual(result.today, {
    date: '2026-08-24',
    completedTaskCount: 1,
    practiceCount: 1,
    isActive: true,
  });
  assert.equal(result.todayPracticeCount, 1);
  assert.equal(result.streakDays, 3);
});

test('ActivityProjectionService returns explicit empty values when no dates are provided', () => {
  const { ActivityProjectionService } = require('../apps/api/src/study/activity-projection.service.ts');
  const service = new ActivityProjectionService();

  const result = service.buildSnapshot({
    dates: [],
    practiceRecords: [],
    taskCompletions: [],
  });

  assert.deepEqual(result, {
    days: [],
    today: {
      date: '',
      completedTaskCount: 0,
      practiceCount: 0,
      isActive: false,
    },
    streakDays: 0,
    todayPracticeCount: 0,
  });
});

test('ActivityProjectionService keeps Asia/Shanghai date boundaries through studyDateKey', () => {
  const { ActivityProjectionService } = require('../apps/api/src/study/activity-projection.service.ts');
  const originalTimeZone = process.env.APP_TIME_ZONE;
  process.env.APP_TIME_ZONE = 'Asia/Shanghai';
  const service = new ActivityProjectionService();

  try {
    const result = service.buildSnapshot({
      dates: ['2026-08-23', '2026-08-24'],
      practiceRecords: [
        { submittedAt: new Date('2026-08-23T15:59:59.000Z') },
        { submittedAt: new Date('2026-08-23T16:00:00.000Z') },
        { submittedAt: new Date('2026-08-24T01:30:00.000Z') },
      ],
      taskCompletions: [
        { completedDate: '2026-08-24' },
      ],
    });

    assert.deepEqual(result.days, [
      { date: '2026-08-23', completedTaskCount: 0, practiceCount: 1, isActive: true },
      { date: '2026-08-24', completedTaskCount: 1, practiceCount: 2, isActive: true },
    ]);
    assert.equal(result.todayPracticeCount, 2);
    assert.equal(result.streakDays, 2);
  } finally {
    if (originalTimeZone === undefined) delete process.env.APP_TIME_ZONE;
    else process.env.APP_TIME_ZONE = originalTimeZone;
  }
});
