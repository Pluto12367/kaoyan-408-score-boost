import test from 'node:test';
import assert from 'node:assert/strict';

const mod = await import('../scripts/backfill-user-mastery.mjs');

test('backfill module exposes the replay entry points', () => {
  assert.equal(typeof mod.replayUserMastery, 'function');
  assert.equal(typeof mod.resolveNodesForQuestion, 'function');
});

test('backfill clamps node difficulty into the supported 1..5 range', () => {
  assert.equal(mod.clampDifficulty(0), 1);
  assert.equal(mod.clampDifficulty(3.6), 4);
  assert.equal(mod.clampDifficulty(9), 5);
});
