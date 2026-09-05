import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

const { CanonicalEventWriterService } = require('../apps/api/src/study/canonical-event-writer.service.ts');
const { LearningLoopTriggerService } = require('../apps/api/src/study/learning-loop-trigger.service.ts');
const { UserEventRepository } = require('../apps/api/src/study/user-event.repository.ts');

class EventRepositorySpy {
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

function planEvent(generationKey) {
  return {
    userId: 'u-1',
    type: 'plan.generated',
    payload: {
      planId: `plan-${generationKey}`,
      generationKey,
      scheduledDate: '2026-09-02',
      source: 'score-center',
      triggerKey: 'learning-loop:u-1:2026-09-02',
    },
  };
}

test('same generation plan events converge to one event', async () => {
  const repository = new EventRepositorySpy();
  const writer = new CanonicalEventWriterService(repository);
  const input = planEvent('LEARNING_LOOP:u-1:2026-09-02:v1');

  const first = await writer.recordCanonicalEvent(input);
  const second = await writer.recordCanonicalEvent(input);

  assert.equal(first.id, second.id);
  assert.equal(first.eventKey, 'PLAN_GENERATED:LEARNING_LOOP:u-1:2026-09-02:v1');
  assert.equal(repository.rows.length, 1);
});

test('different generations produce different plan events', async () => {
  const repository = new EventRepositorySpy();
  const writer = new CanonicalEventWriterService(repository);

  await writer.recordCanonicalEvent(planEvent('LEARNING_LOOP:u-1:2026-09-02:v1'));
  await writer.recordCanonicalEvent(planEvent('MANUAL:u-1:2026-09-02:req-1'));

  assert.deepEqual(
    repository.rows.map((row) => row.eventKey),
    [
      'PLAN_GENERATED:LEARNING_LOOP:u-1:2026-09-02:v1',
      'PLAN_GENERATED:MANUAL:u-1:2026-09-02:req-1',
    ],
  );
});

test('generation versions remain isolated for plan events', async () => {
  const repository = new EventRepositorySpy();
  const writer = new CanonicalEventWriterService(repository);

  await writer.recordCanonicalEvent(planEvent('LEARNING_LOOP:u-1:2026-09-02:v1'));
  await writer.recordCanonicalEvent(planEvent('LEARNING_LOOP:u-1:2026-09-02:v2'));

  assert.equal(repository.rows.length, 2);
});

test('LearningLoop emits a generation-scoped event and preserves triggerKey', async () => {
  const events = [];
  const service = new LearningLoopTriggerService(
    {
      async hasTriggerKey() { return false; },
      async loadUserRecommendationConfig() { return { examYear: 2027, remainingDays: 96, dailyHours: 3 }; },
      async loadTasksForDate() { return [{ completed: true, status: 'completed' }]; },
    },
    {
      async generateDailyPlanFromState() { return { id: 'plan-1' }; },
    },
    { async hasTriggerKey() { return false; } },
    {
      async recordCanonicalEvent(input) {
        events.push(input);
        return { id: 'event-1', ...input, createdAt: new Date() };
      },
    },
  );

  const result = await service.maybeGenerateLearningLoopPlan('u-1', {
    triggerType: 'task.complete',
    sourceId: 'task-1',
    scheduledDate: '2026-09-01',
  });

  assert.equal(result.status, 'generated');
  assert.equal(events.length, 1);
  assert.equal(events[0].eventKey, 'PLAN_GENERATED:LEARNING_LOOP:u-1:2026-09-02:v1');
  assert.equal(events[0].payload.generationKey, 'LEARNING_LOOP:u-1:2026-09-02:v1');
  assert.equal(events[0].payload.triggerKey, 'learning-loop:u-1:2026-09-02');
});

test('legacy triggerKey remains readable during event identity migration', async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://phase-3-6-4-b3-test';
  try {
    const repository = new UserEventRepository({
      userEvent: {
        async findMany() {
          return [{ payload: { triggerKey: 'learning-loop:u-1:2026-09-02' } }];
        },
      },
    });

    assert.equal(await repository.hasTriggerKey('u-1', 'learning-loop:u-1:2026-09-02'), true);
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});
