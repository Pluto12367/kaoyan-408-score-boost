import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

const { StudyPlanRepository } = require('../apps/api/src/study/study-plan.repository.ts');

function p2002() {
  return Object.assign(new Error('unique constraint failed'), { code: 'P2002' });
}

class FakeStudyPlanDatabase {
  constructor() {
    this.rows = new Map();
    this.nextId = 1;
    this.pendingCreates = 0;
    this.blockCreates = false;
    this.studyPlan = {
      findUnique: async ({ where }) => {
        const key = `${where.userId_generationKey.userId}:${where.userId_generationKey.generationKey}`;
        return this.rows.get(key) ?? null;
      },
      create: async ({ data }) => {
        if (this.blockCreates) {
          this.pendingCreates += 1;
          await new Promise((resolve) => {
            this._createWaiters = [...(this._createWaiters ?? []), resolve];
          });
        }
        const key = `${data.userId}:${data.generationKey}`;
        if (this.rows.has(key)) throw p2002();
        const row = { id: `plan-${this.nextId++}`, ...data, tasks: [] };
        this.rows.set(key, row);
        return row;
      },
    };
  }

  async $transaction(callback) {
    return callback(this);
  }

  releaseCreateWaiters() {
    for (const resolve of this._createWaiters ?? []) resolve();
    this._createWaiters = [];
  }
}

function draft(overrides = {}) {
  return {
    userId: 'user-1',
    generationKey: 'LEARNING_LOOP:user-1:2026-09-03:v1',
    phase: 'score-center',
    targetScore: 115,
    remainingDays: 96,
    dailyHours: 3,
    checkpoint: 'score-center',
    ...overrides,
  };
}

test('same generation key returns one StudyPlan on retry', async () => {
  const db = new FakeStudyPlanDatabase();
  const repository = new StudyPlanRepository(db);
  const first = await repository.createOrGetByGenerationKey(draft());
  const second = await repository.createOrGetByGenerationKey(draft({ phase: 'retry' }));

  assert.equal(second.id, first.id);
  assert.equal(db.rows.size, 1);
});

test('different generation keys create separate StudyPlans', async () => {
  const db = new FakeStudyPlanDatabase();
  const repository = new StudyPlanRepository(db);
  await repository.createOrGetByGenerationKey(draft());
  await repository.createOrGetByGenerationKey(draft({ generationKey: 'MANUAL:user-1:2026-09-03:req-2' }));

  assert.equal(db.rows.size, 2);
});

test('concurrent creation converges after a database unique conflict', async () => {
  const db = new FakeStudyPlanDatabase();
  db.blockCreates = true;
  const repository = new StudyPlanRepository(db);
  const first = repository.createOrGetByGenerationKey(draft());
  const second = repository.createOrGetByGenerationKey(draft());

  await new Promise((resolve) => setImmediate(resolve));
  db.releaseCreateWaiters();
  const rows = await Promise.all([first, second]);

  assert.equal(rows[0].id, rows[1].id);
  assert.equal(db.rows.size, 1);
});

test('generation key is required and cannot be silently treated as a legacy plan', async () => {
  const repository = new StudyPlanRepository(new FakeStudyPlanDatabase());

  await assert.rejects(
    () => repository.createOrGetByGenerationKey(draft({ generationKey: '' })),
    /generationKey/,
  );
});
