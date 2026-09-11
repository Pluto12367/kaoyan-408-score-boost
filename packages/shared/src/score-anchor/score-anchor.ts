/**
 * S1 Score Anchor — pure domain primitives.
 *
 * The Score Ledger records THREE structurally separate kinds of score
 * evidence (Prediction / Assessment / Outcome — separate tables, separate
 * write paths). This module owns the invariants that make those rows
 * comparable when — and only when — they deserve to be:
 *
 *   1. normalizeScore    raw scale → 150, never guessing a missing total
 *   2. validateScoreEvidence  enum + numeric guards at the boundary
 *   3. calibrationLayerOf     provenance decides the trust stratum
 *   4. isCalibrationCompatible  scale + semantic + provenance + time
 *   5. calculateCalibrationError  only for compatible pairs (sign: actual − predicted)
 *   6. evaluateCalibrationGate  the preregistered E1 gate, per provenance group
 *   7. deriveCalibrationEvidenceStatus  the four honest student-facing states
 *   8. resolveCorrectedEvidence  append-only correction chain resolution
 *
 * Pure: no IO, no clock, no randomness. Times arrive as ISO strings.
 */

export const SCORE_NORMALIZED_TOTAL_SCALE = 150;

/** Where a score came from. UNKNOWN is an explicit value with hard consequences. */
export type ScoreSource =
  | 'MOCK'
  | 'DIAGNOSTIC'
  | 'TEACHER_GRADED'
  | 'RUBRIC_GRADED'
  | 'REAL_EXAM'
  | 'IMPORTED'
  | 'UNKNOWN';

export const SCORE_SOURCES: readonly ScoreSource[] = [
  'MOCK',
  'DIAGNOSTIC',
  'TEACHER_GRADED',
  'RUBRIC_GRADED',
  'REAL_EXAM',
  'IMPORTED',
  'UNKNOWN',
];

/** What the number means. An accuracy percentage is never an exam total. */
export type ScoreSemantic = 'exam_total' | 'accuracy_rate';

export const SCORE_SEMANTICS: readonly ScoreSemantic[] = ['exam_total', 'accuracy_rate'];

/** The preregistered E1 gate (S1 implementation plan §10). */
export const SCORE_EVIDENCE_GATES = {
  minSampleSize: 5,
  maxMedianAbsoluteError: 15,
} as const;

export type CalibrationLayer = 'primary' | 'proxy';

const PRIMARY_SOURCES: ReadonlySet<ScoreSource> = new Set<ScoreSource>([
  'TEACHER_GRADED',
  'RUBRIC_GRADED',
  'REAL_EXAM',
]);
const PROXY_SOURCES: ReadonlySet<ScoreSource> = new Set<ScoreSource>([
  'MOCK',
  'DIAGNOSTIC',
  'IMPORTED',
]);

