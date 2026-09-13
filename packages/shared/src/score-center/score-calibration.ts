/**
 * V12-M5 — Real score calibration (pure module). S1 refactored.
 *
 * ## The broken link this closes (EB-4)
 *
 * The system could produce an estimated score and it could record a real
 * assessment score, but the two had never been compared. Every claim of
 * "improvement" therefore rested on a proxy that was never validated.
 *
 * ## The constraint that shapes the design
 *
 * V12-M5 must keep three concepts apart:
 *
 *   PREDICTION  an estimate, with a range and a disclaimer
 *   EVIDENCE    the facts the prediction rested on (and how many)
 *   ACTUAL      the score that was really recorded
 *
 * So no output field ever merges them, and the calibration refuses to speak
 * when there is nothing to calibrate against: "no error" and "no data" are
 * different statements, and below the sample floor the mean is null.
 *
 * ## S1 — the 150-vs-100 mismatch is now inexpressible
 *
 * The first honest comparison this module ever made paired a 150-scale
 * prediction against a 100-scale accuracy rate (measured: predicted=26,
 * actual=96/100, error=70 — a number that meant nothing). S1 closes that:
 *
 *   • when a caller supplies `actualNormalizedScore` (the Score Ledger always
 *     does), the pair must pass FULL compatibility — same normalized scale,
 *     same semantic (`exam_total`), non-UNKNOWN provenance, evidence not
 *     predating the prediction — or it is EXCLUDED with the reason, never
 *     averaged
 *   • even a legacy caller that supplies no normalization is blocked from
 *     mixing scales: a pair whose `totalScore` is present and is not 150 can
 *     no longer produce an error row
 *   • rows carrying provenance are stratified per source group; the summary
 *     never merges strata, and the preregistered E1 gate (n ≥ 5, median
 *     absolute error < 15) is evaluated per group
 *
 * Two further honesty rules, both deliberate:
 *   • an assessment whose prediction cannot be honestly reconstructed is
 *     EXCLUDED and listed — it is not treated as a perfect prediction
 *   • mastery growth is never converted into a score claim; predicted and
 *     actual improvement are carried as two separate series
 *
 * Pure: deterministic; the only imports are the S1 score-anchor primitives.
 */

import {
  evaluateCalibrationGate,
  deriveCalibrationEvidenceStatus,
  isCalibrationCompatible,
  type CalibrationGateEntry,
  type CalibrationEvidenceStatus,
  type ScoreSemantic,
  type ScoreSource,
} from '../score-anchor/score-anchor';

/** Below this many paired observations no calibration claim is made. */
export const CALIBRATION_MIN_SAMPLE = 5;

/** Shown verbatim wherever a calibration is rendered. */
export const PREDICTION_IS_NOT_ACTUAL =
  '预测分是估算，不是真实成绩；校准只说明估算偏差，不代表实际考试结果。';

export interface CalibrationPairInput {
  readonly sessionId: string;
  readonly assessedAt: string;
  /** Predicted best estimate as of just before the assessment. null = not reconstructable. */
  readonly predictedBest: number | null;
  readonly predictedMin: number | null;
  readonly predictedMax: number | null;
  /** When the prediction was generated (ledger predictions know; reconstructions do not). */
  readonly predictedAt?: string | null;
  /** The recorded score. null = no outcome recorded. */
  readonly actualScore: number | null;
  readonly totalScore: number | null;
  /**
   * S1 strict path: the actual score already normalized onto the 150 scale
   * (rawScore / rawTotalScale × 150). When present, full compatibility is
   * enforced and `actualScore` is only kept for display.
   */
  readonly actualNormalizedScore?: number | null;
  /**
   * S1-I0 (INV-1/INV-2): the scale that `actualNormalizedScore` is expressed in,
   * as returned by `normalizeScore` — i.e. PROVEN by the normalizer rather than
   * assumed by the caller. A normalized value with no proven scale is excluded:
   * assuming 150 here is what made the compatibility check tautological.
   */
  readonly actualNormalizedScale?: number | null;
  readonly actualSemantic?: ScoreSemantic;
  readonly actualSource?: ScoreSource;
  /** How many facts the prediction rested on. */
  readonly evidenceSampleSize: number;
  readonly evidenceBasis: string;
}

