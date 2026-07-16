import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergePostExamTasks,
  postExamTaskId,
} from '../packages/shared/dist/postExamScheduling.js';

const HIGH = '\u9ad8';
const MEDIUM = '\u4e2d';
const LOW = '\u4f4e';
const REVIEW_MODE = '\u8003\u540e\u590d\u76d8';

function task(id, scheduledDate, priority = LOW, status = 'pending', mode = 'ordinary') {
  return { id, scheduledDate, priority, status, mode };
}

function review(sessionId, dayIndex, scheduledDate, priority = HIGH) {
  return task(postExamTaskId(sessionId, dayIndex), scheduledDate, priority, 'pending', REVIEW_MODE);
}

test('moves the lowest-priority pending task when a full date receives a review task', () => {
  const currentTasks = [
    task('high', '2026-07-16', HIGH),
    task('medium', '2026-07-16', MEDIUM),
    task('low', '2026-07-16', LOW),
  ];

  const result = mergePostExamTasks(currentTasks, [review('session-a', 0, '2026-07-16')]);

  assert.deepEqual(result.map(({ id, scheduledDate }) => ({ id, scheduledDate })), [
    { id: 'high', scheduledDate: '2026-07-16' },
    { id: 'medium', scheduledDate: '2026-07-16' },
    { id: 'low', scheduledDate: '2026-07-17' },
    { id: postExamTaskId('session-a', 0), scheduledDate: '2026-07-16' },
  ]);
});

test('keeps protected tasks and places review on the next available date', () => {
  const currentTasks = [
    task('active', '2026-07-16', HIGH, 'in_progress'),
    task('done', '2026-07-16', MEDIUM, 'completed'),
    task('older-review', '2026-07-16', HIGH, 'pending', REVIEW_MODE),
  ];

  const result = mergePostExamTasks(currentTasks, [review('session-b', 1, '2026-07-16')]);

  assert.deepEqual(result.map(({ id, scheduledDate }) => ({ id, scheduledDate })), [
    { id: 'active', scheduledDate: '2026-07-16' },
    { id: 'done', scheduledDate: '2026-07-16' },
    { id: 'older-review', scheduledDate: '2026-07-16' },
    { id: postExamTaskId('session-b', 1), scheduledDate: '2026-07-17' },
  ]);
});

test('handles consecutive full dates without exceeding capacity and is idempotent', () => {
  const currentTasks = [
    task('d1-high', '2026-07-16', HIGH), task('d1-low', '2026-07-16', LOW), task('d1-medium', '2026-07-16', MEDIUM),
    task('d2-high', '2026-07-17', HIGH), task('d2-low', '2026-07-17', LOW), task('d2-medium', '2026-07-17', MEDIUM),
    task('d3-high', '2026-07-18', HIGH), task('d3-low', '2026-07-18', LOW), task('d3-medium', '2026-07-18', MEDIUM),
  ];
  const reviewTasks = [
    review('session-c', 0, '2026-07-16'),
    review('session-c', 1, '2026-07-17'),
    review('session-c', 2, '2026-07-18'),
  ];

  const result = mergePostExamTasks(currentTasks, reviewTasks);
  const counts = new Map();
  for (const item of result) counts.set(item.scheduledDate, (counts.get(item.scheduledDate) ?? 0) + 1);

  assert.ok([...counts.values()].every((count) => count <= 3));
  assert.ok(result.some((item) => item.id === 'd3-low' && item.scheduledDate > '2026-07-18'));
  assert.deepEqual(mergePostExamTasks(result, reviewTasks), result);
});

test('does not mutate input arrays or task objects', () => {
  const currentTasks = [task('ordinary', '2026-07-16', LOW)];
  const reviewTasks = [review('session-d', 0, '2026-07-16')];
  const currentSnapshot = structuredClone(currentTasks);
  const reviewSnapshot = structuredClone(reviewTasks);

  mergePostExamTasks(currentTasks, reviewTasks);

  assert.deepEqual(currentTasks, currentSnapshot);
  assert.deepEqual(reviewTasks, reviewSnapshot);
});
