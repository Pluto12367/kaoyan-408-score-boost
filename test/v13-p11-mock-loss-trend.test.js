// PHASE 11 — mock-exam score-loss trend contract tests.
//
// The report already shows accuracy history; this projection adds the LOSING
// dimension: per exam session, how many points were observed lost, how that
// changed versus the previous exam, and which nodes the loss sits on. All of
// it derived from the existing ScoreLoss ledger rows (scoreEntryKind =
// 'assessment') — no mastery input, no prediction input, nothing invented.
//
// Honesty rules pinned here:
//   • OBSERVED and PROXY loss stay in separate fields per exam (IL-6).
//   • Unpriced losses are counted per exam but add no points (NULL ≠ 0).
//   • Unscored exams keep loss fields null, never 0 (unknown ≠ zero).
//   • Deltas compare only adjacent exams that BOTH have observed evidence;
//     otherwise the delta is null with an explicit reason.
//   • Deterministic ordering by date then sessionId; ranks 1..N.
//   • Read-only by construction.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMockLossTrend } from '../packages/shared/dist/index.js';

const loss = (over = {}) => ({
  sessionId: 's-1', questionId: 'q-1', nodeId: 'node-pv',
  lostScore: 2, lossKind: 'OBSERVED', recordedAt: '2026-09-10T00:00:00.000Z', ...over,
});

function build(exams, losses) {
  return buildMockLossTrend({ exams, losses });
}

const exam = (over = {}) => ({
  sessionId: 's-1', date: '2026-09-10', totalQuestions: 5, correctCount: 3, accuracyRate: 60, totalTimeMin: 20, ...over,
});

test('P11 #1/#2 per-exam loss aggregates; OBSERVED and PROXY stay separate; unpriced counted', () => {
  const result = build(
    [exam({ sessionId: 's-1' })],
    [
      loss({ sessionId: 's-1', questionId: 'q-1', lostScore: 2, lossKind: 'OBSERVED' }),
      loss({ sessionId: 's-1', questionId: 'q-2', lostScore: 3, lossKind: 'OBSERVED' }),
      loss({ sessionId: 's-1', questionId: 'q-3', lostScore: 5, lossKind: 'PROXY' }),
      loss({ sessionId: 's-1', questionId: 'q-4', lostScore: null, lossKind: 'OBSERVED' }),
    ],
  );
  const row = result.rows[0];
  assert.equal(row.observedLostScore, 5);
  assert.equal(row.proxyLostScore, 5, 'proxy loss never leaks into the observed field');
  assert.equal(row.pricedLossQuestions, 3);
  assert.equal(row.unpricedLossQuestions, 1, 'unpriced counted, never priced');
  assert.equal(row.accuracyRate, 60);
});

test('P11 #3 unscored exams keep null loss, never zero; empty ledger yields EMPTY', () => {
  const result = build([exam({ sessionId: 's-9' })], []);
  assert.equal(result.rows[0].observedLostScore, null, 'no evidence → null (unknown ≠ 0)');
  assert.equal(result.rows[0].proxyLostScore, null);
  assert.equal(result.rows[0].pricedLossQuestions, 0);
  assert.equal(result.dataStatus, 'EMPTY');

  const empty = build([], []);
  assert.equal(empty.dataStatus, 'EMPTY');
  assert.deepEqual(empty.rows, []);
});

test('P11 #4 deltas require adjacent exams BOTH with observed evidence, else null + reason', () => {
  const result = build(
    [exam({ sessionId: 's-1', date: '2026-09-10' }), exam({ sessionId: 's-2', date: '2026-09-12' }), exam({ sessionId: 's-3', date: '2026-09-15' })],
    [
      loss({ sessionId: 's-1', questionId: 'q-1', lostScore: 6 }),
      loss({ sessionId: 's-2', questionId: 'q-2', lostScore: 2 }),
      // s-3 has no loss evidence
    ],
  );
  const [first, second, third] = result.rows;
  assert.equal(first.observedLossDelta, null, 'first exam has no predecessor');
  assert.ok(first.deltaReason);
  assert.equal(second.observedLossDelta, -4, 'loss fell 6 → 2 (improvement)');
  assert.equal(second.observedLossDeltaLabel, '较上次少丢 4 分');
  assert.equal(third.observedLossDelta, null, 'no observed evidence on this exam → no delta claim');
  assert.ok(third.deltaReason);

  const worse = build(
    [exam({ sessionId: 's-1', date: '2026-09-10' }), exam({ sessionId: 's-2', date: '2026-09-12' })],
    [loss({ sessionId: 's-1', questionId: 'q-1', lostScore: 2 }), loss({ sessionId: 's-2', questionId: 'q-2', lostScore: 5 })],
  );
  assert.equal(worse.rows[1].observedLossDelta, 3);
  assert.equal(worse.rows[1].observedLossDeltaLabel, '较上次多丢 3 分');

  // Same-day exams have no determinable order: refuse the comparison.
  const sameDay = build(
    [exam({ sessionId: 's-a', date: '2026-09-10' }), exam({ sessionId: 's-b', date: '2026-09-10' })],
    [loss({ sessionId: 's-a', questionId: 'q-1', lostScore: 2 }), loss({ sessionId: 's-b', questionId: 'q-2', lostScore: 5 })],
  );
  assert.equal(sameDay.rows[1].observedLossDelta, null, 'same-day order is unknowable');
  assert.match(sameDay.rows[1].deltaReason, /同一天/);
});

test('P11 #5 node attribution per exam, ranked by lost points; unattributed stays explicit', () => {
  const result = build(
    [exam({ sessionId: 's-1' })],
    [
      loss({ sessionId: 's-1', questionId: 'q-1', nodeId: 'node-a', lostScore: 2 }),
      loss({ sessionId: 's-1', questionId: 'q-2', nodeId: 'node-b', lostScore: 4 }),
      loss({ sessionId: 's-1', questionId: 'q-3', nodeId: null, lostScore: 2 }),
    ],
  );
  const row = result.rows[0];
  assert.equal(row.nodes.length, 2);
  assert.equal(row.nodes[0].nodeId, 'node-b');
  assert.equal(row.nodes[0].observedLostScore, 4);
  assert.equal(row.unattributedObservedLoss, 2, 'node-less loss is counted separately');
  assert.equal(row.nodes.reduce((sum, n) => sum + n.observedLostScore, 0) + row.unattributedObservedLoss, row.observedLostScore);
});

test('P11 determinism + loss rows for sessions outside the exam list are ignored', () => {
  const result = build(
    [exam({ sessionId: 's-2', date: '2026-09-12' }), exam({ sessionId: 's-1', date: '2026-09-10' })],
    [loss({ sessionId: 's-1', questionId: 'q-1', lostScore: 2 }), loss({ sessionId: 'ghost', questionId: 'q-9', lostScore: 99 })],
  );
  assert.deepEqual(result.rows.map((row) => row.sessionId), ['s-1', 's-2'], 'sorted by date, not input order');
  assert.equal(result.rows[0].observedLostScore, 2, 'ghost-session losses are ignored');
  assert.equal(result.summary.totalObservedLostScore, 2);
  assert.deepEqual(result.rows.map((row) => row.priorityRank), [1, 2]);
  const again = build(
    [exam({ sessionId: 's-2', date: '2026-09-12' }), exam({ sessionId: 's-1', date: '2026-09-10' })],
    [loss({ sessionId: 's-1', questionId: 'q-1', lostScore: 2 }), loss({ sessionId: 'ghost', questionId: 'q-9', lostScore: 99 })],
  );
  assert.deepEqual(again, result);
});
