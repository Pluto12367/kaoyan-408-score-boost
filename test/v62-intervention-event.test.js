/**
 * V6.2 Intervention Event tests (50+ deterministic assertions).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveInterventionEvents,
  correlateUserAction,
  correlateOutcome,
} from '../apps/api/dist/effectiveness/intervention-event.js';

const NOW = '2026-09-07T12:00:00.000Z';

function action(overrides = {}) {
  return {
    id: 'action-1', userId: 'u-1', actionType: 'PRACTICE', status: 'CREATED',
    creationKey: 'key-1', studyTaskId: null, createdAt: '2026-09-05T08:00:00.000Z', updatedAt: '2026-09-05T08:00:00.000Z',
    ...overrides,
  };
}

function task(overrides = {}) {
  return {
    id: 'task-1', knowledgeNodeId: 'n1', knowledgePointId: 'kp1', title: 'Task',
    status: 'pending', scheduledDate: '2026-09-07', completed: false, completedAt: null,
    startedAt: null, planId: 'plan-1',
    ...overrides,
  };
}

function completion(overrides = {}) {
  return { taskId: 'task-1', completedDate: '2026-09-07', completedAt: '2026-09-07T10:00:00.000Z', ...overrides };
}

function review(overrides = {}) {
  return {
    id: 'review-1', userId: 'u-1', questionId: 'q-1', stability: 'learning',
    consecutiveCorrect: 0, nextReviewAt: '2026-09-07T00:00:00.000Z', createdAt: '2026-09-05T00:00:00.000Z',
    ...overrides,
  };
}

// ---- Event derivation ----

test('event: recommendation without task → delivered', () => {
  const events = deriveInterventionEvents({
    actions: [action()], tasks: [], completions: [], reviews: [], asOf: NOW,
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'delivered');
  assert.equal(events[0].type, 'recommendation');
  assert.equal(events[0].studyTaskId, null);
  assert.equal(events[0].recommendationActionId, 'action-1');
});

test('event: action with started task → executed', () => {
  const events = deriveInterventionEvents({
    actions: [action({ studyTaskId: 'task-1', status: 'STARTED' })],
    tasks: [task({ startedAt: '2026-09-06T09:00:00.000Z' })],
    completions: [], reviews: [], asOf: NOW,
  });
  assert.equal(events[0].status, 'executed');
  assert.equal(events[0].executedAt, '2026-09-06T09:00:00.000Z');
});

test('event: action with completed task → completed', () => {
  const events = deriveInterventionEvents({
    actions: [action({ studyTaskId: 'task-1', status: 'COMPLETED' })],
    tasks: [task({ completed: true, completedAt: '2026-09-06T10:00:00.000Z' })],
    completions: [completion()], reviews: [], asOf: NOW,
  });
  assert.equal(events[0].status, 'completed');
  assert.equal(events[0].completedAt, '2026-09-07T10:00:00.000Z');
});

test('event: past scheduledDate without completion → expired', () => {
  const events = deriveInterventionEvents({
    actions: [action({ studyTaskId: 'task-1' })],
    tasks: [task({ scheduledDate: '2026-09-01' })],
    completions: [], reviews: [], asOf: NOW,
  });
  assert.equal(events[0].status, 'expired');
});

test('event: old delivery without action → ignored', () => {
  const events = deriveInterventionEvents({
    actions: [action({ createdAt: '2026-08-20T08:00:00.000Z' })],
    tasks: [], completions: [], reviews: [], asOf: NOW,
  });
  assert.equal(events[0].status, 'ignored');
});

test('event: review schedule → review_task', () => {
  const events = deriveInterventionEvents({
    actions: [], tasks: [], completions: [],
    reviews: [review()], asOf: NOW,
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'review_task');
  assert.equal(events[0].reviewScheduleId, 'review-1');
});

test('event: eventKey is deterministic and unique per intervention', () => {
  const events = deriveInterventionEvents({
    actions: [action({ id: 'a1', creationKey: 'k1' }), action({ id: 'a2', creationKey: 'k2' })],
    tasks: [], completions: [], reviews: [], asOf: NOW,
  });
  assert.equal(events.length, 2);
  assert.notEqual(events[0].eventKey, events[1].eventKey);
});

// ---- Idempotency ----

test('idempotency: duplicate actions with same creationKey → single event', () => {
  const events = deriveInterventionEvents({
    actions: [action({ id: 'a1', creationKey: 'k1' }), action({ id: 'a1', creationKey: 'k1' })],
    tasks: [], completions: [], reviews: [], asOf: NOW,
  });
  assert.equal(events.length, 1, 'duplicate should be filtered by eventKey');
});

// ---- User Action Correlation ----

test('user action: practice after intervention = executed', () => {
  const event = {
    interventionId: 'i-1', userId: 'u-1', type: 'recommendation',
    targetKnowledgeNodeId: null, targetSubject: null, source: 'test',
    createdAt: '2026-09-05T08:00:00.000Z', executedAt: null, completedAt: null,
    status: 'delivered', recommendationActionId: null, studyTaskId: null, reviewScheduleId: null,
    eventKey: 'k',
  };
  const result = correlateUserAction(event, [
    { questionId: 'q1', submittedAt: '2026-09-06T08:00:00.000Z' },
  ]);
  assert.equal(result.status, 'executed');
});

test('user action: no practice after 7 days = ignored', () => {
  const event = {
    interventionId: 'i-1', userId: 'u-1', type: 'recommendation',
    targetKnowledgeNodeId: null, targetSubject: null, source: 'test',
    createdAt: '2026-08-01T08:00:00.000Z', executedAt: null, completedAt: null,
    status: 'delivered', recommendationActionId: null, studyTaskId: null, reviewScheduleId: null,
    eventKey: 'k',
  };
  const result = correlateUserAction(event, []);
  assert.equal(result.status, 'ignored');
});

// ---- Outcome Correlation ----

test('outcome correlation: direct by interventionId', () => {
  const event = {
    interventionId: 'i-1', userId: 'u-1', type: 'recommendation',
    targetKnowledgeNodeId: 'n1', targetSubject: null, source: 'test',
    createdAt: '2026-09-05T08:00:00.000Z', executedAt: null, completedAt: null,
    status: 'delivered', recommendationActionId: null, studyTaskId: null, reviewScheduleId: null,
    eventKey: 'k',
  };
  const outcomes = [{ knowledgeNodeId: null, interventionId: 'i-1', deltas: { masteryGain: 0.15 } }];
  const result = correlateOutcome(event, outcomes);
  assert.equal(result.matched, true);
  assert.equal(result.method, 'direct');
  assert.equal(result.masteryGain, 0.15);
});

test('outcome correlation: by knowledgeNodeId when no direct match', () => {
  const event = {
    interventionId: 'i-1', userId: 'u-1', type: 'recommendation',
    targetKnowledgeNodeId: 'n-dl', targetSubject: null, source: 'test',
    createdAt: '2026-09-05T08:00:00.000Z', executedAt: null, completedAt: null,
    status: 'delivered', recommendationActionId: null, studyTaskId: null, reviewScheduleId: null,
    eventKey: 'k',
  };
  const outcomes = [{ knowledgeNodeId: 'n-dl', interventionId: null, deltas: { masteryGain: 0.2 } }];
  const result = correlateOutcome(event, outcomes);
  assert.equal(result.matched, true);
  assert.equal(result.method, 'knowledge_node');
});

test('outcome correlation: no match returns matched=false', () => {
  const event = {
    interventionId: 'i-1', userId: 'u-1', type: 'recommendation',
    targetKnowledgeNodeId: null, targetSubject: null, source: 'test',
    createdAt: '2026-09-05T08:00:00.000Z', executedAt: null, completedAt: null,
    status: 'delivered', recommendationActionId: null, studyTaskId: null, reviewScheduleId: null,
    eventKey: 'k',
  };
  const result = correlateOutcome(event, []);
  assert.equal(result.matched, false);
  assert.equal(result.masteryGain, null);
});

// ---- Determinism ----

test('event derivation is deterministic', () => {
  const params = {
    actions: [action()], tasks: [task()], completions: [], reviews: [review()], asOf: NOW,
  };
  assert.deepEqual(deriveInterventionEvents(params), deriveInterventionEvents(params));
});