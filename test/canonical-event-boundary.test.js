import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

const { StudyController } = require('../apps/api/src/study/study.controller.ts');
const { CanonicalEventWriterService } = require('../apps/api/src/study/canonical-event-writer.service.ts');
const { UserEventRepository } = require('../apps/api/src/study/user-event.repository.ts');

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

class FakeUserEventRepository {
  constructor() {
    this.rows = [];
  }

  async recordCanonical(userId, type, eventKey, payload) {
    const existing = this.rows.find((row) => row.userId === userId && row.eventKey === eventKey);
    if (existing) return existing;
    const row = {
      id: `event-${this.rows.length + 1}`,
      userId,
      type,
      eventKey,
      payload: payload ?? {},
      createdAt: new Date('2026-09-02T00:00:00.000Z'),
    };
    this.rows.push(row);
    return row;
  }
}

function controllerWith(studyService) {
  const controller = Object.create(StudyController.prototype);
  controller.studyService = studyService;
  return controller;
}

test('client cannot record USER_ACTION_FEEDBACK through POST /events', () => {
  const calls = [];
  const controller = controllerWith({
    async recordUserEvent(...args) {
      calls.push(args);
    },
  });

  assert.throws(
    () => controller.recordUserEvent({ id: 'u-1' }, { type: 'USER_ACTION_FEEDBACK', payload: {} }),
    (error) => error?.getStatus?.() === 403,
  );
  assert.equal(calls.length, 0);
});

test('client cannot record server business facts through POST /events', () => {
  for (const type of [
    'plan.generated',
    'practice.submit',
    'task.complete',
    'session.submit',
    'wrong.review',
    'assessment.import',
    'ACTION_COMPLETED',
    'PRACTICE_ATTRIBUTED',
    'REVIEW_ATTRIBUTED',
    'recommendation.created',
    'recommendation.accepted',
    'recommendation.completed',
    'recommendation.failed',
    'learning.insight.created',
    'knowledge.gap.detected',
    'study.strategy.updated',
  ]) {
    const controller = controllerWith({
      async recordUserEvent() {
        throw new Error('the service must not receive reserved events');
      },
    });

    assert.throws(
      () => controller.recordUserEvent({ id: 'u-1' }, { type, payload: {} }),
      (error) => error?.getStatus?.() === 403,
      type,
    );
  }
});

test('client cannot record an unknown event outside the telemetry allowlist', () => {
  const controller = controllerWith({
    async recordUserEvent() {
      throw new Error('the service must not receive unknown events');
    },
  });

  assert.throws(
    () => controller.recordUserEvent({ id: 'u-1' }, { type: 'profile.updated', payload: {} }),
    (error) => error?.getStatus?.() === 400,
  );
});

test('client telemetry event remains accepted through POST /events', async () => {
  const calls = [];
  const controller = controllerWith({
    async recordUserEvent(...args) {
      calls.push(args);
      return { userId: args[0], type: args[1], recordedAt: '2026-09-02T00:00:00.000Z' };
    },
  });

  const result = await controller.recordUserEvent(
    { id: 'u-1' },
    { type: 'button.click', payload: { name: 'start' } },
  );

  assert.equal(result.type, 'button.click');
  assert.deepEqual(calls, [['u-1', 'button.click', { name: 'start' }]]);
});

test('canonical writer accepts feedback and plan events with an eventKey', async () => {
  const repository = new FakeUserEventRepository();
  const writer = new CanonicalEventWriterService(repository);

  const feedback = await writer.recordCanonicalEvent({
    userId: 'u-1',
    type: 'USER_ACTION_FEEDBACK',
    eventKey: 'USER_ACTION_FEEDBACK:u-1:a-1:POSITIVE_FEEDBACK',
    payload: { actionId: 'a-1', signalType: 'POSITIVE_FEEDBACK' },
  });
  const plan = await writer.recordCanonicalEvent({
    userId: 'u-1',
    type: 'plan.generated',
    eventKey: 'PLAN_GENERATED:u-1:2026-09-03',
    payload: { triggerKey: 'learning-loop:u-1:2026-09-03' },
  });

  assert.equal(feedback.type, 'USER_ACTION_FEEDBACK');
  assert.equal(plan.type, 'plan.generated');
  assert.equal(repository.rows.length, 2);
});

test('canonical writer converges repeated event keys to one event', async () => {
  const repository = new FakeUserEventRepository();
  const writer = new CanonicalEventWriterService(repository);
  const input = {
    userId: 'u-1',
    type: 'plan.generated',
    eventKey: 'PLAN_GENERATED:u-1:2026-09-03',
    payload: { triggerKey: 'learning-loop:u-1:2026-09-03' },
  };

  const first = await writer.recordCanonicalEvent(input);
  const second = await writer.recordCanonicalEvent(input);

  assert.equal(second.id, first.id);
  assert.equal(repository.rows.length, 1);
});

test('canonical repository reads the existing row after a database unique conflict', async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://fixture';
  const existing = {
    id: 'event-existing',
    userId: 'u-1',
    type: 'plan.generated',
    eventKey: 'PLAN_GENERATED:u-1:2026-09-03',
    payload: { planId: 'plan-1' },
    createdAt: new Date('2026-09-02T00:00:00.000Z'),
  };
  const repository = new UserEventRepository({
    userEvent: {
      async create() {
        const error = new Error('duplicate');
        error.code = 'P2002';
        throw error;
      },
      async findUnique() {
        return existing;
      },
    },
  });

  try {
    const result = await repository.recordCanonical('u-1', 'plan.generated', existing.eventKey, existing.payload);
    assert.equal(result.id, existing.id);
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});

test('LearningLoop uses the canonical writer for plan.generated', async () => {
  const sourceText = await source('apps/api/src/study/learning-loop-trigger.service.ts');
  assert.match(sourceText, /CanonicalEventWriterService/);
  assert.match(sourceText, /recordCanonicalEvent\(/);
  assert.doesNotMatch(sourceText, /userEvents\.record\(/);
});
