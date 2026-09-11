/**
 * S1 Score Anchor — pure domain contract (RED first).
 *
 * Covers the four invariants the S1 mission pins down:
 *   1. scale normalization never loses the raw scale and never guesses
 *   2. provenance decides what may enter a strict calibration anchor
 *   3. calibration pairs are only computed when scale/semantic/provenance/time
 *      are ALL compatible — the 150-vs-100 mismatch becomes inexpressible
 *   4. the E1 gate is per provenance group, never mixed, with strict
 *      boundaries (n = 5 passes, median = 15 fails)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCORE_NORMALIZED_TOTAL_SCALE,
  SCORE_EVIDENCE_GATES,
  normalizeScore,
  validateScoreEvidence,
  calibrationLayerOf,
  isCalibrationCompatible,
  calculateCalibrationError,
  evaluateCalibrationGate,
  deriveCalibrationEvidenceStatus,
  resolveCorrectedEvidence,
} from '../packages/shared/dist/index.js';

// ---------------------------------------------------------------------------
// Scale normalization
// ---------------------------------------------------------------------------

test('normalized total scale is the published 150 constant', () => {
  assert.equal(SCORE_NORMALIZED_TOTAL_SCALE, 150);
});

test('normalizeScore maps the documented scales onto 150', () => {
  assert.equal(normalizeScore(100, 100).normalized, 150);
  assert.equal(normalizeScore(60, 100).normalized, 90);
  assert.equal(normalizeScore(120, 120).normalized, 150);
  assert.equal(normalizeScore(0, 100).normalized, 0);
  assert.equal(normalizeScore(150, 150).normalized, 150);
  assert.equal(normalizeScore(72, 80).normalized, 135);
});

test('normalizeScore keeps one decimal precision for fractional points', () => {
  const result = normalizeScore(2.5, 100);
  assert.equal(result.normalized, 3.8, '2.5/100*150 = 3.75 -> round1 -> 3.8');
});

test('normalizeScore rejects missing or non-positive total scale instead of guessing', () => {
  assert.equal(normalizeScore(90, null).ok, false);
  assert.equal(normalizeScore(90, null).reject, 'missing_total_score');
  assert.equal(normalizeScore(90, 0).reject, 'invalid_total_score');
  assert.equal(normalizeScore(90, -5).reject, 'invalid_total_score');
  assert.equal(normalizeScore(null, 100).normalized, null, 'null score is a valid absent state, not zero');
  assert.equal(normalizeScore(null, 100).ok, false, 'but it cannot produce a normalized value');
  assert.equal(normalizeScore(null, 100).reject, 'missing_score_value');
});

test('normalizeScore rejects out-of-range and non-finite scores', () => {
  assert.equal(normalizeScore(101, 100).reject, 'invalid_score_range');
  assert.equal(normalizeScore(-1, 100).reject, 'invalid_score_range');
  assert.equal(normalizeScore(Number.NaN, 100).reject, 'invalid_score_value');
  assert.equal(normalizeScore(Number.POSITIVE_INFINITY, 100).reject, 'invalid_score_value');
});

test('validateScoreEvidence enforces the source and semantic enums', () => {
  assert.equal(validateScoreEvidence({ rawScore: 96, rawTotalScale: 150, source: 'TEACHER_GRADED', semantic: 'exam_total' }).ok, true);
  assert.equal(validateScoreEvidence({ rawScore: 96, rawTotalScale: 150, source: 'not_a_source', semantic: 'exam_total' }).reject, 'invalid_source');
  assert.equal(validateScoreEvidence({ rawScore: 96, rawTotalScale: 150, source: 'TEACHER_GRADED', semantic: 'percentage' }).reject, 'invalid_semantic');
  assert.equal(validateScoreEvidence({ rawScore: 96, rawTotalScale: 150, source: 'UNKNOWN', semantic: 'exam_total' }).ok, true, 'UNKNOWN is a legal explicit value');
  assert.equal(validateScoreEvidence({ rawScore: 96, rawTotalScale: 0, source: 'MOCK', semantic: 'accuracy_rate' }).reject, 'invalid_total_score');
});

// ---------------------------------------------------------------------------
// Provenance layers
// ---------------------------------------------------------------------------

test('calibration layers split primary evidence from proxy evidence', () => {
  assert.equal(calibrationLayerOf('TEACHER_GRADED'), 'primary');
  assert.equal(calibrationLayerOf('REAL_EXAM'), 'primary');
  assert.equal(calibrationLayerOf('RUBRIC_GRADED'), 'primary');
  assert.equal(calibrationLayerOf('MOCK'), 'proxy');
  assert.equal(calibrationLayerOf('DIAGNOSTIC'), 'proxy');
  assert.equal(calibrationLayerOf('IMPORTED'), 'proxy');
  assert.equal(calibrationLayerOf('UNKNOWN'), null, 'UNKNOWN never enters any calibration');
});

// ---------------------------------------------------------------------------
// Calibration compatibility
// ---------------------------------------------------------------------------

function prediction(overrides = {}) {
  return {
    predictedScore: 100,
    predictedMinScore: 90,
    predictedMaxScore: 110,
    semantic: 'exam_total',
    generatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function evidence(overrides = {}) {
  return {
    normalizedScore: 96,
    normalizedTotalScale: 150,
    semantic: 'exam_total',
    source: 'TEACHER_GRADED',
    occurredAt: '2026-09-10T00:00:00.000Z',
    ...overrides,
  };
}

test('a prediction and an exam-total outcome on the same scale are compatible', () => {
  const verdict = isCalibrationCompatible(prediction(), evidence());
  assert.equal(verdict.compatible, true);
  assert.deepEqual(verdict.reasons, []);
});

test('an accuracy-rate assessment can never pair with an exam-total prediction', () => {
  const verdict = isCalibrationCompatible(prediction(), evidence({ semantic: 'accuracy_rate' }));
  assert.equal(verdict.compatible, false);
  assert.ok(verdict.reasons.includes('semantic_mismatch'));
});

test('a differently-scaled evidence is incompatible even when numerically tempting', () => {
  const verdict = isCalibrationCompatible(prediction(), evidence({ normalizedTotalScale: 100 }));
  assert.equal(verdict.compatible, false);
  assert.ok(verdict.reasons.includes('scale_mismatch'));
});

test('unknown provenance is never calibratable', () => {
  const verdict = isCalibrationCompatible(prediction(), evidence({ source: 'UNKNOWN' }));
  assert.equal(verdict.compatible, false);
  assert.ok(verdict.reasons.includes('provenance_unknown'));
});

test('an outcome that predates the prediction is time-incompatible', () => {
  const verdict = isCalibrationCompatible(prediction(), evidence({ occurredAt: '2026-08-01T00:00:00.000Z' }));
  assert.equal(verdict.compatible, false);
  assert.ok(verdict.reasons.includes('prediction_after_outcome'));
});

test('unknown evidence time is excluded rather than assumed', () => {
  const verdict = isCalibrationCompatible(prediction(), evidence({ occurredAt: null }));
  assert.equal(verdict.compatible, false);
  assert.ok(verdict.reasons.includes('evidence_time_unknown'));
});

// ---------------------------------------------------------------------------
// Calibration error
// ---------------------------------------------------------------------------

test('calculateCalibrationError keeps the actual-minus-predicted sign convention', () => {
  const over = calculateCalibrationError(prediction(), evidence({ normalizedScore: 96 }));
  assert.equal(over.ok, true);
  assert.equal(over.error, -4);
  assert.equal(over.absoluteError, 4);
  assert.equal(over.withinRange, true);

  const under = calculateCalibrationError(prediction(), evidence({ normalizedScore: 130 }));
  assert.equal(under.error, 30);
  assert.equal(under.direction ?? null, null, 'direction lives in the legacy projection, not the anchor primitive');
});

test('calculateCalibrationError refuses to compute an error for incompatible pairs', () => {
  const result = calculateCalibrationError(prediction(), evidence({ semantic: 'accuracy_rate', normalizedScore: 96 }));
  assert.equal(result.ok, false);
  assert.equal(result.error, null);
  assert.ok(result.reason.includes('semantic_mismatch'));
});

// ---------------------------------------------------------------------------
// E1 gate — per provenance group, strict boundaries
// ---------------------------------------------------------------------------

test('the gate constants are the preregistered values', () => {
  assert.deepEqual(SCORE_EVIDENCE_GATES, { minSampleSize: 5, maxMedianAbsoluteError: 15 });
});

function gateEntries(source, errors) {
  return errors.map((absoluteError, index) => ({
    source,
    absoluteError,
    withinRange: true,
    key: `${source}-${index}`,
  }));
}

test('n below the minimum fails the gate even with perfect accuracy', () => {
  const gates = evaluateCalibrationGate(gateEntries('TEACHER_GRADED', [1, 1, 1, 1]));
  assert.equal(gates.length, 1);
  assert.equal(gates[0].n, 4);
  assert.equal(gates[0].gate.pass, false);
  assert.ok(gates[0].gate.reasons.some((reason) => reason.includes('n=4')));
});

test('n exactly at the minimum can enter the gate computation', () => {
  const gates = evaluateCalibrationGate(gateEntries('TEACHER_GRADED', [10, 10, 10, 10, 10]));
  assert.equal(gates[0].n, 5);
  assert.equal(gates[0].medianAbsoluteError, 10);
  assert.equal(gates[0].gate.pass, true);
});

test('median exactly at the threshold fails — the gate is strict', () => {
  const gates = evaluateCalibrationGate(gateEntries('REAL_EXAM', [10, 15, 20, 5, 15]));
  assert.equal(gates[0].n, 5);
  assert.equal(gates[0].medianAbsoluteError, 15);
  assert.equal(gates[0].gate.pass, false);
});

test('median above the threshold fails', () => {
  const gates = evaluateCalibrationGate(gateEntries('REAL_EXAM', [10, 20, 30, 5, 15]));
  assert.equal(gates[0].medianAbsoluteError, 15, 'sorted [5,10,15,20,30] median is 15');
  const failing = evaluateCalibrationGate(gateEntries('REAL_EXAM', [16, 16, 16, 16, 16]));
  assert.equal(failing[0].medianAbsoluteError, 16);
  assert.equal(failing[0].gate.pass, false);
});

test('even counts take the mean of the two middle values', () => {
  const gates = evaluateCalibrationGate(gateEntries('TEACHER_GRADED', [10, 10, 10, 12, 12, 14]));
  assert.equal(gates[0].medianAbsoluteError, 11, 'sorted [10,10,10,12,12,14] middle pair (10,12) -> 11');
});

test('mixed provenance is never merged into one gate', () => {
  const gates = evaluateCalibrationGate([
    ...gateEntries('TEACHER_GRADED', [1, 1, 1, 1]),
    ...gateEntries('IMPORTED', [1, 1, 1, 1]),
  ]);
  assert.equal(gates.length, 2, 'two separate groups, not one n=8 group');
  assert.ok(gates.every((entry) => entry.gate.pass === false), 'n=4 per group fails — merging would have faked a pass');
  assert.deepEqual(gates.map((entry) => entry.source).sort(), ['IMPORTED', 'TEACHER_GRADED']);
});

test('gate entries carry MAE, bias and range coverage', () => {
  const entries = [
    { source: 'REAL_EXAM', absoluteError: 10, withinRange: true, key: 'a' },
    { source: 'REAL_EXAM', absoluteError: 30, withinRange: false, key: 'b' },
    { source: 'REAL_EXAM', absoluteError: 20, withinRange: true, key: 'c' },
    { source: 'REAL_EXAM', absoluteError: 10, withinRange: true, key: 'd' },
    { source: 'REAL_EXAM', absoluteError: 10, withinRange: true, key: 'e' },
  ];
  const gates = evaluateCalibrationGate(entries);
  assert.equal(gates[0].meanAbsoluteError, 16);
  assert.equal(gates[0].rangeCoverage, 0.8);
  assert.equal(gates[0].n, 5);
});

// ---------------------------------------------------------------------------
// Calibration evidence status (student-facing, honest)
// ---------------------------------------------------------------------------

test('status derivation maps gate states onto the four honest states', () => {
  assert.equal(deriveCalibrationEvidenceStatus([]), 'not_started');
  assert.equal(
    deriveCalibrationEvidenceStatus([{ source: 'MOCK', n: 2, gate: { pass: false, reasons: ['n=2'] } }]),
    'insufficient_evidence',
  );
  assert.equal(
    deriveCalibrationEvidenceStatus([{ source: 'MOCK', n: 5, gate: { pass: false, reasons: ['median=18'] } }]),
    'preliminary',
    'measured but off — numbers exist, gate not passed',
  );
  assert.equal(
    deriveCalibrationEvidenceStatus([
      { source: 'MOCK', n: 5, gate: { pass: false, reasons: ['median=18'] } },
      { source: 'TEACHER_GRADED', n: 6, gate: { pass: true, reasons: [] } },
    ]),
    'gate_passed',
  );
});

// ---------------------------------------------------------------------------
// Corrections — append-only chain resolution
// ---------------------------------------------------------------------------

test('resolveCorrectedEvidence applies corrections in order without mutating history', () => {
  const original = Object.freeze({
    id: 'a1',
    rawScore: 90,
    rawTotalScale: 150,
    normalizedScore: 90,
    examDate: '2026-08-01',
  });
  const corrections = [
    { targetId: 'a1', correctedFields: { rawScore: 95, normalizedScore: 95 }, correctedAt: '2026-09-02T00:00:00.000Z' },
    { targetId: 'a1', correctedFields: { rawScore: 97, normalizedScore: 97 }, correctedAt: '2026-09-03T00:00:00.000Z' },
  ];

  const resolved = resolveCorrectedEvidence(original, corrections);

  assert.equal(resolved.corrected, true);
  assert.equal(resolved.correctionCount, 2);
  assert.equal(resolved.effective.rawScore, 97, 'latest correction wins');
  assert.equal(resolved.effective.rawTotalScale, 150, 'fields not corrected stay as recorded');
  assert.equal(original.rawScore, 90, 'the original evidence object is never mutated');
});

test('resolveCorrectedEvidence with no corrections is a passthrough', () => {
  const original = { id: 'a1', rawScore: 90 };
  const resolved = resolveCorrectedEvidence(original, []);
  assert.equal(resolved.corrected, false);
  assert.equal(resolved.correctionCount, 0);
  assert.equal(resolved.effective.rawScore, 90);
});
