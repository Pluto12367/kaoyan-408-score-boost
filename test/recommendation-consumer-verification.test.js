import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
require('ts-node').register({ project: fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url)) });

const { loadTodayScoreCenterPlan } = require('../apps/api/src/score-center/repository.ts');
const { toRecommendationTaskCompat } = require('../apps/api/src/study/recommendation-task.adapter.ts');

test('today plan query loads the reverse Action relation for the legacy adapter', async () => {
  let query;
  const db = {
    studyPlan: {
      findFirst: async (args) => {
        query = args;
        return null;
      },
    },
  };

  await loadTodayScoreCenterPlan(db, 'u-1', '2026-09-02');

  assert.deepEqual(query.include.tasks.include.action, { select: { id: true } });
});

test('legacy task DTO exposes only the reverse relation Action identity', () => {
  const task = toRecommendationTaskCompat({ id: 'task-1', action: { id: 'action-1' } });
  assert.equal(task.actionId, 'action-1');
  assert.notEqual(task.actionId, task.id);
  assert.equal(toRecommendationTaskCompat({ id: 'task-2', action: null }).actionId, null);
});

test('direct task DTO remains actionless without manufacturing an Action', () => {
  const task = toRecommendationTaskCompat({ id: 'task-direct', action: null });
  assert.equal(task.actionId, null);
});

test('Action, Task, Session and outcome identities remain distinct', () => {
  const chain = {
    actionId: 'action-1',
    studyTaskId: 'task-1',
    sessionId: 'session-1',
    practiceRecordId: 'practice-1',
    reviewAttemptId: 'review-1',
  };
  const ids = Object.values(chain);
  assert.equal(new Set(ids).size, ids.length);
});

test('compatibility adapter does not model a database StudyTask.actionId column', () => {
  const task = toRecommendationTaskCompat({ id: 'task-1', action: { id: 'action-1' } });
  assert.equal(task.actionId, 'action-1');
  assert.equal(Object.prototype.hasOwnProperty.call(task, 'action'), false);
});
