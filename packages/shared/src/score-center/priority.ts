import type {
  ExamEvidence,
  PriorityBreakdown,
  PriorityContext,
  PriorityReasonCode,
  PriorityResult,
  TrendDirection,
  UserKnowledgeState,
} from './types';

const COMPONENT_WEIGHTS = {
  examValue: 0.37,
  weakness: 0.32,
  forgetting: 0.16,
  difficulty: 0.07,
  trend: 0.05,
  pinned: 0.03,
} as const;

const TREND_VALUES: Record<TrendDirection, number> = {
  RISING: 1,
  STABLE: 0.6,
  FALLING: 0.3,
  COLD: 0.1,
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function phaseMultipliers(daysToExam: number) {
  if (daysToExam <= 45) return { exam: 1.18, weakness: 1.12, difficulty: 0.82 };
  if (daysToExam <= 150) return { exam: 1.08, weakness: 1.05, difficulty: 1 };
  return { exam: 0.92, weakness: 0.95, difficulty: 1.12 };
}

export function calculatePriority(
  evidence: ExamEvidence,
  user: UserKnowledgeState | undefined,
  context: PriorityContext,
): PriorityResult {
  const phase = phaseMultipliers(context.daysToExam);

  const examValueRaw =
    0.38 * clamp01(evidence.recent3Y.frequency / 5)
    + 0.3 * clamp01(evidence.recent5Y.frequency / 5)
    + 0.16 * clamp01(evidence.allTimeEvidence.frequency / 5)
    + 0.1 * clamp01(evidence.importance / 5)
    + 0.06 * clamp01((evidence.recent5Y.primaryScore ?? 0) / 45);
  const examValue = clamp01(examValueRaw * phase.exam) * 100;

  const mastery = user?.mastery ?? 0.5;
  const recentAccuracy = user?.recentAccuracy ?? 0.55;
  const wrongCount = user?.wrongCount ?? 0;
  const weaknessRaw =
    0.52 * (1 - mastery)
    + 0.38 * (1 - recentAccuracy)
    + 0.1 * Math.min(1, wrongCount / 8);
  const weakness = clamp01(weaknessRaw * phase.weakness) * 100;

  const retention = user?.retention;
  const forgetting = user?.forgetting ?? (retention == null ? 0.5 : clamp01(1 - retention));
  const forgettingComponent = clamp01(forgetting) * 100;
  const difficulty = clamp01((evidence.difficulty / 5) * phase.difficulty) * 100;
  const trend = TREND_VALUES[evidence.trend.direction] * 100;
  const pinned = (user?.pinned ?? false) ? 100 : 0;

  const breakdown: PriorityBreakdown = {
    examValue,
    weakness,
    forgetting: forgettingComponent,
    difficulty,
    trend,
    pinned,
  };

  const score = Math.round(
    Math.min(100, Math.max(0,
      COMPONENT_WEIGHTS.examValue * examValue
      + COMPONENT_WEIGHTS.weakness * weakness
      + COMPONENT_WEIGHTS.forgetting * forgettingComponent
      + COMPONENT_WEIGHTS.difficulty * difficulty
      + COMPONENT_WEIGHTS.trend * trend
      + COMPONENT_WEIGHTS.pinned * pinned,
    )),
  );

  return {
    score,
    reasons: buildReasons(evidence, { mastery, recentAccuracy, wrongCount, forgetting }, context.daysToExam, breakdown),
    breakdown,
  };
}

function buildReasons(
  evidence: ExamEvidence,
  user: { mastery: number; recentAccuracy: number; wrongCount: number; forgetting: number },
  daysToExam: number,
  breakdown: PriorityBreakdown,
): PriorityReasonCode[] {
  const reasons: PriorityReasonCode[] = [];
  if (evidence.recent3Y.frequency >= 4) reasons.push('HIGH_RECENT_FREQUENCY');
  if (user.mastery < 0.55) reasons.push('LOW_MASTERY');
  if (user.recentAccuracy < 0.65) reasons.push('LOW_ACCURACY');
  if (user.wrongCount >= 3) reasons.push('REPEATED_WRONG');
  if (user.forgetting >= 0.55) reasons.push('REVIEW_DUE');
  if (evidence.trend.direction === 'RISING') reasons.push('RISING_TREND');
  if (daysToExam <= 45) reasons.push('EXAM_NEAR');
  if (evidence.evidenceConfidence === 'LOW') reasons.push('LOW_EVIDENCE');

  if (reasons.length < 2) {
    const genericPool: Array<{ code: PriorityReasonCode; value: number }> = [
      { code: 'HIGH_RECENT_FREQUENCY', value: breakdown.examValue },
      { code: 'LOW_MASTERY', value: breakdown.weakness },
      { code: 'REVIEW_DUE', value: breakdown.forgetting },
    ];
    for (const candidate of [...genericPool].sort((left, right) => right.value - left.value)) {
      if (reasons.length >= 2) break;
      if (!reasons.includes(candidate.code)) reasons.push(candidate.code);
    }
  }
  return reasons;
}
