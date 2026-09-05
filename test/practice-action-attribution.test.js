import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url)); require('ts-node/register');
const { resolvePracticeActionId } = require('../apps/api/src/study/practice-action-attribution.ts');

const makeRecord = ({ session, requestActionId } = {}) => ({
  sessionId: session?.id,
  actionId: resolvePracticeActionId(session, requestActionId),
  requestActionId,
});

test('practice record inherits actionId from attributed session', () => {
  assert.equal(makeRecord({ session: { id: 's-a', actionId: 'a-1' } }).actionId, 'a-1');
});

test('direct practice remains actionless', () => {
  assert.equal(makeRecord({ session: { id: 's-direct' } }).actionId, null);
  assert.equal(makeRecord().actionId, null);
});

test('client actionId cannot spoof session attribution', () => {
  assert.equal(makeRecord({ session: { id: 's-a', actionId: 'a-1' }, requestActionId: 'fake' }).actionId, 'a-1');
});

test('different attributed sessions remain isolated', () => {
  assert.equal(makeRecord({ session: { id: 's-a', actionId: 'a-1' } }).actionId, 'a-1');
  assert.equal(makeRecord({ session: { id: 's-b', actionId: 'a-2' } }).actionId, 'a-2');
});

test('actionId is distinct from session identity', () => {
  const record = makeRecord({ session: { id: 's-a', actionId: 'a-1' } });
  assert.notEqual(record.actionId, record.sessionId);
});
