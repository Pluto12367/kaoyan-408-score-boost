import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

const { RecommendationActionService, ActionDomainError } = require('../apps/api/src/study/recommendation-action.service.ts');

class FakeRepository {
  constructor() { this.rows = new Map(); this.next = 1; }
  async create(input) {
    const row = { id: `a-${this.next++}`, ...input, status: 'CREATED', version: 0, createdAt: new Date(), updatedAt: new Date(), startedAt: null, completedAt: null, cancelledAt: null };
    this.rows.set(row.id, row); return { ...row };
  }
  async findById(id) { return this.rows.get(id) ?? null; }
  async findByUserAndId(userId, id) { const row = this.rows.get(id); return row?.userId === userId ? row : null; }
  async findByCreationKey(userId, creationKey) { return [...this.rows.values()].find((r) => r.userId === userId && r.creationKey === creationKey) ?? null; }
  async updateStatusWithVersion(input) {
    const row = this.rows.get(input.id);
    if (!row || row.userId !== input.userId || row.version !== input.expectedVersion || row.status !== input.expectedStatus) return null;
    Object.assign(row, input.data, { version: row.version + 1, updatedAt: new Date() }); return { ...row };
  }
}

const command = (overrides = {}) => ({ userId: 'u-1', actionType: 'PRACTICE', targetType: 'QUESTION', targetId: 'q-1', reason: 'LOW_ACCURACY', evidenceRefs: [{ kind: 'practice_record', id: 'r-1' }], creationKey: 'k-1', ...overrides });

test('create action succeeds with CREATED and version 0', async () => {
  const service = new RecommendationActionService(new FakeRepository());
  const row = await service.createAction(command());
  assert.equal(row.status, 'CREATED'); assert.equal(row.version, 0); assert.equal(row.userId, 'u-1');
});

test('duplicate creation key returns existing action', async () => {
  const repo = new FakeRepository(); const service = new RecommendationActionService(repo);
  const first = await service.createAction(command()); const second = await service.createAction(command({ reason: 'same retry' }));
  assert.equal(second.id, first.id);
});

test('same creation key across users creates distinct actions', async () => {
  const repo = new FakeRepository(); const service = new RecommendationActionService(repo);
  const first = await service.createAction(command()); const second = await service.createAction(command({ userId: 'u-2' }));
  assert.notEqual(second.id, first.id);
});

test('invalid action and target types are rejected', async () => {
  const service = new RecommendationActionService(new FakeRepository());
  await assert.rejects(() => service.createAction(command({ actionType: 'LEARN' })), (e) => e.code === 'ACTION_INVALID_TRANSITION');
  await assert.rejects(() => service.createAction(command({ targetType: 'MIXED' })), (e) => e.code === 'ACTION_INVALID_TRANSITION');
});

test('lifecycle allows CREATED to STARTED to COMPLETED', async () => {
  const service = new RecommendationActionService(new FakeRepository()); const row = await service.createAction(command());
  const started = await service.startAction({ userId: 'u-1', actionId: row.id, expectedVersion: 0 });
  const completed = await service.completeAction({ userId: 'u-1', actionId: row.id, expectedVersion: 1 });
  assert.equal(started.status, 'STARTED'); assert.equal(completed.status, 'COMPLETED'); assert.equal(completed.version, 2);
});

test('lifecycle allows CREATED to CANCELLED', async () => { const s = new RecommendationActionService(new FakeRepository()); const r = await s.createAction(command()); const x = await s.cancelAction({ userId: 'u-1', actionId: r.id, expectedVersion: 0 }); assert.equal(x.status, 'CANCELLED'); });
test('lifecycle allows STARTED to CANCELLED', async () => { const s = new RecommendationActionService(new FakeRepository()); const r = await s.createAction(command()); await s.startAction({ userId: 'u-1', actionId: r.id, expectedVersion: 0 }); const x = await s.cancelAction({ userId: 'u-1', actionId: r.id, expectedVersion: 1 }); assert.equal(x.status, 'CANCELLED'); });
test('lifecycle allows CREATED to EXPIRED', async () => { const s = new RecommendationActionService(new FakeRepository()); const r = await s.createAction(command()); const x = await s.expireAction({ userId: 'u-1', actionId: r.id, expectedVersion: 0 }); assert.equal(x.status, 'EXPIRED'); });

for (const [name, op] of [['completed cannot start', async (s, id) => { await s.startAction({ userId: 'u-1', actionId: id, expectedVersion: 2 }); }], ['cancelled cannot start', async (s, id) => { await s.startAction({ userId: 'u-1', actionId: id, expectedVersion: 1 }); }], ['expired cannot start', async (s, id) => { await s.startAction({ userId: 'u-1', actionId: id, expectedVersion: 1 }); }]]) {
  test(`invalid transition: ${name}`, async () => { const s = new RecommendationActionService(new FakeRepository()); const r = await s.createAction(command()); if (name.startsWith('completed')) { await s.startAction({ userId: 'u-1', actionId: r.id, expectedVersion: 0 }); await s.completeAction({ userId: 'u-1', actionId: r.id, expectedVersion: 1 }); } else if (name.startsWith('cancelled')) await s.cancelAction({ userId: 'u-1', actionId: r.id, expectedVersion: 0 }); else await s.expireAction({ userId: 'u-1', actionId: r.id, expectedVersion: 0 }); await assert.rejects(() => op(s, r.id), (e) => e.code === 'ACTION_INVALID_TRANSITION'); });
}

test('wrong version returns ACTION_VERSION_CONFLICT', async () => { const s = new RecommendationActionService(new FakeRepository()); const r = await s.createAction(command()); await assert.rejects(() => s.startAction({ userId: 'u-1', actionId: r.id, expectedVersion: 9 }), (e) => e.code === 'ACTION_VERSION_CONFLICT'); });
test('missing action returns ACTION_NOT_FOUND', async () => { const s = new RecommendationActionService(new FakeRepository()); await assert.rejects(() => s.startAction({ userId: 'u-1', actionId: 'missing', expectedVersion: 0 }), (e) => e.code === 'ACTION_NOT_FOUND'); });
test('other user cannot access action', async () => { const s = new RecommendationActionService(new FakeRepository()); const r = await s.createAction(command()); await assert.rejects(() => s.startAction({ userId: 'u-2', actionId: r.id, expectedVersion: 0 }), (e) => e.code === 'ACTION_FORBIDDEN'); });
test('all mutations require expectedVersion', async () => { const s = new RecommendationActionService(new FakeRepository()); const r = await s.createAction(command()); await assert.rejects(() => s.cancelAction({ userId: 'u-1', actionId: r.id }), /expectedVersion/); });
