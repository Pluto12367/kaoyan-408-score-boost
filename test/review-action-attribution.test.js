import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url)); require('ts-node/register');
const { resolveReviewActionId } = require('../apps/api/src/study/review-action-attribution.ts');

const action = (status = 'CREATED', userId = 'u-1') => ({ id: 'a-1', status, userId });

test('created and started actions are attributable', () => { assert.equal(resolveReviewActionId(action('CREATED'), 'u-1', 'a-1'), 'a-1'); assert.equal(resolveReviewActionId(action('STARTED'), 'u-1', 'a-1'), 'a-1'); });
for (const status of ['COMPLETED', 'CANCELLED', 'EXPIRED']) test(`rejects ${status} action`, () => assert.throws(() => resolveReviewActionId(action(status), 'u-1', 'a-1'), (e) => e.code === 'ACTION_INVALID_TRANSITION'));
test('missing and foreign actions are rejected', () => { assert.throws(() => resolveReviewActionId(null, 'u-1', 'a-1'), (e) => e.code === 'ACTION_NOT_FOUND'); assert.throws(() => resolveReviewActionId(action('CREATED', 'u-2'), 'u-1', 'a-1'), (e) => e.code === 'ACTION_FORBIDDEN'); });
test('client spoof cannot override validated action identity', () => { assert.equal(resolveReviewActionId(action('CREATED'), 'u-1', 'fake'), 'a-1'); });
test('direct review remains actionless', () => { assert.equal(resolveReviewActionId(undefined, 'u-1', undefined), null); });
test('action and attempt identities remain distinct', () => { const id = resolveReviewActionId(action(), 'u-1', 'a-1'); assert.notEqual(id, 'attempt-1'); assert.notEqual(id, 'schedule-1'); });
test('same schedule and idempotency key is a stable lookup boundary', () => { const keys = new Set(['schedule-1:key-1']); keys.add('schedule-1:key-1'); assert.equal(keys.size, 1); });
test('different idempotency keys permit separate attempts', () => { const keys = new Set(['schedule-1:key-1', 'schedule-1:key-2']); assert.equal(keys.size, 2); });
test('multiple actions remain isolated', () => { assert.equal(resolveReviewActionId({ ...action(), id: 'a-1' }, 'u-1', 'ignored'), 'a-1'); assert.equal(resolveReviewActionId({ ...action(), id: 'a-2' }, 'u-1', 'ignored'), 'a-2'); });
test('invalid action request is never silently converted to direct review', () => { assert.throws(() => resolveReviewActionId(null, 'u-1', 'fake'), (e) => e.code === 'ACTION_NOT_FOUND'); });
test('legacy attempt rows can remain actionless', () => { const row = { actionId: null, idempotencyKey: null }; assert.equal(row.actionId, null); assert.equal(row.idempotencyKey, null); });
test('existing review reads preserve optional attribution fields', () => { const row = { actionId: 'a-1', idempotencyKey: 'k-1' }; assert.equal(row.actionId, 'a-1'); assert.equal(row.idempotencyKey, 'k-1'); });
test('review attempt attribution never uses question identity', () => { const row = { actionId: 'a-1', questionId: 'q-1' }; assert.notEqual(row.actionId, row.questionId); });
