// V13 / PHASE 5 — Training Prescription contract tests.
//
// Prescription turns a DiagnosticFinding into an executable ladder:
//   basic → same_type → variant → review(24h) → retest(3d)
// All parameters derive from evidence (mastery/recentAccuracy/retention,
// finding severity) and REAL content availability — never hardcoded the same
// for every student, never promising questions that do not exist.
//
// Invariants pinned here:
//   • no finding → no prescription (EMPTY, zero ladder)
//   • difficulty anchors on mastery/recentAccuracy (low → basic start)
//   • severity (repeated / observed loss / high count) raises volume, bounded
//   • content scarcity adjusts counts down and flags limitedByContent
//   • zero matching content → NO_CONTENT, no fabricated counts
//   • variant capability absent → explicit UNAVAILABLE with reason (not dropped)
//   • review/retest days come from the real review-interval constants
//   • pure: no mastery/prediction input is mutated; deterministic output

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTrainingPrescription } from '../packages/shared/dist/index.js';

function finding(overrides = {}) {
  return {
    subject: 'OS',
    nodeId: 'node-pv',
    questionSubtype: 'OS_PV',
    reasonCode: 'calculation_error',
    reasonLabel: '计算错误',
    count: 2,
    recentCount: 1,
    trend: 'no_data',
    repeated: false,
    observedLostScore: 0,
    proxyLostScore: 0,
    confidence: 'low',
    ...overrides,
  };
}

function build(overrides = {}) {
  return buildTrainingPrescription({
    now: '2023-11-14T22:13:20.000Z',
    windowDays: 7,
    finding: finding(),
    masteryState: { mastery: 0.6, recentAccuracy: 0.6, retention: null, attempts: 4 },
    available: { basic: 10, medium: 10, hard: 5, sameSubtype: 8 },
    variantAvailable: true,
    reviewIntervalDays: [1, 3, 7, 14],
    ...overrides,
  });
}

test('P5 prescription: empty finding → EMPTY with zero ladder (no fabrication)', () => {
  const result = build({ finding: null });
  assert.equal(result.dataStatus, 'EMPTY');
  assert.deepEqual(result.ladder, []);
  assert.equal(result.target, null);
});

test('P5 prescription: low mastery anchors the ladder at BASIC; strong mastery moves the start up', () => {
  const lowMastery = build({ masteryState: { mastery: 0.3, recentAccuracy: 0.4, retention: null, attempts: 5 } });
  const basicStep = lowMastery.ladder.find((step) => step.stage === 'basic');
  assert.equal(basicStep.difficulty, 'BASIC');
  assert.equal(lowMastery.difficultyAnchor, 'BASIC');

  const strong = build({ masteryState: { mastery: 0.85, recentAccuracy: 0.9, retention: 0.8, attempts: 20 } });
  assert.equal(strong.difficultyAnchor, 'MEDIUM', 'strong mastery starts at MEDIUM (never BASIC grind)');

  const unknown = build({ masteryState: null });
  assert.equal(unknown.difficultyAnchor, 'BASIC', 'unknown state → conservative BASIC, stated honestly');
});

test('P5 prescription: severity raises volume within bounds (repeated / observed loss / high count)', () => {
  const mild = build({ finding: finding({ count: 2 }), masteryState: { mastery: 0.6, recentAccuracy: 0.6, retention: null, attempts: 4 } });
  const severe = build({
    finding: finding({ count: 6, repeated: true, observedLostScore: 8, confidence: 'high' }),
    masteryState: { mastery: 0.4, recentAccuracy: 0.4, retention: null, attempts: 8 },
  });
  const mildTotal = mild.ladder.filter((s) => s.stage === 'basic' || s.stage === 'same_type').reduce((sum, s) => sum + s.questionCount, 0);
  const severeTotal = severe.ladder.filter((s) => s.stage === 'basic' || s.stage === 'same_type').reduce((sum, s) => sum + s.questionCount, 0);
  assert.ok(severeTotal > mildTotal, `severe (${severeTotal}) must exceed mild (${mildTotal})`);
  assert.ok(severeTotal <= 10, 'volume stays bounded');
  assert.match(severe.reason, /重复出现/);
  assert.match(severe.reason, /失 8 分/);
});

