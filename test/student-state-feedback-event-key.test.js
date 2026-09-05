import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
require('ts-node').register({ project: fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url)) });

const { StudentStateFeedbackRepository } = require('../apps/api/src/study/student-state-feedback.repository.ts');
const { feedbackDedupeKey } = require('../apps/api/src/study/student-state-feedback.adapter.ts');

const event = (signalType = 'POSITIVE_FEEDBACK') => ({
  id: `student-state-feedback:action-1:${signalType}`,
  userId: 'user-1',
  actionId: 'action-1',
  actionType: 'PRACTICE',
  targetType: 'KNOWLEDGE_NODE',
  targetId: 'node-1',
  signalType,
  confidence: signalType === 'POSITIVE_FEEDBACK' ? 1 : 0.2,
  evidenceRefs: ['practice-record:record-1'],
  occurredAt: '2026-09-02T08:05:00.000Z',
});

function createDatabase() {
  const rows = [];
  const calls = { create: [], findUnique: [] };
  return {
    rows,
    calls,
    userEvent: {
      async create({ data }) {
        await Promise.resolve();
        if (rows.some((row) => row.userId === data.userId && row.eventKey === data.eventKey)) {
          const error = new Error('unique constraint');
          error.code = 'P2002';
          throw error;
        }
        calls.create.push(data);
        const row = {
          id: `event-${rows.length + 1}`,
          createdAt: new Date('2026-09-02T08:06:00.000Z'),
          ...data,
        };
        rows.push(row);
        return row;
      },
      async findUnique({ where }) {
        calls.findUnique.push(where);
        return rows.find((row) => row.userId === where.userId_eventKey.userId
          && row.eventKey === where.userId_eventKey.eventKey) ?? null;
      },
    },
  };
}

const withDatabase = async (database, callback) => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://event-key-test';
  try {
    return await callback(database);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
};

test('feedback writer persists the deterministic eventKey with the canonical event', async () => {
  await withDatabase(createDatabase(), async (database) => {
    const repository = new StudentStateFeedbackRepository(database);
    const input = event();
    const result = await repository.createIfAbsent(input);

    assert.equal(result.created, true);
    assert.equal(database.calls.create.length, 1);
    assert.equal(database.calls.create[0].eventKey, feedbackDedupeKey(input));
    assert.equal(database.calls.create[0].payload.actionId, 'action-1');
  });
});

test('feedback writer treats a database unique conflict as an existing event', async () => {
  await withDatabase(createDatabase(), async (database) => {
    const repository = new StudentStateFeedbackRepository(database);
    const input = event();

    const first = await repository.createIfAbsent(input);
    const second = await repository.createIfAbsent(input);

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.record.id, first.record.id);
    assert.deepEqual(database.calls.findUnique, [{
      userId_eventKey: { userId: 'user-1', eventKey: feedbackDedupeKey(input) },
    }]);
  });
});

test('feedback writer allows distinct signal types for the same action', async () => {
  await withDatabase(createDatabase(), async (database) => {
    const repository = new StudentStateFeedbackRepository(database);

    await repository.createIfAbsent(event('POSITIVE_FEEDBACK'));
    await repository.createIfAbsent(event('NEGATIVE_FEEDBACK'));

    assert.equal(database.rows.length, 2);
    assert.notEqual(database.rows[0].eventKey, database.rows[1].eventKey);
  });
});

test('separate repository instances converge on one row under the same eventKey conflict', async () => {
  await withDatabase(createDatabase(), async (database) => {
    const firstRepository = new StudentStateFeedbackRepository(database);
    const secondRepository = new StudentStateFeedbackRepository(database);
    const input = event();

    const results = await Promise.all([
      firstRepository.createIfAbsent(input),
      secondRepository.createIfAbsent(input),
    ]);

    assert.equal(database.rows.length, 1);
    assert.equal(results.filter((result) => result.created).length, 1);
    assert.equal(new Set(results.map((result) => result.record.id)).size, 1);
  });
});
