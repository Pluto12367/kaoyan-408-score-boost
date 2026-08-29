import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

test('buildLearningCalendarDto derives active days, today, streak, and legacy DTO shape from activity facts', () => {
  const { buildLearningCalendarDto } = require('../apps/api/src/study/student-state-learning-calendar.adapter.ts');

  const result = buildLearningCalendarDto({
    days: [
      { date: '2026-08-18', completedTaskCount: 0, practiceCount: 0 },
      { date: '2026-08-19', completedTaskCount: 1, practiceCount: 0 },
      { date: '2026-08-20', completedTaskCount: 0, practiceCount: 2 },
      { date: '2026-08-21', completedTaskCount: 0, practiceCount: 0 },
      { date: '2026-08-22', completedTaskCount: 2, practiceCount: 1 },
      { date: '2026-08-23', completedTaskCount: 1, practiceCount: 3 },
      { date: '2026-08-24', completedTaskCount: 1, practiceCount: 4 },
    ],
  });

  assert.deepEqual(Object.keys(result), ['days', 'today', 'streakDays']);
  assert.deepEqual(
    result.days.map((day) => day.date),
    [
      '2026-08-18',
      '2026-08-19',
      '2026-08-20',
      '2026-08-21',
      '2026-08-22',
      '2026-08-23',
      '2026-08-24',
    ],
  );
  assert.deepEqual(result.today, {
    date: '2026-08-24',
    completedTaskCount: 1,
    practiceCount: 4,
    isActive: true,
  });
  assert.equal(result.streakDays, 3);
  assert.deepEqual(
    result.days.map((day) => day.isActive),
    [false, true, true, false, true, true, true],
  );
  assert.deepEqual(result, {
    days: [
      { date: '2026-08-18', completedTaskCount: 0, practiceCount: 0, isActive: false },
      { date: '2026-08-19', completedTaskCount: 1, practiceCount: 0, isActive: true },
      { date: '2026-08-20', completedTaskCount: 0, practiceCount: 2, isActive: true },
      { date: '2026-08-21', completedTaskCount: 0, practiceCount: 0, isActive: false },
      { date: '2026-08-22', completedTaskCount: 2, practiceCount: 1, isActive: true },
      { date: '2026-08-23', completedTaskCount: 1, practiceCount: 3, isActive: true },
      { date: '2026-08-24', completedTaskCount: 1, practiceCount: 4, isActive: true },
    ],
    today: { date: '2026-08-24', completedTaskCount: 1, practiceCount: 4, isActive: true },
    streakDays: 3,
  });
});

test('buildLearningCalendarDto treats empty activity facts as inactive legacy calendar days', () => {
  const { buildLearningCalendarDto } = require('../apps/api/src/study/student-state-learning-calendar.adapter.ts');

  const result = buildLearningCalendarDto({
    days: [
      { date: '2026-08-18', completedTaskCount: 0, practiceCount: 0 },
      { date: '2026-08-19', completedTaskCount: 0, practiceCount: 0 },
      { date: '2026-08-20', completedTaskCount: 0, practiceCount: 0 },
      { date: '2026-08-21', completedTaskCount: 0, practiceCount: 0 },
      { date: '2026-08-22', completedTaskCount: 0, practiceCount: 0 },
      { date: '2026-08-23', completedTaskCount: 0, practiceCount: 0 },
      { date: '2026-08-24', completedTaskCount: 0, practiceCount: 0 },
    ],
  });

  assert.equal(result.days.length, 7);
  assert.deepEqual(result.today, {
    date: '2026-08-24',
    completedTaskCount: 0,
    practiceCount: 0,
    isActive: false,
  });
  assert.equal(result.streakDays, 0);
  assert.deepEqual(result.days.every((day) => Object.keys(day).join(',') === 'date,completedTaskCount,practiceCount,isActive'), true);
});

test('buildLearningCalendarDto returns an explicit empty today when the snapshot has no days', () => {
  const { buildLearningCalendarDto } = require('../apps/api/src/study/student-state-learning-calendar.adapter.ts');

  const result = buildLearningCalendarDto({ days: [] });

  assert.deepEqual(result, {
    days: [],
    today: {
      date: '',
      completedTaskCount: 0,
      practiceCount: 0,
      isActive: false,
    },
    streakDays: 0,
  });
});