export interface CalibrationRow {
  readonly sessionId: string;
  readonly assessedAt: string;
  readonly predicted: number;
  readonly actual: number;
  /** actual - predicted; positive means the student did better than estimated. */
  readonly error: number;
  readonly direction: 'actual_above_prediction' | 'actual_below_prediction' | 'on_target';
  readonly withinRange: boolean;
  readonly evidence: { readonly sampleSize: number; readonly basis: string };
  readonly basis: string;
  /** S1: the provenance group this row belongs to (stratified, never mixed). */
  readonly source?: ScoreSource;
  readonly semantic?: ScoreSemantic;
  readonly scalePair?: string;
}

export interface CalibrationExclusion {
  readonly sessionId: string;
  readonly reason: string;
}

export interface ScoreCalibration {
  readonly rows: readonly CalibrationRow[];
  readonly exclusions: readonly CalibrationExclusion[];
  readonly summary: {
    readonly pairedCount: number;
    readonly excludedCount: number;
    /** null until the sample floor is met — never a mean over too few pairs. */
    readonly meanAbsoluteError: number | null;
    /** Signed: positive = the model under-predicts. null below the floor. */
    readonly bias: number | null;
    readonly withinRangeRate: number | null;
    readonly confidence: 'sufficient' | 'insufficient_data';
    readonly basis: string;
  };
  readonly improvement: {
    readonly predictedDelta: number | null;
    readonly actualDelta: number | null;
    readonly gap: number | null;
    readonly basis: string;
  };
  /** S1: per-provenance gate strata — empty when rows carry no provenance. */
  readonly strata: readonly CalibrationGateEntry[];
  readonly gateStatus: CalibrationEvidenceStatus;
  readonly disclaimer: string;
  readonly authoritative: false;
}

