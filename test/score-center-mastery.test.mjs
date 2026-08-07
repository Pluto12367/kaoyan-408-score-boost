import test from 'node:test';
import assert from 'node:assert/strict';
import {
  updateMasteryAfterAttempt,
  estimateRetention,
  updateStabilityAfterReview,
} from '../packages/shared/dist/index.js';

const base = {
  mastery: 0.5,
  accuracy: 0.5,
  recentAccuracy: 0.5,
  attempts: 10,
  correctCount: 5,
  wrongCount: 5,
  confidence: 0.5,
};

test('correct primary answer raises mastery', () => {
  const next = updateMasteryAfterAttempt(base, {
    isCorrect: true,
    difficulty: 4,
    role: 'PRIMARY',
  });
  assert.ok(next.mastery > base.mastery);
});

test('wrong answer lowers mastery', () => {
  const next = updateMasteryAfterAttempt(base, {
    isCorrect: false,
    difficulty: 1,
    role: 'PRIMARY',
  });
  assert.ok(next.mastery < base.mastery);
});

test('secondary tag changes mastery less than primary', () => {
  const primary = updateMasteryAfterAttempt(base, { isCorrect: false, difficulty: 2, role: 'PRIMARY' });
  const secondary = updateMasteryAfterAttempt(base, { isCorrect: false, difficulty: 2, role: 'SECONDARY' });
  assert.ok(
    Math.abs(primary.mastery - base.mastery) > Math.abs(secondary.mastery - base.mastery),
    'secondary contribution must be dampened',
  );
});

test('mastery stays bounded in 0..1 under extreme inputs', () => {
  const optimistic = updateMasteryAfterAttempt(
    { ...base, mastery: 0.99 },
    { isCorrect: true, difficulty: 5, role: 'PRIMARY' },
  );
  const pessimistic = updateMasteryAfterAttempt(
    { ...base, mastery: 0.01 },
    { isCorrect: false, difficulty: 1, role: 'PRIMARY' },
  );
  assert.ok(optimistic.mastery <= 1 && optimistic.mastery >= 0);
  assert.ok(pessimistic.mastery <= 1 && pessimistic.mastery >= 0);
});

test('attempt counters and cumulative accuracy update together', () => {
  const next = updateMasteryAfterAttempt(base, { isCorrect: true, difficulty: 3, role: 'PRIMARY' });
  assert.equal(next.attempts, 11);
  assert.equal(next.correctCount, 6);
  assert.equal(next.wrongCount, 5);
  assert.equal(next.accuracy, 6 / 11);
});

test('recent accuracy smooths toward the latest outcome', () => {
  const correct = updateMasteryAfterAttempt(base, { isCorrect: true, difficulty: 3, role: 'PRIMARY' });
  const wrong = updateMasteryAfterAttempt(base, { isCorrect: false, difficulty: 3, role: 'PRIMARY' });
  assert.ok(correct.recentAccuracy > base.recentAccuracy);
  assert.ok(wrong.recentAccuracy < base.recentAccuracy);
});

test('confidence increases with more attempts and stays at most 1', () => {
  const low = updateMasteryAfterAttempt(
    { ...base, attempts: 0, confidence: 0 },
    { isCorrect: true, difficulty: 3, role: 'PRIMARY' },
  );
  const high = updateMasteryAfterAttempt(
    { ...base, attempts: 200, confidence: 0.9 },
    { isCorrect: true, difficulty: 3, role: 'PRIMARY' },
  );
  assert.ok(low.confidence > 0 && low.confidence < 1);
  assert.ok(high.confidence <= 1);
  assert.ok(high.confidence > base.confidence);
});

test('updateMasteryAfterAttempt returns a new object without mutating input', () => {
  const input = { ...base };
  const next = updateMasteryAfterAttempt(input, { isCorrect: true, difficulty: 3, role: 'PRIMARY' });
  assert.notEqual(next, input);
  assert.deepEqual(input, base);
});

test('retention decays with elapsed time', () => {
  const last = new Date('2026-08-01T00:00:00Z');
  const early = estimateRetention(last, 10, new Date('2026-08-02T00:00:00Z'));
  const late = estimateRetention(last, 10, new Date('2026-08-08T00:00:00Z'));
  assert.ok(early > late);
});

test('retention without a prior review returns neutral 0.5', () => {
  const now = new Date('2026-08-07T00:00:00Z');
  assert.equal(estimateRetention(null, null, now), 0.5);
  assert.equal(estimateRetention(null, 10, now), 0.5);
  assert.equal(estimateRetention(now, null, now), 0.5);
});

test('retention is clamped to 0..1', () => {
  const last = new Date('2026-01-01T00:00:00Z');
  const now = new Date('2026-08-07T00:00:00Z');
  const value = estimateRetention(last, 0.001, now);
  assert.ok(value >= 0 && value <= 1);
});

test('review stability grows with quality and has a floor', () => {
  const poor = updateStabilityAfterReview(10, 0);
  const good = updateStabilityAfterReview(10, 5);
  assert.ok(good > poor);
  assert.equal(updateStabilityAfterReview(0.1, 1), 0.5);
});

test('review stability starts from 1 day when no previous stability exists', () => {
  assert.equal(updateStabilityAfterReview(null, 0), 0.6);
  assert.equal(updateStabilityAfterReview(null, 3), 1.35);
});
