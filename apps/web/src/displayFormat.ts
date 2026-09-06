/**
 * Student-facing number formatting shared across report / mistakes surfaces.
 * Backend derived rates may carry full float precision (e.g. 41.6462); the
 * product convention is integer percentages, and missing evaluations must
 * read as 未评估 rather than null/NaN.
 */
export function formatRatePercent(value: number | null | undefined): string {
  return value == null ? '未评估' : `${Math.round(value)}%`;
}

export interface ScoreGapView {
  /** target - estimate clamped at 0; null when either side is unknown. */
  gap: number | null;
  /** Headline label for the goal-progress card. */
  gapLabel: string;
  /** 还差 cell label. */
  reachedLabel: string;
  /**
   * Actionable guidance when the goal is trivially met (target equals the
   * diagnostic estimate). Null when the gap is meaningful or unknowable.
   */
  guidance: string | null;
}

/**
 * Goal-progress semantics: a 0 gap means "target equals the diagnostic
 * estimate" (onboarding default), NOT "goal achieved" — it must never render
 * as 还差 0 分 next to a 115–125 predicted score.
 */
export function resolveScoreGapView(
  currentScore: number | null | undefined,
  targetScore: number | null | undefined,
): ScoreGapView {
  if (typeof currentScore !== 'number' || typeof targetScore !== 'number') {
    return { gap: null, gapLabel: '--', reachedLabel: '--', guidance: null };
  }
  const gap = Math.max(0, targetScore - currentScore);
  if (gap === 0) {
    return {
      gap: 0,
      gapLabel: '--',
      reachedLabel: '--',
      guidance: '目标分与当前估分持平：建议在学习画像里把目标分调到更有挑战的水平，进度会随之更新。',
    };
  }
  return { gap, gapLabel: `${gap} 分`, reachedLabel: `${gap} 分`, guidance: null };
}
