import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
require('ts-node').register({ project: fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url)) });

const { StudentStateFeedbackAdapter, feedbackDedupeKey } = require('../apps/api/src/study/student-state-feedback.adapter.ts');
const { ActionLearningSignalConsumerService } = require('../apps/api/src/study/action-learning-signal-consumer.service.ts');

const action = (overrides = {}) => ({
  id: 'action-1',
  userId: 'user-1',
  actionType: 'PRACTICE',
  targetType: 'KNOWLEDGE_NODE',
  targetId: 'node-1',
  status: 'COMPLETED',
  createdAt: new Date('2026-09-02T08:00:00.000Z'),
  updatedAt: new Date('2026-09-02T08:05:00.000Z'),
  completedAt: new Date('2026-09-02T08:05:00.000Z'),
  ...overrides,
});

const signal = (outcomeStatus, overrides = {}) => ({
  actionId: 'action-1',
  outcomeStatus,
  signalType: 'PRACTICE_COMPLETED',
  confidence: outcomeStatus === 'SUCCESS' ? 1 : outcomeStatus === 'PARTIAL' ? 0.5 : outcomeStatus === 'FAILED' ? 0.2 : 0,
  evidenceRefs: ['practice-record:p-1'],
  generatedAt: new Date('2026-09-02T08:06:00.000Z'),
  ...overrides,
});

class FeedbackRepository {
  constructor() {
    this.rows = [];
    this.createCalls = 0;
  }

  async createIfAbsent(event) {
    const existing = this.rows.find((row) => row.payload.userId === event.userId
      && row.payload.actionId === event.actionId
      && row.payload.signalType === event.signalType);
    if (existing) return { created: false, record: existing };
    this.createCalls += 1;
    const record = { id: `event-${this.rows.length + 1}`, type: 'USER_ACTION_FEEDBACK', payload: event, createdAt: new Date(event.occurredAt) };
    this.rows.push(record);
    return { created: true, record };
  }
}

function createConsumer(repository = new FeedbackRepository()) {
  const adapter = new StudentStateFeedbackAdapter();
  return { consumer: new ActionLearningSignalConsumerService(adapter, repository), repository };
}

test('maps SUCCESS, PARTIAL, FAILED and NO_OUTCOME to feedback event types', () => {
  const adapter = new StudentStateFeedbackAdapter();
  const expected = [
    ['SUCCESS', 'POSITIVE_FEEDBACK'],
    ['PARTIAL', 'PARTIAL_FEEDBACK'],
    ['FAILED', 'NEGATIVE_FEEDBACK'],
    ['NO_OUTCOME', 'NO_FEEDBACK'],
  ];
  for (const [outcomeStatus, signalType] of expected) {
    const event = adapter.toEvent({ userId: 'user-1', action: action(), signal: signal(outcomeStatus) });
    assert.equal(event.signalType, signalType);
  }
});

test('feedback event preserves action and target identity spaces', () => {
  const adapter = new StudentStateFeedbackAdapter();
  const event = adapter.toEvent({ userId: 'user-1', action: action(), signal: signal('SUCCESS') });
  assert.equal(event.actionId, 'action-1');
  assert.equal(event.targetId, 'node-1');
  assert.notEqual(event.actionId, event.targetId);
  assert.deepEqual(event.evidenceRefs, ['practice-record:p-1']);
  assert.equal(event.occurredAt, '2026-09-02T08:05:00.000Z');
});

test('consumer creates one UserEvent for repeated signal consumption', async () => {
  const { consumer, repository } = createConsumer();
  const input = { userId: 'user-1', action: action(), signal: signal('SUCCESS') };
  const first = await consumer.consume(input);
  const second = await consumer.consume(input);
  assert.equal(first.status, 'created');
  assert.equal(second.status, 'existing');
  assert.equal(repository.rows.length, 1);
  assert.equal(repository.createCalls, 1);
  assert.equal(first.record.type, 'USER_ACTION_FEEDBACK');
  assert.equal(first.record.payload.signalType, 'POSITIVE_FEEDBACK');
  assert.equal(first.record.payload.userId, 'user-1');
  assert.equal(first.dedupeKey, feedbackDedupeKey(first.event));
});

test('consumer isolates a foreign action from the requesting user', async () => {
  const { consumer } = createConsumer();
  await assert.rejects(
    () => consumer.consume({ userId: 'user-2', action: action(), signal: signal('SUCCESS') }),
    (error) => error.code === 'ACTION_FORBIDDEN',
  );
});

test('consumer rejects action and target identity collision', async () => {
  const { consumer } = createConsumer();
  await assert.rejects(
    () => consumer.consume({ userId: 'user-1', action: action({ targetId: 'action-1' }), signal: signal('SUCCESS') }),
    (error) => error.code === 'ACTION_FEEDBACK_IDENTITY_CONFLICT',
  );
});

test('feedback consumer does not contain a mastery mutation path', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../apps/api/src/study/action-learning-signal-consumer.service.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /userKnowledgeMastery|applyAttempts|applyReview|\.update\(/);
});

test('consumer can build and consume a signal from the existing action signal service', async () => {
  const repository = new FeedbackRepository();
  const actionRow = action();
  const { consumer } = createConsumer(repository);
  const service = new ActionLearningSignalConsumerService(
    new StudentStateFeedbackAdapter(),
    repository,
    { buildSignal: async () => signal('SUCCESS') },
    { getAction: async (userId, actionId) => {
      assert.equal(userId, 'user-1');
      assert.equal(actionId, 'action-1');
      return actionRow;
    } },
  );
  const result = await service.consumeAction('user-1', 'action-1');
  assert.equal(result.status, 'created');
  assert.equal(result.event?.actionId, 'action-1');
  assert.equal(consumer instanceof ActionLearningSignalConsumerService, true);
});

test('study module wires the feedback adapter, repository and consumer', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../apps/api/src/study/study.module.ts', import.meta.url), 'utf8');
  assert.match(source, /StudentStateFeedbackAdapter/);
  assert.match(source, /StudentStateFeedbackRepository/);
  assert.match(source, /ActionLearningSignalConsumerService/);
});

test('repository-level feedback dedupe converges concurrent calls in one process', async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://phase-3-4-test';
  try {
    const rows = [];
    const prisma = {
      userEvent: {
        async findMany() { return rows; },
        async create({ data }) {
          const row = { id: `event-${rows.length + 1}`, createdAt: new Date('2026-09-02T08:06:00.000Z'), ...data };
          rows.push(row);
          return row;
        },
      },
    };
    const { StudentStateFeedbackRepository } = require('../apps/api/src/study/student-state-feedback.repository.ts');
    const repository = new StudentStateFeedbackRepository(prisma);
    const adapter = new StudentStateFeedbackAdapter();
    const event = adapter.toEvent({ userId: 'user-1', action: action(), signal: signal('SUCCESS') });
    const results = await Promise.all(Array.from({ length: 5 }, () => repository.createIfAbsent(event)));
    assert.equal(rows.length, 1);
    assert.equal(results.filter((result) => result.created).length, 1);
    assert.equal(new Set(results.map((result) => result.record.id)).size, 1);
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});
