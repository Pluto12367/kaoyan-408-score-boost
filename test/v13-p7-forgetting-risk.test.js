// PHASE 7 — Forgetting Risk projection contract tests.
//
// "会了但快忘了": the projection covers LEARNED nodes (mastery >= 0.45) and
// computes decay with the ONE shared retention formula (estimateRetention),
// classifying each into overdue / at_risk / due_soon / healthy.
//
// Honesty rules pinned here:
//   • insufficient data (no lastReviewedAt or no stabilityDays) is counted,
//     never claimed as at-risk (unknown ≠ risk)
//   • weak/unlearned nodes (mastery < 0.45) are OUT of forgetting scope
//     (they belong to weakness/diagnosis, not forgetting defense)
//   • risk precedence is explicit: overdue > at_risk > due_soon > healthy
//   • deterministic ordering and empty state with zero rows
//   • pure: read-only facts in, plan out; no mastery write, no priority input

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildForgettingRisk,
  FORGETTING_RETENTION_THRESHOLD,
} from '../packages/shared/dist/index.js';

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

function row(overrides = {}) {
  return {
    nodeId: 'node-pv',
    subject: 'OS',
    nodeName: 'PV 操作',
    mastery: 0.8,
    attempts: 5,
    stabilityDays: 2,
    lastReviewedAt: new Date(NOW - 10 * DAY).toISOString(),
    nextReviewAt: new Date(NOW + 2 * DAY).toISOString(),
    ...overrides,
  };
}

function build(rows, extra = {}) {
  return buildForgettingRisk({ now: new Date(NOW).toISOString(), rows, ...extra });
}

test('P7: mastered node whose shared-formula retention fell below threshold is at_risk', () => {
  const result = build([row()]);
  assert.equal(result.dataStatus, 'OK');
  assert.equal(result.rows.length, 1);
  const entry = result.rows[0];
  assert.equal(entry.risk, 'at_risk');
  assert.equal(entry.learnedStage, 'mastered');
  // the projection must use the shared exp-decay formula, not its own
  assert.ok(Math.abs(entry.retention - Math.exp(-10 / 2)) < 1e-9, `retention=${entry.retention}`);
  assert.ok(entry.retention < FORGETTING_RETENTION_THRESHOLD);
  assert.equal(entry.daysSinceReview, 10);
  assert.equal(result.summary.atRiskCount, 1);
  assert.match(entry.finding, /可能遗忘|风险/);
});

test('P7: overdue schedule outranks at_risk; explicit precedence', () => {
  const result = build([
    row({ nodeId: 'node-overdue', lastReviewedAt: new Date(NOW - 9 * DAY).toISOString(), nextReviewAt: new Date(NOW - 2 * DAY).toISOString(), stabilityDays: 3 }),
    row({ nodeId: 'node-risk', lastReviewedAt: new Date(NOW - 10 * DAY).toISOString(), nextReviewAt: new Date(NOW + 5 * DAY).toISOString(), stabilityDays: 2 }),
  ]);
  const overdue = result.rows.find((entry) => entry.nodeId === 'node-overdue');
  const atRisk = result.rows.find((entry) => entry.nodeId === 'node-risk');
  assert.equal(overdue.risk, 'overdue');
  assert.equal(atRisk.risk, 'at_risk');
  assert.equal(result.rows[0].nodeId, 'node-overdue', 'overdue sorts first');
  assert.equal(result.summary.overdueCount, 1);
  assert.equal(result.summary.atRiskCount, 2, 'atRiskCount aggregates overdue + at_risk');
});

test('P7: due soon (next 24h) and healthy stay out of the at-risk count', () => {
  const result = build([
    row({ nodeId: 'node-soon', lastReviewedAt: new Date(NOW - 1 * DAY).toISOString(), stabilityDays: 3, nextReviewAt: new Date(NOW + 12 * 3_600_000).toISOString() }),
    row({ nodeId: 'node-healthy', lastReviewedAt: new Date(NOW - 1 * DAY).toISOString(), stabilityDays: 5, nextReviewAt: new Date(NOW + 4 * DAY).toISOString() }),
  ]);
  assert.equal(result.rows.find((entry) => entry.nodeId === 'node-soon').risk, 'due_soon');
  assert.equal(result.rows.find((entry) => entry.nodeId === 'node-healthy').risk, 'healthy');
  assert.equal(result.summary.dueSoonCount, 1);
  assert.equal(result.summary.atRiskCount, 0);
  assert.equal(result.summary.learnedNodes, 2);
});

test('P7: insufficient data is counted honestly and never claimed at-risk', () => {
  const result = build([
    row({ nodeId: 'node-unknown', stabilityDays: null, lastReviewedAt: null }),
  ]);
  const entry = result.rows.find((rowItem) => rowItem.nodeId === 'node-unknown');
  assert.equal(entry.retention, null, 'no fabricated retention');
  assert.equal(entry.risk, 'healthy', 'unknown decays nothing — it is simply not a risk claim');
  assert.equal(result.summary.insufficientDataCount, 1);
  assert.equal(result.summary.atRiskCount, 0);
});

test('P7: weak/unlearned nodes are outside forgetting scope entirely', () => {
  const result = build([
    row({ nodeId: 'node-weak', mastery: 0.3 }),
    row({ nodeId: 'node-learned', mastery: 0.5, stabilityDays: 2, lastReviewedAt: new Date(NOW - 10 * DAY).toISOString() }),
  ]);
  assert.equal(result.rows.some((entry) => entry.nodeId === 'node-weak'), false, 'mastery<0.45 excluded');
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].learnedStage, 'review');
});

test('P7: deterministic ordering (risk, then retention asc, then nodeId) and EMPTY state', () => {
  const rows = [
    row({ nodeId: 'node-b', lastReviewedAt: new Date(NOW - 4 * DAY).toISOString(), stabilityDays: 1 }),
    row({ nodeId: 'node-a', lastReviewedAt: new Date(NOW - 4 * DAY).toISOString(), stabilityDays: 1 }),
  ];
  const first = build(rows);
  const second = build(rows);
  assert.deepEqual(first, second, 'deterministic');
  assert.deepEqual(first.rows.map((entry) => entry.nodeId), ['node-a', 'node-b'], 'retention tie → nodeId asc');

  const empty = build([]);
  assert.equal(empty.dataStatus, 'EMPTY');
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.summary.learnedNodes, 0);
});

test('P7: priorityRank is 1..N without gaps and reflections are stable', () => {
  const result = build([
    row({ nodeId: 'n1', nextReviewAt: new Date(NOW - DAY).toISOString() }),
    row({ nodeId: 'n2' }),
    row({ nodeId: 'n3', lastReviewedAt: new Date(NOW - 1 * DAY).toISOString(), stabilityDays: 5, nextReviewAt: new Date(NOW + 6 * DAY).toISOString() }),
  ]);
  assert.deepEqual(result.rows.map((entry) => entry.priorityRank), [1, 2, 3]);
});
