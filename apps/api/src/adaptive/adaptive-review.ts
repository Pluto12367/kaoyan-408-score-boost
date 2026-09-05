/**
 * V4-7 Adaptive Review — pure spacing/intensity derivation.
 *
 * Preserves the EXISTING ReviewSchedule semantics (stability → nextReviewAt,
 * consecutiveCorrect → resolution): this layer only derives the
 * RECOMMENDED next-interval and intensity from evidence already recorded
 * (mastery, stability, wrong streak, overdue state). The canonical writer
 * for review state remains ScoreCenterService.applyReview.
 *
 * Interval rules (deterministic):
 *   base = stabilityDays (engine-maintained)
 *   × masteryFactor   (0.7 weak <0.45 / 1.0 mid / 1.25 strong ≥0.7)
 *   × riskFactor      (0.8 if wrong-streak risk fires)
 *   × debtFactor      (0.85 if overdue>0 — tighten to clear debt)
 *   clamp [0.5, 14] days, rounded to 0.5.
 */

export interface AdaptiveReviewInput {
  stabilityDays: number | null;
  mastery: number;
  attempts: number;
  wrongCount: number;
  overdueCount: number;
  /** Fires when the wrong-streak signal is present (from the signal engine). */
  wrongStreakRisk: boolean;
}

export interface AdaptiveReviewRecommendation {
  intervalDays: number;
  intensity: 'light' | 'standard' | 'intensive';
  factors: { masteryFactor: number; riskFactor: number; debtFactor: number };
  reason: string;
}

export function deriveAdaptiveReviewInterval(input: AdaptiveReviewInput): AdaptiveReviewRecommendation {
  const base = Math.max(0.5, input.stabilityDays ?? 1);
  const wrongRatio = input.attempts > 0 ? input.wrongCount / input.attempts : 0;

  const masteryFactor = input.mastery < 0.45 ? 0.7 : input.mastery >= 0.7 ? 1.25 : 1.0;
  const riskFactor = input.wrongStreakRisk ? 0.8 : 1.0;
  const debtFactor = input.overdueCount > 0 ? 0.85 : 1.0;

  const raw = base * masteryFactor * riskFactor * debtFactor;
  const intervalDays = clampInterval(raw);

  const intensity: AdaptiveReviewRecommendation['intensity'] =
    input.mastery < 0.45 || wrongRatio >= 0.6 || input.overdueCount >= 3 ? 'intensive'
      : input.mastery >= 0.7 && wrongRatio < 0.3 ? 'light'
        : 'standard';

  const reasonParts: string[] = [];
  if (masteryFactor < 1) reasonParts.push('掌握度偏低：缩短间隔');
  if (masteryFactor > 1) reasonParts.push('掌握度良好：延长间隔');
  if (riskFactor < 1) reasonParts.push('连错风险：加密复习');
  if (debtFactor < 1) reasonParts.push('存在逾期：优先清偿');
  if (reasonParts.length === 0) reasonParts.push('按当前 stability 正常排期');

  return { intervalDays, intensity, factors: { masteryFactor, riskFactor, debtFactor }, reason: reasonParts.join('；') };
}

function clampInterval(raw: number): number {
  const clamped = Math.min(14, Math.max(0.5, raw));
  return Math.round(clamped * 2) / 2;
}

/**
 * Personalized practice selection (V4-8 preview helper, same module family):
 * picks the next practice target from REAL candidate questions by
 * mastery-distance — prefers questions whose node mastery is nearest to the
 * productive zone (0.4-0.7) and never invents questions.
 */
export interface PracticeCandidate {
  questionId: string;
  knowledgeNodeId: string | null;
  difficulty: 'BASIC' | 'MEDIUM' | 'HARD';
}

export interface PracticeSelection {
  questionId: string;
  knowledgeNodeId: string | null;
  selectionReason: string;
}

export function selectNextPractice(
  candidates: readonly PracticeCandidate[],
  masteryByNode: ReadonlyMap<string, number>,
  excludeQuestionIds: ReadonlySet<string> = new Set(),
): PracticeSelection | null {
  const eligible = candidates.filter((candidate) => !excludeQuestionIds.has(candidate.questionId));
  if (eligible.length === 0) return null;
  const productiveZone = (difficulty: PracticeCandidate['difficulty']): [number, number] =>
    difficulty === 'BASIC' ? [0.2, 0.5] : difficulty === 'MEDIUM' ? [0.35, 0.7] : [0.55, 0.9];
  let best: PracticeSelection | null = null;
  let bestScore = -1;
  for (const candidate of eligible) {
    const nodeId = candidate.knowledgeNodeId ?? '';
    const mastery = masteryByNode.get(nodeId);
    const [low, high] = productiveZone(candidate.difficulty);
    // In productive zone = best; outside = distance from zone boundary.
    let fit: number;
    if (mastery == null) fit = 0.5;
    else if (mastery >= low && mastery <= high) fit = 1;
    else fit = mastery < low ? 0.6 : 0.3;
    if (fit > bestScore) {
      bestScore = fit;
      best = {
        questionId: candidate.questionId,
        knowledgeNodeId: nodeId || null,
        selectionReason: mastery == null
          ? '新数据：无掌握度记录，按难度中性选择'
          : mastery < low
            ? `略低于有效区间（${Math.round(mastery * 100)}%），巩固后再挑战`
            : mastery > high
              ? '已超出该难度有效区间，优先更进阶题'
              : '处于高效练习区间',
      };
    }
  }
  return best
    ? { questionId: best.questionId, knowledgeNodeId: best.knowledgeNodeId, selectionReason: best.selectionReason }
    : null;
}