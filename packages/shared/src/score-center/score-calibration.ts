/**
 * V12-M5 — Real score calibration (pure module).
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
 * Two further honesty rules, both deliberate:
 *   • an assessment whose prediction cannot be honestly reconstructed is
 *     EXCLUDED and listed — it is not treated as a perfect prediction
 *   • mastery growth is never converted into a score claim; predicted and
 *     actual improvement are carried as two separate series
 *
 * Pure: zero imports, deterministic.
 */

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
  /** The recorded score. null = no outcome recorded. */
  readonly actualScore: number | null;
  readonly totalScore: number | null;
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
      basis: `预测 ${pair.predictedBest}（区间 ${pair.predictedMin ?? '—'}–${pair.predictedMax ?? '—'}），实测 ${pair.actualScore}${pair.totalScore ? `/${pair.totalScore}` : ''}，偏差 ${error > 0 ? '+' : ''}${error}。证据：${pair.evidenceBasis}（样本 ${pair.evidenceSampleSize}）。`,
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