export function buildScoreCalibration(
  input: readonly CalibrationPairInput[],
): ScoreCalibration {
  const rows: CalibrationRow[] = [];
  const exclusions: CalibrationExclusion[] = [];

  for (const pair of input) {
    if (pair.predictedBest == null) {
      exclusions.push({
        sessionId: pair.sessionId,
        reason: '无法诚实重建该次测评之前的预测（缺少预测或其所依赖的证据快照），已排除而非按零误差计入。',
      });
      continue;
    }
    if (pair.actualScore == null) {
      exclusions.push({
        sessionId: pair.sessionId,
        reason: '该次测评没有记录成绩（分数缺失），无法与预测对照。',
      });
      continue;
    }

    // S1 strict path: the Score Ledger supplies a normalized actual with
    // provenance. Compatibility is enforced HERE — an incompatible pair can
    // never reach the error computation.
    if (pair.actualNormalizedScore != null) {
      // S1-I0 (INV-1 E5 / INV-2): the scale must be PROVEN. Passing the 150
      // constant here made `scale_mismatch` unreachable by construction, so a
      // 100-scale row could be paired with a 150-scale prediction.
      if (pair.actualNormalizedScale == null) {
        exclusions.push({
          sessionId: pair.sessionId,
          reason: '量纲未证明（scale_unproven）：该实测值没有携带可证明的归一量纲，禁止与 150 分制预测直接比较，已排除而非混算。',
        });
        continue;
      }
      if (pair.actualNormalizedScale !== 150) {
        exclusions.push({
          sessionId: pair.sessionId,
          reason: `量纲不匹配（scale_mismatch）：预测为 150 分制，实测归一量纲为 ${pair.actualNormalizedScale}，已排除而非混算。`,
        });
        continue;
      }
      if (pair.actualSemantic == null) {
        exclusions.push({
          sessionId: pair.sessionId,
          reason: '口径未证明（semantic_unproven）：该实测值没有声明分数口径，无法判断能否与总分预测比较，已排除。',
        });
        continue;
      }
      const verdict = isCalibrationCompatible(
        {
          predictedScore: pair.predictedBest,
          predictedMinScore: pair.predictedMin,
          predictedMaxScore: pair.predictedMax,
          semantic: 'exam_total',
          generatedAt: pair.predictedAt ?? null,
        },
        {
          normalizedScore: pair.actualNormalizedScore,
          normalizedTotalScale: pair.actualNormalizedScale,
          semantic: pair.actualSemantic,
          source: pair.actualSource ?? 'UNKNOWN',
          occurredAt: pair.assessedAt,
        },
      );
      if (!verdict.compatible) {
        exclusions.push({
          sessionId: pair.sessionId,
          reason: `校准兼容性检查未通过（${verdict.reasons.join('、')}）：不同量纲/语义/来源的证据不得与预测直接比较，已排除而非混算。`,
        });
        continue;
      }
      const actual = pair.actualNormalizedScore;
      const error = round2(actual - pair.predictedBest);
      rows.push({
        sessionId: pair.sessionId,
        assessedAt: pair.assessedAt,
        predicted: pair.predictedBest,
        actual,
        error,
        direction: error > 0 ? 'actual_above_prediction' : error < 0 ? 'actual_below_prediction' : 'on_target',
        withinRange:
          pair.predictedMin != null && pair.predictedMax != null
            ? actual >= pair.predictedMin && actual <= pair.predictedMax
            : false,
        evidence: { sampleSize: pair.evidenceSampleSize, basis: pair.evidenceBasis },
        basis: `预测 ${pair.predictedBest}（区间 ${pair.predictedMin ?? '—'}–${pair.predictedMax ?? '—'}），实测 ${pair.actualScore}/${pair.totalScore ?? '—'} 归一为 ${actual}/150，偏差 ${error > 0 ? '+' : ''}${error}。来源 ${pair.actualSource ?? 'UNKNOWN'}。证据：${pair.evidenceBasis}（样本 ${pair.evidenceSampleSize}）。`,
        source: pair.actualSource,
        semantic: pair.actualSemantic ?? 'exam_total',
        scalePair: '150/150',
      });
      continue;
    }

    // Legacy path (no normalization supplied). S1-I0: a proven scale is still
    // required. The previous guard was `totalScore != null && totalScore !== 150`,
    // so `totalScore == null` slipped through and the error was computed anyway —
    // the audit reproduced the historical absurdity (96 − 26 = 70) that way.
    if (pair.totalScore == null) {
      exclusions.push({
        sessionId: pair.sessionId,
        reason: '量纲未证明（scale_unproven）：实测记录没有总分制式且未归一，无法证明与 150 分制预测同量纲，已排除而非混算。',
      });
      continue;
    }
    if (pair.totalScore !== 150) {
      exclusions.push({
        sessionId: pair.sessionId,
        reason: `量纲不匹配：预测为 150 分制，实测记录为 ${pair.totalScore} 分制且未归一，禁止直接相减，已排除。`,
      });
      continue;
    }
    if (pair.actualSemantic === 'accuracy_rate') {
      exclusions.push({
        sessionId: pair.sessionId,
        reason: '口径不匹配（semantic_mismatch）：正确率口径不得与总分预测配对，已排除。',
      });
      continue;
    }
    if (pair.actualSource === 'UNKNOWN') {
      exclusions.push({
        sessionId: pair.sessionId,
        reason: '来源未知（provenance_unknown）：来源未记录的证据不得进入校准层，已排除。',
      });
      continue;
    }
    if (pair.predictedAt != null && pair.assessedAt < pair.predictedAt) {
      exclusions.push({
        sessionId: pair.sessionId,
        reason: '时间不可比（prediction_after_outcome）：预测生成于实测之后，不得用于校准，已排除。',
      });
      continue;
    }

    const error = round2(pair.actualScore - pair.predictedBest);
    rows.push({
      sessionId: pair.sessionId,
      assessedAt: pair.assessedAt,
      predicted: pair.predictedBest,
      actual: pair.actualScore,
      error,
      direction: error > 0 ? 'actual_above_prediction' : error < 0 ? 'actual_below_prediction' : 'on_target',
      withinRange:
        pair.predictedMin != null && pair.predictedMax != null
          ? pair.actualScore >= pair.predictedMin && pair.actualScore <= pair.predictedMax
          : false,
      evidence: { sampleSize: pair.evidenceSampleSize, basis: pair.evidenceBasis },
      basis: `预测 ${pair.predictedBest}（区间 ${pair.predictedMin ?? '—'}–${pair.predictedMax ?? '—'}），实测 ${pair.actualScore}/${pair.totalScore}，偏差 ${error > 0 ? '+' : ''}${error}。证据：${pair.evidenceBasis}（样本 ${pair.evidenceSampleSize}）。`,
      source: pair.actualSource,
      semantic: pair.actualSemantic ?? 'exam_total',
      // A proven 150/150 pair, labelled like the strict path so downstream
      // strata never have to re-derive the scale.
      scalePair: '150/150',
    });
  }

  rows.sort((left, right) => left.assessedAt.localeCompare(right.assessedAt));

  const sufficient = rows.length >= CALIBRATION_MIN_SAMPLE;
  const meanAbsoluteError = sufficient
    ? round2(rows.reduce((sum, row) => sum + Math.abs(row.error), 0) / rows.length)
    : null;
  const bias = sufficient ? round2(rows.reduce((sum, row) => sum + row.error, 0) / rows.length) : null;
  const withinRangeRate = sufficient
    ? Math.round((rows.filter((row) => row.withinRange).length / rows.length) * 100)
    : null;

  // S1: stratify rows that carry provenance; never merge groups. Rows without
  // provenance (legacy callers) produce no strata instead of a fake group.
  const observations = rows
    .filter((row) => row.source != null)
    .map((row) => ({
      key: row.sessionId,
      source: row.source as ScoreSource,
      absoluteError: Math.abs(row.error),
      error: row.error,
      withinRange: row.withinRange,
    }));
  const strata = evaluateCalibrationGate(observations);
  const gateStatus = deriveCalibrationEvidenceStatus(strata);

  return {
    rows,
    exclusions,
    summary: {
      pairedCount: rows.length,
      excludedCount: exclusions.length,
      meanAbsoluteError,
      bias,
      withinRangeRate,
      confidence: sufficient ? 'sufficient' : 'insufficient_data',
      basis: describeSummary(rows.length, sufficient, meanAbsoluteError, bias, withinRangeRate),
    },
    improvement: buildImprovement(rows),
    strata,
    gateStatus,
    disclaimer: PREDICTION_IS_NOT_ACTUAL,
    authoritative: false,
  };
}

