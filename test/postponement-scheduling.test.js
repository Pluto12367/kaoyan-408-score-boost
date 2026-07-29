import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');
const { StudyService } = require('../apps/api/src/study/study.service.ts');

test('postpones to the nearest empty study date before a later represented date in memory', async () => {
  const unavailableDependency = {};
  const service = new StudyService(
    unavailableDependency,
    unavailableDependency,
    unavailableDependency,
    unavailableDependency,
    unavailableDependency,
    unavailableDependency,
    unavailableDependency,
    unavailableDependency,
    { enabled: false },
    unavailableDependency,
    unavailableDependency,
    unavailableDependency,
    unavailableDependency,
    unavailableDependency,
  );
  const task = scheduledTask('candidate', '2026-07-20');
  const laterTask = scheduledTask('later', '2026-07-22');
  service.sevenDayPlansByUser.set('student', {
    id: 'plan',
    userId: 'student',
    phase: 'strengthening',
    targetScore: 120,
    remainingDays: 90,
    dailyHours: 3,
    checkpoint: 'weekly',
    startDate: '2026-07-20',
    tasks: [task, laterTask],
  });

  const result = await service.postponeTask('student', task.id);

  assert.equal(result.rescheduledDate, '2026-07-21');
  assert.equal(task.scheduledDate, '2026-07-21');
  assert.equal(task.status, 'postponed');
  assert.equal(task.postponeCount, 1);
  assert.equal(task.startedAt, '2026-07-20T01:00:00.000Z');
});

function scheduledTask(id, scheduledDate) {
  return {
    id,
    knowledgePointId: 'co-cache',
    subject: '\u8ba1\u7b97\u673a\u7ec4\u6210\u539f\u7406',
    chapter: 'cache',
    title: id,
    mode: 'focused-practice',
    minutes: 30,
    questionCount: 10,
    scheduledDate,
    priority: '\u4e2d',
    reason: 'fixture',
    nextAction: 'continue',
    status: 'in_progress',
    postponeCount: 0,
    startedAt: '2026-07-20T01:00:00.000Z',
  };
}
