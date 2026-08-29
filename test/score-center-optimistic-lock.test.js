import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

const {
  MasteryOptimisticLockConflictError,
  saveMastery,
} = require('../apps/api/src/score-center/repository.ts');
const { ScoreCenterService } = require('../apps/api/src/score-center/service.ts');

const USER_ID = 'student-1';
const NODE_ID = 'node-1';
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

test.after(() => {
  if (ORIGINAL_DATABASE_URL == null) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
  }
});

test('saveMastery creates version 0 and ordinary updates increment version 0 to 1 to 2', async () => {
  const db = new FakeScoreCenterDb();

  await saveMastery(db, USER_ID, NODE_ID, masteryState({ attempts: 0 }));
  assert.equal(db.masteryFor(USER_ID, NODE_ID).version, 0);

  await saveMastery(db, USER_ID, NODE_ID, masteryState({ attempts: 1, correctCount: 1 }));
  assert.equal(db.masteryFor(USER_ID, NODE_ID).version, 1);

  await saveMastery(db, USER_ID, NODE_ID, masteryState({ attempts: 2, correctCount: 2 }));
  assert.equal(db.masteryFor(USER_ID, NODE_ID).version, 2);
});

test('two different concurrent attempts against the same node both accumulate after a version retry', async () => {
  const db = new FakeScoreCenterDb();
  db.seedMastery(masteryRow());
  db.holdNextMasteryReads(2);
  const service = createService(db);

  await Promise.all([
    service.applyAttempts(USER_ID, [attemptFact({ questionId: 'q-correct', correct: true })]),
    service.applyAttempts(USER_ID, [attemptFact({ questionId: 'q-wrong', correct: false })]),
  ]);

  const row = db.masteryFor(USER_ID, NODE_ID);
  assert.equal(row.attempts, 2);
  assert.equal(row.correctCount, 1);
  assert.equal(row.wrongCount, 1);
  assert.equal(row.version, 2);
});

test('saveMastery retries when the first conditional update observes a stale version', async () => {
  const db = new FakeScoreCenterDb();
  db.seedMastery(masteryRow());
  db.forceUpdateConflicts(1);

  await saveMastery(db, USER_ID, NODE_ID, masteryState({ attempts: 1, correctCount: 1 }));

  const row = db.masteryFor(USER_ID, NODE_ID);
  assert.equal(row.attempts, 1);
  assert.equal(row.correctCount, 1);
  assert.equal(row.version, 1);
});

test('saveMastery throws a conflict error after more than three consecutive version conflicts', async () => {
  const db = new FakeScoreCenterDb();
  db.seedMastery(masteryRow());
  db.forceUpdateConflicts(4);

  await assert.rejects(
    () => saveMastery(db, USER_ID, NODE_ID, masteryState({ attempts: 1, correctCount: 1 })),
    (error) => error instanceof MasteryOptimisticLockConflictError,
  );

  const row = db.masteryFor(USER_ID, NODE_ID);
  assert.equal(row.attempts, 0);
  assert.equal(row.version, 0);
});

test('applyAttempt and applyReview can retry without overwriting each other fields', async () => {
  const db = new FakeScoreCenterDb();
  db.seedMastery(masteryRow({
    attempts: 1,
    correctCount: 1,
    pinned: true,
    lastLearnedAt: new Date('2026-08-22T10:00:00.000Z'),
  }));
  db.holdNextMasteryReads(2);
  const service = createService(db);
  const reviewedAt = new Date('2026-08-23T10:00:00.000Z');
  const submittedAt = new Date('2026-08-23T10:01:00.000Z');

  await Promise.all([
    service.applyAttempts(USER_ID, [attemptFact({ questionId: 'q-correct', correct: true, submittedAt })]),
    service.applyReview(USER_ID, 'q-correct', { reviewedAt, redoCorrect: true }),
  ]);

  const row = db.masteryFor(USER_ID, NODE_ID);
  assert.equal(row.attempts, 2);
  assert.equal(row.correctCount, 2);
  assert.equal(row.wrongCount, 0);
  assert.equal(row.retention, 1);
  assert.equal(row.stabilityDays, 1.7);
  assert.equal(row.lastReviewedAt.toISOString(), reviewedAt.toISOString());
  assert.equal(row.lastLearnedAt.toISOString(), submittedAt.toISOString());
  assert.equal(row.pinned, true);
  assert.equal(row.version, 2);
});

