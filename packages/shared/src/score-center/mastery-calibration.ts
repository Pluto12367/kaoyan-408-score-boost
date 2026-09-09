/**
 * LE/V11-M4.2 — Mastery Calibration shadow model (pure).
 *
 * Read-only calibration evidence: compares the stored EMA mastery against
 * the OBSERVED recent accuracy on the same node. Never writes
 * UserKnowledgeMastery — the difference and confidence are calibration
 * signals for later engine tuning, decided by humans.
 *
 * Honesty rules: no recent attempts → evidenceEstimate null and the
 * suggestion is 'hold' (missing ≠ wrong); confidence follows the sample
 * size (≥10 high, ≥5 medium, else low).
 */

export const CALIBRATION_DIRECTION_THRESHOLD = 0.15;
export const CALIBRATION_HIGH_CONFIDENCE_ATTEMPTS = 10;
export const CALIBRATION_MEDIUM_CONFIDENCE_ATTEMPTS = 5;
export const CALIBRATION_MAX_ATTEMPTS = 20;

export interface CalibrationAttempt {
  readonly correct: boolean;
}

export interface CalibrationNodeInput {
  readonly nodeId: string;
  readonly currentMastery: number;
  readonly attempts: readonly CalibrationAttempt[];
}

export interface MasteryCalibrationEntry {
  readonly nodeId: string;
  readonly currentMastery: number;
  readonly evidenceEstimate: number | null;
  readonly difference: number | null;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly suggestedDirection: 'raise' | 'lower' | 'hold';
  readonly sampleSize: number;
}

export interface MasteryCalibrationResult {
  readonly entries: readonly MasteryCalibrationEntry[];
  readonly source: 'derived';
}

export function buildMasteryCalibration(nodes: readonly CalibrationNodeInput[]): MasteryCalibrationResult {
  const entries = nodes.map((node) => calibrateNode(node));
  return { entries, source: 'derived' };
}

function calibrateNode(node: CalibrationNodeInput): MasteryCalibrationEntry {
  const sampleSize = node.attempts.length;
  if (sampleSize === 0) {
    return {
      nodeId: node.nodeId,
      currentMastery: node.currentMastery,
      evidenceEstimate: null,
      difference: null,
      confidence: 'low',
      suggestedDirection: 'hold',
      sampleSize: 0,
    };
  }
  const correct = node.attempts.filter((attempt) => attempt.correct).length;
  const evidenceEstimate = Math.round((correct / sampleSize) * 100) / 100;
  const difference = Math.round((node.currentMastery - evidenceEstimate) * 100) / 100;
  // Direction is the ADJUSTMENT for the stored mastery: evidence above the
  // stored value → raise it; below → lower it.
  const suggestedDirection =
    difference <= -CALIBRATION_DIRECTION_THRESHOLD
      ? 'raise'
      : difference >= CALIBRATION_DIRECTION_THRESHOLD
        ? 'lower'
        : 'hold';
  const confidence =
    sampleSize >= CALIBRATION_HIGH_CONFIDENCE_ATTEMPTS
      ? 'high'
      : sampleSize >= CALIBRATION_MEDIUM_CONFIDENCE_ATTEMPTS
        ? 'medium'
        : 'low';
  return {
    nodeId: node.nodeId,
    currentMastery: node.currentMastery,
    evidenceEstimate,
    difference,
    confidence,
    suggestedDirection,
    sampleSize,
  };
}