export function calibrationLayerOf(source: ScoreSource): CalibrationLayer | null {
  if (PRIMARY_SOURCES.has(source)) return 'primary';
  if (PROXY_SOURCES.has(source)) return 'proxy';
  return null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

// ---------------------------------------------------------------------------
// 1. Scale normalization
// ---------------------------------------------------------------------------

export interface ScoreNormalizationResult {
  readonly ok: boolean;
  /** 150-scale, 1 decimal. null when the raw score itself is absent or rejected. */
  readonly normalized: number | null;
  readonly normalizedTotalScale: number | null;
  readonly reject:
    | 'missing_total_score'
    | 'invalid_total_score'
    | 'missing_score_value'
    | 'invalid_score_value'
    | 'invalid_score_range'
    | null;
}

export function normalizeScore(
  rawScore: number | null | undefined,
  rawTotalScale: number | null | undefined,
): ScoreNormalizationResult {
  if (!isFiniteNumber(rawTotalScale) || rawTotalScale <= 0) {
    return {
      ok: false,
      normalized: null,
      normalizedTotalScale: null,
      reject: rawTotalScale == null ? 'missing_total_score' : 'invalid_total_score',
    };
  }
  if (rawScore == null) {
    return { ok: false, normalized: null, normalizedTotalScale: null, reject: 'missing_score_value' };
  }
  if (!isFiniteNumber(rawScore)) {
    return { ok: false, normalized: null, normalizedTotalScale: null, reject: 'invalid_score_value' };
  }
  if (rawScore < 0 || rawScore > rawTotalScale) {
    return { ok: false, normalized: null, normalizedTotalScale: null, reject: 'invalid_score_range' };
  }
  return {
    ok: true,
    normalized: round1((rawScore / rawTotalScale) * SCORE_NORMALIZED_TOTAL_SCALE),
    normalizedTotalScale: SCORE_NORMALIZED_TOTAL_SCALE,
    reject: null,
  };
}

// ---------------------------------------------------------------------------
// 2. Evidence validation
// ---------------------------------------------------------------------------

export interface ScoreEvidenceValidationInput {
  readonly rawScore: unknown;
  readonly rawTotalScale: unknown;
  readonly source: unknown;
  readonly semantic: unknown;
}

export interface ScoreEvidenceValidationResult {
  readonly ok: boolean;
  readonly reject:
    | 'missing_total_score'
    | 'invalid_total_score'
    | 'invalid_score_value'
    | 'invalid_score_range'
    | 'invalid_source'
    | 'invalid_semantic'
    | null;
}

/**
 * Boundary guard for every ledger write. Note the deliberate asymmetry with
 * normalizeScore: a null rawScore is allowed here (an evidence row may record
 * provenance and metadata without a usable score), but a missing total scale
 * never is — "score / what?" cannot be reasoned about later.
 */
export function validateScoreEvidence(input: ScoreEvidenceValidationInput): ScoreEvidenceValidationResult {
  if (input.rawTotalScale == null) return { ok: false, reject: 'missing_total_score' };
  if (!isFiniteNumber(input.rawTotalScale) || input.rawTotalScale <= 0) {
    return { ok: false, reject: 'invalid_total_score' };
  }
  if (input.rawScore != null) {
    if (!isFiniteNumber(input.rawScore)) return { ok: false, reject: 'invalid_score_value' };
    if (input.rawScore < 0 || input.rawScore > (input.rawTotalScale as number)) {
      return { ok: false, reject: 'invalid_score_range' };
    }
  }
  if (input.source != null && !(SCORE_SOURCES as readonly string[]).includes(input.source as string)) {
    return { ok: false, reject: 'invalid_source' };
  }
  if (input.semantic != null && !(SCORE_SEMANTICS as readonly string[]).includes(input.semantic as string)) {
    return { ok: false, reject: 'invalid_semantic' };
  }
  return { ok: true, reject: null };
}

// ---------------------------------------------------------------------------
// 3–5. Calibration compatibility and error
// ---------------------------------------------------------------------------

export interface CalibrationPredictionRef {
  readonly predictedScore: number;
  readonly predictedMinScore?: number | null;
  readonly predictedMaxScore?: number | null;
  /** Predictions are exam totals; the field exists so callers cannot quietly assume. */
  readonly semantic: ScoreSemantic;
  readonly generatedAt?: string | null;
}

export interface CalibrationEvidenceRef {
  readonly normalizedScore: number;
  readonly normalizedTotalScale: number;
  readonly semantic: ScoreSemantic;
  readonly source: ScoreSource;
  readonly occurredAt?: string | null;
}

export interface CompatibilityVerdict {
  readonly compatible: boolean;
  readonly reasons: readonly string[];
}

export function isCalibrationCompatible(
  prediction: CalibrationPredictionRef,
  evidence: CalibrationEvidenceRef,
): CompatibilityVerdict {
  const reasons: string[] = [];
  if (evidence.normalizedTotalScale !== SCORE_NORMALIZED_TOTAL_SCALE) {
    reasons.push('scale_mismatch');
  }
  if (prediction.semantic !== evidence.semantic) {
    reasons.push('semantic_mismatch');
  }
  if (evidence.source === 'UNKNOWN' || calibrationLayerOf(evidence.source) == null) {
    reasons.push('provenance_unknown');
  }
  if (evidence.occurredAt == null) {
    reasons.push('evidence_time_unknown');
  } else if (prediction.generatedAt != null && evidence.occurredAt < prediction.generatedAt) {
    reasons.push('prediction_after_outcome');
  }
  return { compatible: reasons.length === 0, reasons };
}

export interface CalibrationErrorResult {
  readonly ok: boolean;
  /** evidence − prediction; positive means the student scored above the estimate. */
  readonly error: number | null;
  readonly absoluteError: number | null;
  readonly withinRange: boolean | null;
  readonly reason: string | null;
}

export function calculateCalibrationError(
  prediction: CalibrationPredictionRef,
  evidence: CalibrationEvidenceRef,
): CalibrationErrorResult {
  const verdict = isCalibrationCompatible(prediction, evidence);
  if (!verdict.compatible) {
    return { ok: false, error: null, absoluteError: null, withinRange: null, reason: verdict.reasons.join(',') };
  }
  const error = round2(evidence.normalizedScore - prediction.predictedScore);
  const withinRange =
    prediction.predictedMinScore != null && prediction.predictedMaxScore != null
      ? evidence.normalizedScore >= (prediction.predictedMinScore as number)
        && evidence.normalizedScore <= (prediction.predictedMaxScore as number)
      : null;
  return { ok: true, error, absoluteError: Math.abs(error), withinRange, reason: null };
}

// ---------------------------------------------------------------------------
// 6. The E1 gate — strictly per provenance group
// ---------------------------------------------------------------------------

export interface CalibrationPairObservation {
  /** Stable pair identity (for callers that dedupe). */
  readonly key: string;
  readonly source: ScoreSource;
  readonly absoluteError: number;
  /** Signed error (evidence − prediction); absoluteError is used when absent. */
  readonly error?: number;
  readonly withinRange: boolean | null;
}

export interface CalibrationGateEntry {
  readonly source: ScoreSource;
  readonly layer: CalibrationLayer;
  readonly n: number;
  readonly meanAbsoluteError: number | null;
  readonly bias: number | null;
  readonly medianAbsoluteError: number | null;
  /** Fraction of pairs whose actual fell inside the predicted interval. */
  readonly rangeCoverage: number | null;
  readonly gate: { readonly pass: boolean; readonly reasons: readonly string[] };
}

function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function evaluateCalibrationGate(observations: readonly CalibrationPairObservation[]): CalibrationGateEntry[] {
  const bySource = new Map<ScoreSource, CalibrationPairObservation[]>();
  for (const observation of observations) {
    const list = bySource.get(observation.source) ?? [];
    list.push(observation);
    bySource.set(observation.source, list);
  }

  const entries: CalibrationGateEntry[] = [];
  for (const [source, list] of bySource) {
    const layer = calibrationLayerOf(source) ?? 'proxy';
    const n = list.length;
    const errors = list.map((row) => row.absoluteError);
    const signedErrors = list.map((row) => row.error ?? row.absoluteError);
    const meanAbsoluteError = round2(errors.reduce((sum, value) => sum + value, 0) / n);
    const bias = round2(signedErrors.reduce((sum, value) => sum + value, 0) / n);
    const medianAbsoluteError = round2(medianOf(errors));
    const rangeKnown = list.filter((row) => row.withinRange != null);
    const rangeCoverage = rangeKnown.length > 0
      ? round2(rangeKnown.filter((row) => row.withinRange === true).length / rangeKnown.length)
      : null;

    const reasons: string[] = [];
    if (n < SCORE_EVIDENCE_GATES.minSampleSize) {
      reasons.push(`n=${n} < ${SCORE_EVIDENCE_GATES.minSampleSize}`);
    }
    if (medianAbsoluteError >= SCORE_EVIDENCE_GATES.maxMedianAbsoluteError) {
      reasons.push(`median_abs_error=${medianAbsoluteError} >= ${SCORE_EVIDENCE_GATES.maxMedianAbsoluteError}`);
    }

    entries.push({
      source,
      layer,
      n,
      meanAbsoluteError,
      bias,
      medianAbsoluteError,
      rangeCoverage,
      gate: { pass: reasons.length === 0, reasons },
    });
  }
  return entries.sort((left, right) => left.source.localeCompare(right.source));
}

// ---------------------------------------------------------------------------
// 7. Student-facing calibration status — four honest states
// ---------------------------------------------------------------------------

export type CalibrationEvidenceStatus = 'not_started' | 'insufficient_evidence' | 'preliminary' | 'gate_passed';

export function deriveCalibrationEvidenceStatus(
  gates: ReadonlyArray<Pick<CalibrationGateEntry, 'n' | 'gate'>>,
): CalibrationEvidenceStatus {
  if (gates.length === 0 || gates.every((entry) => entry.n === 0)) return 'not_started';
  if (gates.some((entry) => entry.gate.pass)) return 'gate_passed';
  if (gates.some((entry) => entry.n >= SCORE_EVIDENCE_GATES.minSampleSize)) return 'preliminary';
  return 'insufficient_evidence';
}

// ---------------------------------------------------------------------------
// 8. Append-only correction chain
// ---------------------------------------------------------------------------

export interface ScoreCorrectionRecord {
  readonly targetId: string;
  readonly correctedFields: Readonly<Record<string, unknown>>;
  readonly correctedAt: string;
}

export interface ResolvedEvidence<T> {
  readonly effective: T;
  readonly corrected: boolean;
  readonly correctionCount: number;
}

/**
 * Fold a correction chain onto an immutable evidence row. The input row and
 * every correction record are treated as read-only facts; the effective view
 * is derived, never written back. Later corrections win; fields a correction
 * does not mention stay as previously resolved.
 */
export function resolveCorrectedEvidence<T extends Record<string, unknown>>(
  evidence: T,
  corrections: readonly ScoreCorrectionRecord[],
): ResolvedEvidence<T> {
  const relevant = [...corrections]
    .filter((correction) => correction.targetId === evidence.id)
    .sort((left, right) => left.correctedAt.localeCompare(right.correctedAt));
  if (relevant.length === 0) {
    return { effective: evidence, corrected: false, correctionCount: 0 };
  }
  const effective = { ...evidence };
  for (const correction of relevant) {
    Object.assign(effective, correction.correctedFields);
  }
  return { effective: effective as T, corrected: true, correctionCount: relevant.length };
}