test('P5 prescription: content scarcity adjusts counts and flags limitedByContent; zero content → NO_CONTENT', () => {
  const scarce = build({ available: { basic: 1, medium: 1, hard: 0, sameSubtype: 0 } });
  const basic = scarce.ladder.find((s) => s.stage === 'basic');
  assert.equal(basic.questionCount, 2, 'count clamped to real availability (1 basic + 1 medium)');
  assert.equal(basic.limitedByContent, true);
  const sameType = scarce.ladder.find((s) => s.stage === 'same_type');
  assert.equal(sameType.status, 'NO_CONTENT');
  assert.equal(sameType.questionCount, 0, 'no invented questions');
  assert.equal(scarce.dataStatus, 'LIMITED_CONTENT');

  const barren = build({ available: { basic: 0, medium: 0, hard: 0, sameSubtype: 0 } });
  assert.equal(barren.dataStatus, 'NO_CONTENT');
  assert.ok(barren.ladder.every((step) => step.stage === 'review' || step.stage === 'retest' || step.questionCount === 0));
});

test('P5 prescription: variant capability absent → explicit UNAVAILABLE step with reason (never silently dropped)', () => {
  const withVariant = build({ variantAvailable: true });
  const withoutVariant = build({ variantAvailable: false });
  const v1 = withVariant.ladder.find((s) => s.stage === 'variant');
  const v2 = withoutVariant.ladder.find((s) => s.stage === 'variant');
  assert.equal(v1.status, 'READY');
  assert.equal(v2.status, 'UNAVAILABLE');
  assert.ok(v2.reason && v2.reason.length > 0, 'unavailability states why');
  assert.equal(v2.questionCount, 0);
});

test('P5 prescription: review/retest timings come from the real review-interval constants', () => {
  const result = build({ reviewIntervalDays: [1, 3, 7, 14] });
  const review = result.ladder.find((s) => s.stage === 'review');
  const retest = result.ladder.find((s) => s.stage === 'retest');
  assert.equal(review.dueInDays, 1, '24h review = first interval');
  assert.equal(retest.dueInDays, 3, '3d retest = second interval');
  const custom = build({ reviewIntervalDays: [2, 5] });
  assert.equal(custom.ladder.find((s) => s.stage === 'review').dueInDays, 2);
  assert.equal(custom.ladder.find((s) => s.stage === 'retest').dueInDays, 5);
});

test('P5 prescription: retention risk adds an explicit review-emphasis flag; determinism holds', () => {
  const risky = build({ masteryState: { mastery: 0.7, recentAccuracy: 0.8, retention: 0.35, attempts: 10 } });
  assert.equal(risky.reviewEmphasis, true, 'low retention emphasises review');
  const safe = build({ masteryState: { mastery: 0.7, recentAccuracy: 0.8, retention: 0.9, attempts: 10 } });
  assert.equal(safe.reviewEmphasis, false);

  const a = build({ finding: finding({ count: 3, repeated: true }) });
  const b = build({ finding: finding({ count: 3, repeated: true }) });
  assert.deepEqual(a, b, 'same inputs → identical prescription (deterministic)');
});

test('P5 prescription: unknown subtype/reason labels surface honestly (no guessing)', () => {
  const unknown = build({
    finding: finding({ questionSubtype: 'unknown', questionSubtypeLabel: '未知题型', reasonCode: 'unclassified', reasonLabel: '待归因' }),
  });
  assert.equal(unknown.target.questionSubtype, 'unknown');
  assert.equal(unknown.target.reasonCode, 'unclassified');
  assert.equal(unknown.target.questionSubtypeLabel, '未知题型');
});
