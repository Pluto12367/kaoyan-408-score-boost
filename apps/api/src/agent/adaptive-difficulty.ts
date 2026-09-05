/**
 * Adaptive Difficulty (Phase PX-2) — evidence-based, pure functions.
 *
 * Mission constraint: difficulty adjustment MUST derive from mastery
 * evidence carried by StudentContext (accuracy trend, task completion,
 * due/overdue reviews) — never from an LLM's opinion. The LLM only narrates
 * the plan; the adjustment level is decided here, deterministically.
 *
 * Rules (first match wins):
 * - reduce    : recent accuracy < 0.5 (weak recent performance)
 * - challenge : completion rate >= 0.8 AND accuracy >= 0.75 (consistently
 *               finishing AND performing)
 * - maintain  : otherwise
 */

export interface DifficultyEvidence {
  /** Recent accuracy in [0,1]; null when insufficient data. */
  recentAccuracy: number | null;
  /** Today/yesterday plan completion rate in [0,1]; null when no plan. */
  completionRate: number | null;
  weakNodeCount: number;
  dueCount: number;
  overdueCount: number;
}

export type DifficultyLevel = 'reduce' | 'maintain' | 'challenge';

export interface DifficultyAdjustment {
  level: DifficultyLevel;
  /** Suggested budget derived from the student's base choice. */
  availableMinutes: 30 | 60 | 120 | 180;
  reasons: string[];
}

const REDUCE_ACCURACY_THRESHOLD = 0.5;
const CHALLENGE_COMPLETION_THRESHOLD = 0.8;
const CHALLENGE_ACCURACY_THRESHOLD = 0.75;

const NEXT_MINUTES: Record<30 | 60 | 120 | 180, 30 | 60 | 120 | 180> = {
  30: 60,
  60: 120,
  120: 180,
  180: 180,
};

export function deriveDifficultyAdjustment(
  evidence: DifficultyEvidence,
  baseMinutes: 30 | 60 | 120 | 180 = 60,
): DifficultyAdjustment {
  const reasons: string[] = [];

  const hasAccuracy = evidence.recentAccuracy != null;
  const weakAccuracy = hasAccuracy && (evidence.recentAccuracy as number) < REDUCE_ACCURACY_THRESHOLD;

  if (weakAccuracy) {
    reasons.push(`近7天正确率 ${Math.round((evidence.recentAccuracy as number) * 100)}% 低于 ${REDUCE_ACCURACY_THRESHOLD * 100}%，降低任务强度巩固基础`);
    if (evidence.overdueCount > 0) reasons.push(`存在 ${evidence.overdueCount} 项逾期复习，优先清偿`);
    return { level: 'reduce', availableMinutes: baseMinutes, reasons };
  }

  const strongCompletion = evidence.completionRate != null && evidence.completionRate >= CHALLENGE_COMPLETION_THRESHOLD;
  const strongAccuracy = hasAccuracy && (evidence.recentAccuracy as number) >= CHALLENGE_ACCURACY_THRESHOLD;
  if (strongCompletion && strongAccuracy) {
    reasons.push(`任务完成率 ${Math.round((evidence.completionRate as number) * 100)}% 且正确率 ${Math.round((evidence.recentAccuracy as number) * 100)}%，提升挑战档位`);
    return { level: 'challenge', availableMinutes: NEXT_MINUTES[baseMinutes], reasons };
  }

  if (!hasAccuracy) reasons.push('近期练习数据不足，维持当前强度并优先建立数据');
  else reasons.push(`近期正确率 ${Math.round((evidence.recentAccuracy as number) * 100)}%，维持当前强度`);
  if (evidence.dueCount > 0) reasons.push(`有 ${evidence.dueCount} 项复习到期`);
  return { level: 'maintain', availableMinutes: baseMinutes, reasons };
}