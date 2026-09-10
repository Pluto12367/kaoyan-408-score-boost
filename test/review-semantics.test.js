/**
 * V12-M3 Phase B — Review semantics unification SHADOW (pure contract).
 *
 * The audit found that mastery and stability are updated by DISJOINT paths:
 * practice moves mastery (never stability), review moves stability (never
 * mastery). So an observed review outcome - which V12-M1 classifies as STRONG
 * evidence - contributes nothing to the ability estimate.
 *
 * These tests pin the shadow's job: quantify that gap without changing any
 * production write, and stay honest when there is no evidence at all.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REVIEW_SEMANTICS_MATRIX,
  replayUnifiedReviewMastery,
  reviewRetentionShadow,
  REVIEW_CONVERGENCE_EPSILON,
} from '../packages/shared/dist/index.js';

// ---------------------------------------------------------------------------
// The matrix is code, not prose: docs, endpoints and tests share one source.
// ---------------------------------------------------------------------------

test('the published matrix documents today\'s disjoint write paths', () => {
  const byAction = Object.fromEntries(REVIEW_SEMANTICS_MATRIX.map((row) => [row.action, row]));

  assert.equal(byAction['practice.answered'].changesMastery, true);
  assert.equal(
    byAction['practice.answered'].changesSchedule,
    false,
    'practice updates mastery only; it never touches the review schedule',
  );

  assert.equal(byAction['review.recalled'].changesSchedule, true);
  assert.equal(
    byAction['review.recalled'].changesMastery,
    false,
    'review updates the schedule only; the audit showed applyReview spreads mastery unchanged',
  );

  assert.equal(byAction['review.marked'].changesMastery, false);
  assert.equal(byAction['review.marked'].changesSchedule, false);
});

test('every matrix row explains its evidence and its effect', () => {
  for (const row of REVIEW_SEMANTICS_MATRIX) {
    assert.ok(row.basis.length > 0, `${row.action} must explain itself`);
    assert.ok(row.evidenceRef.length > 0, `${row.action} must cite its file:line evidence`);
  }
});

// ---------------------------------------------------------------------------
// Mastery replay: what reviews WOULD have contributed
// ---------------------------------------------------------------------------

const baseline = {
  nodeId: 'node-1',
  mastery: 0.5,
  accuracy: 0.55,
  recentAccuracy: 0.55,
  attempts: 4,
  correctCount: 2,
  wrongCount: 2,
  confidence: 0.3,
  at: '2026-09-01T00:00:00.000Z',
};

function observation(overrides = {}) {
  return {
    nodeId: 'node-1',
    questionId: 'q1',
    reviewedAt: '2026-09-02T00:00:00.000Z',
    redoCorrect: true,
    difficulty: 3,
    ...overrides,
  };
}

test('correct reviews that never reached mastery show the unification would raise it', () => {
  const result = replayUnifiedReviewMastery({
    observations: [
      observation({ reviewedAt: '2026-09-02T00:00:00.000Z' }),
      observation({ reviewedAt: '2026-09-03T00:00:00.000Z' }),
      observation({ reviewedAt: '2026-09-04T00:00:00.000Z' }),
    ],
    baselines: [baseline],
    stored: [{ nodeId: 'node-1', mastery: 0.5, stabilityDays: 1.7 }],
  });

  const row = result.rows[0];
  assert.equal(row.observations, 3);
  assert.equal(row.observedCorrect, 3);
  assert.equal(row.storedMastery, 0.5);
  assert.ok(row.replayMastery > 0.5, 'three observed correct recalls must raise the replay estimate');
  assert.equal(row.direction, 'unified_higher');
  assert.ok((row.delta ?? 0) > 0);
  assert.equal(result.summary.authoritative, false, 'shadow results are explicitly non-authoritative');
});

test('wrong reviews show the unification would lower it', () => {
  const result = replayUnifiedReviewMastery({
    observations: [
      observation({ redoCorrect: false }),
      observation({ redoCorrect: false, reviewedAt: '2026-09-03T00:00:00.000Z' }),
    ],
    baselines: [baseline],
    stored: [{ nodeId: 'node-1', mastery: 0.5, stabilityDays: 1.0 }],
  });

  const row = result.rows[0];
  assert.ok(row.replayMastery < 0.5);
  assert.equal(row.direction, 'unified_lower');
});

test('a node with no observations is insufficient data, never a zero', () => {
  const result = replayUnifiedReviewMastery({
    observations: [],
    baselines: [baseline],
    stored: [{ nodeId: 'node-1', mastery: 0.62, stabilityDays: 3 }],
  });

  const row = result.rows[0];
  assert.equal(row.observations, 0);
  assert.equal(row.replayMastery, null);
  assert.equal(row.delta, null);
  assert.equal(row.direction, 'insufficient_data');
  assert.match(row.basis, /无复习观测/);
});

test('a node with observations but no stored mastery reports the replay without inventing a delta', () => {
  const result = replayUnifiedReviewMastery({
    observations: [observation()],
    baselines: [],
    stored: [],
  });

  const row = result.rows[0];
  assert.ok(row.replayMastery != null, 'the replay itself is decidable');
  assert.equal(row.storedMastery, null, 'absence of a stored value stays absent');
  assert.equal(row.delta, null, 'no delta can be computed against a missing value');
  assert.match(row.basis, /无基线|中立/);
});

test('a replay that lands on the stored value is reported as converged, not as a change', () => {
  const replay = replayUnifiedReviewMastery({
    observations: [observation()],
    baselines: [baseline],
    stored: [{ nodeId: 'node-1', mastery: 0.5, stabilityDays: 1.7 }],
  });
  assert.ok(REVIEW_CONVERGENCE_EPSILON > 0);

  const stored = replay.rows[0].replayMastery;
  const converged = replayUnifiedReviewMastery({
    observations: [observation()],
    baselines: [baseline],
    stored: [{ nodeId: 'node-1', mastery: stored, stabilityDays: 1.7 }],
  });
  assert.equal(converged.rows[0].direction, 'converged');
  assert.equal(converged.rows[0].delta, 0);
});

test('the summary counts divergence directions and states the sample floor honestly', () => {
  const result = replayUnifiedReviewMastery({
    observations: [observation(), observation({ nodeId: 'node-2', questionId: 'q2' })],
    baselines: [baseline, { ...baseline, nodeId: 'node-2' }],
    stored: [
      { nodeId: 'node-1', mastery: 0.5, stabilityDays: 1.7 },
      { nodeId: 'node-2', mastery: 0.5, stabilityDays: 1.7 },
    ],
  });

  assert.equal(result.summary.nodesEvaluated, 2);
  assert.equal(result.summary.unifiedHigher, 2);
  assert.equal(result.summary.unifiedLower, 0);
  assert.equal(result.summary.converged, 0);
  assert.ok(typeof result.summary.basis === 'string' && result.summary.basis.length > 0);
});

// ---------------------------------------------------------------------------
// Retention honesty: the stored value is a constant claim
// ---------------------------------------------------------------------------

test('stored retention of exactly 1 is exposed as a constant, not a measurement', () => {
  const shadow = reviewRetentionShadow({
    rows: [
      {
        nodeId: 'node-1',
        stabilityDays: 2,
        storedRetention: 1,
        lastReviewedAt: '2026-09-01T00:00:00.000Z',
        asOf: '2026-09-10T00:00:00.000Z',
      },
    ],
  });

  const row = shadow.rows[0];
  assert.equal(row.storedRetention, 1);
  assert.ok(row.computedRetention != null && row.computedRetention < 1, '9 days past a 2-day stability is not perfect recall');
  assert.ok((row.gap ?? 0) > 0);
  assert.equal(row.verdict, 'stored_optimistic');
  assert.equal(shadow.summary.authoritative, false);
});

test('a freshly reviewed node has a genuine retention of 1 and shows no gap', () => {
  const shadow = reviewRetentionShadow({
    rows: [
      {
        nodeId: 'node-1',
        stabilityDays: 2,
        storedRetention: 1,
        lastReviewedAt: '2026-09-10T00:00:00.000Z',
        asOf: '2026-09-10T00:00:00.000Z',
      },
    ],
  });
  assert.equal(shadow.rows[0].computedRetention, 1);
  assert.equal(shadow.rows[0].verdict, 'consistent');
});

test('retention is unknown, not zero, when stability or timestamps are missing', () => {
  const shadow = reviewRetentionShadow({
    rows: [
      { nodeId: 'node-1', stabilityDays: null, storedRetention: 1, lastReviewedAt: '2026-09-01T00:00:00.000Z', asOf: '2026-09-10T00:00:00.000Z' },
      { nodeId: 'node-2', stabilityDays: 2, storedRetention: null, lastReviewedAt: null, asOf: '2026-09-10T00:00:00.000Z' },
    ],
  });

  assert.equal(shadow.rows[0].computedRetention, null);
  assert.equal(shadow.rows[0].verdict, 'unknown');
  assert.equal(shadow.rows[1].computedRetention, null);
  assert.equal(shadow.rows[1].verdict, 'unknown');
  assert.equal(shadow.summary.rowsEvaluated, 2);
  assert.equal(shadow.summary.storedOptimistic, 0, 'unknown rows are never counted as divergence');
});

test('empty input yields an honest empty shadow', () => {
  const replay = replayUnifiedReviewMastery({ observations: [], baselines: [], stored: [] });
  assert.equal(replay.rows.length, 0);
  assert.equal(replay.summary.nodesEvaluated, 0);

  const shadow = reviewRetentionShadow({ rows: [] });
  assert.equal(shadow.rows.length, 0);
  assert.equal(shadow.summary.rowsEvaluated, 0);
});
