import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

test('learning-calendar controller route delegates to StudentStateLearningCalendarQueryService', () => {
  const { StudyController } = require('../apps/api/src/study/study.controller.ts');
  const legacyCalls = [];
  const calendarQueryCalls = [];
  const controller = new StudyController(
    {
      getLearningCalendar(userId) {
        legacyCalls.push(userId);
        return { source: 'legacy' };
      },
      assertTeacherAuthorizedForStudent() {},
    },
    {},
    {},
    {},
    {},
    {},
    {
      getLearningCalendarCompat(userId) {
        calendarQueryCalls.push(userId);
        return {
          days: [],
          today: { date: '', completedTaskCount: 0, practiceCount: 0, isActive: false },
          streakDays: 0,
          source: 'student-state-learning-calendar',
          userId,
        };
      },
    },
  );

  const result = controller.getLearningCalendar({ id: 'u-1', role: 'student' });

  assert.deepEqual(result, {
    days: [],
    today: { date: '', completedTaskCount: 0, practiceCount: 0, isActive: false },
    streakDays: 0,
    source: 'student-state-learning-calendar',
    userId: 'u-1',
  });
  assert.deepEqual(calendarQueryCalls, ['u-1']);
  assert.deepEqual(legacyCalls, []);
});

test('StudyModule registers StudentStateLearningCalendarQueryService as a provider', () => {
  const moduleSource = readFileSync('apps/api/src/study/study.module.ts', 'utf8');

  assert.match(moduleSource, /StudentStateLearningCalendarQueryService/);
  assert.match(moduleSource, /providers:\s*\[[\s\S]*StudentStateLearningCalendarQueryService/);
});