test('batch-style Promise.all attempts mapped to the same node do not lose updates', async () => {
  const db = new FakeScoreCenterDb();
  db.seedMastery(masteryRow());
  db.holdNextMasteryReads(3);
  const service = createService(db);

  await Promise.all([
    service.applyAttempts(USER_ID, [attemptFact({ questionId: 'q-correct', correct: true })]),
    service.applyAttempts(USER_ID, [attemptFact({ questionId: 'q-wrong', correct: false })]),
    service.applyAttempts(USER_ID, [attemptFact({ questionId: 'q-extra', correct: true })]),
  ]);

  const row = db.masteryFor(USER_ID, NODE_ID);
  assert.equal(row.attempts, 3);
  assert.equal(row.correctCount, 2);
  assert.equal(row.wrongCount, 1);
  assert.equal(row.version, 3);
});

test('version increases monotonically through sequential service updates', async () => {
  const db = new FakeScoreCenterDb();
  db.seedMastery(masteryRow());
  const service = createService(db);
  const versions = [];

  for (const questionId of ['q-correct', 'q-wrong', 'q-extra']) {
    await service.applyAttempts(USER_ID, [attemptFact({ questionId, correct: questionId !== 'q-wrong' })]);
    versions.push(db.masteryFor(USER_ID, NODE_ID).version);
  }

  assert.deepEqual(versions, [1, 2, 3]);
});

test('pinned=true survives both attempt and review mastery writes', async () => {
  const db = new FakeScoreCenterDb();
  db.seedMastery(masteryRow({ pinned: true }));
  const service = createService(db);

  await service.applyAttempts(USER_ID, [attemptFact({ questionId: 'q-correct', correct: true })]);
  assert.equal(db.masteryFor(USER_ID, NODE_ID).pinned, true);

  await service.applyReview(USER_ID, 'q-correct', {
    reviewedAt: new Date('2026-08-23T10:00:00.000Z'),
    redoCorrect: true,
  });
  assert.equal(db.masteryFor(USER_ID, NODE_ID).pinned, true);
});

function createService(db) {
  process.env.DATABASE_URL = 'postgresql://unit.test/score-center';
  return new ScoreCenterService(db);
}

function attemptFact(overrides = {}) {
  return {
    questionId: 'q-correct',
    correct: true,
    timeSpentSec: 60,
    submittedAt: new Date('2026-08-23T10:00:00.000Z'),
    ...overrides,
  };
}

function masteryState(overrides = {}) {
  const attempts = overrides.attempts ?? 0;
  const correctCount = overrides.correctCount ?? 0;
  const wrongCount = overrides.wrongCount ?? Math.max(0, attempts - correctCount);
  return {
    mastery: overrides.mastery ?? 0.5,
    accuracy: overrides.accuracy ?? 0.55,
    recentAccuracy: overrides.recentAccuracy ?? 0.55,
    attempts,
    correctCount,
    wrongCount,
    confidence: overrides.confidence ?? 0,
  };
}

function masteryRow(overrides = {}) {
  return {
    id: overrides.id ?? `ukm-${USER_ID}-${NODE_ID}`,
    userId: overrides.userId ?? USER_ID,
    knowledgeNodeId: overrides.knowledgeNodeId ?? NODE_ID,
    ...masteryState(overrides),
    retention: overrides.retention ?? null,
    stabilityDays: overrides.stabilityDays ?? null,
    lastLearnedAt: overrides.lastLearnedAt ?? null,
    lastReviewedAt: overrides.lastReviewedAt ?? null,
    nextReviewAt: overrides.nextReviewAt ?? null,
    pinned: overrides.pinned ?? false,
    version: overrides.version ?? 0,
    createdAt: overrides.createdAt ?? new Date('2026-08-23T00:00:00.000Z'),
    updatedAt: overrides.updatedAt ?? new Date('2026-08-23T00:00:00.000Z'),
  };
}