function describeSummary(
  paired: number,
  sufficient: boolean,
  mae: number | null,
  bias: number | null,
  withinRangeRate: number | null,
): string {
  if (paired === 0) {
    return '没有"预测 + 实测分数"成对的记录，因此不给出校准结论（没有误差 ≠ 没有数据）。';
  }
  if (!sufficient) {
    return `仅 ${paired} 条成对记录，低于预注册样本下限 ${CALIBRATION_MIN_SAMPLE}：样本不足，不给出平均绝对误差与偏差。`;
  }
  const direction = (bias ?? 0) > 0 ? '系统性低估' : (bias ?? 0) < 0 ? '系统性高估' : '无明显系统偏差';
  return `基于 ${paired} 条成对记录：平均绝对误差 ${mae} 分，偏差 ${bias} 分（${direction}），落于预测区间内 ${withinRangeRate}%。预测分不等于真实成绩。`;
}

function buildImprovement(rows: readonly CalibrationRow[]): ScoreCalibration['improvement'] {
  if (rows.length < 2) {
    return {
      predictedDelta: null,
      actualDelta: null,
      gap: null,
      basis: '至少需要两次成对测评才能比较进步幅度，当前不足。',
    };
  }
  const first = rows[0];
  const last = rows[rows.length - 1];
  const predictedDelta = round2(last.predicted - first.predicted);
  const actualDelta = round2(last.actual - first.actual);
  const gap = round2(actualDelta - predictedDelta);
  return {
    predictedDelta,
    actualDelta,
    gap,
    basis: `从 ${first.assessedAt.slice(0, 10)} 到 ${last.assessedAt.slice(0, 10)}：预测进步 ${predictedDelta} 分，实测进步 ${actualDelta} 分，差 ${gap} 分。掌握度上升不等同于分数上升，两者分别记录。`,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