class FakeScoreCenterDb {
  constructor() {
    this.rows = new Map();
    this.conflictUpdates = 0;
    this.readBarrier = null;
    this.questionKnowledgeNodeTag = {
      findMany: async ({ where }) => (this.questionTags.get(where.questionId) ?? []),
    };
    this.questionKnowledgePoint = {
      findMany: async () => [],
    };
    this.knowledgeNode = {
      findMany: async ({ where }) => [...this.nodes.values()].filter((node) => where.id.in.includes(node.id)),
    };
    this.userKnowledgeMastery = {
      findUnique: async ({ where }) => {
        await this.waitAtReadBarrier();
        return this.clone(this.rows.get(this.key(where.userId_knowledgeNodeId.userId, where.userId_knowledgeNodeId.knowledgeNodeId)) ?? null);
      },
      create: async ({ data }) => {
        const key = this.key(data.userId, data.knowledgeNodeId);
        if (this.rows.has(key)) {
          const error = new Error('unique constraint failed');
          error.code = 'P2002';
          throw error;
        }
        const row = masteryRow({
          id: `ukm-${this.rows.size + 1}`,
          ...data,
          version: data.version ?? 0,
        });
        this.rows.set(key, row);
        return this.clone(row);
      },
      updateMany: async ({ where, data }) => {
        if (this.conflictUpdates > 0) {
          this.conflictUpdates -= 1;
          return { count: 0 };
        }
        const row = [...this.rows.values()].find((candidate) => candidate.id === where.id);
        if (!row || row.version !== where.version) return { count: 0 };
        for (const [field, value] of Object.entries(data)) {
          if (field === 'version' && value && typeof value === 'object' && 'increment' in value) {
            row.version += value.increment;
          } else {
            row[field] = value;
          }
        }
        row.updatedAt = new Date();
        return { count: 1 };
      },
    };
    this.userMasterySnapshot = {
      upsert: async () => null,
    };
    this.wrongQuestionReview = {
      upsert: async () => null,
    };
    this.nodes = new Map([[NODE_ID, { id: NODE_ID, difficulty: 3, isActive: true }]]);
    this.questionTags = new Map([
      ['q-correct', [{ knowledgeNodeId: NODE_ID, role: 'PRIMARY' }]],
      ['q-wrong', [{ knowledgeNodeId: NODE_ID, role: 'PRIMARY' }]],
      ['q-extra', [{ knowledgeNodeId: NODE_ID, role: 'PRIMARY' }]],
    ]);
  }

  async $transaction(work) {
    return work(this);
  }

  key(userId, knowledgeNodeId) {
    return `${userId}:${knowledgeNodeId}`;
  }

  seedMastery(row) {
    this.rows.set(this.key(row.userId, row.knowledgeNodeId), { ...row });
  }

  masteryFor(userId, knowledgeNodeId) {
    return this.rows.get(this.key(userId, knowledgeNodeId));
  }

  forceUpdateConflicts(count) {
    this.conflictUpdates = count;
  }

  holdNextMasteryReads(target) {
    let release;
    const promise = new Promise((resolve) => {
      release = resolve;
    });
    this.readBarrier = { target, waiting: 0, promise, release };
  }

  async waitAtReadBarrier() {
    const barrier = this.readBarrier;
    if (!barrier || barrier.waiting >= barrier.target) return;
    barrier.waiting += 1;
    if (barrier.waiting === barrier.target) {
      this.readBarrier = null;
      barrier.release();
      return;
    }
    await barrier.promise;
  }

  clone(row) {
    return row ? { ...row } : null;
  }
}
