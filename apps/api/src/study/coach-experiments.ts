/**
 * V9 Phase 6 — feedback reflow + deterministic A/B assignment (pure module).
 *
 * Arm assignment: sha256(userId::experimentKey) picks the arm — deterministic
 * per user+experiment (sticky across sessions), no persistence, no peeking.
 * Feedback reflow: recent feedback grouped by scene; a scene with repeated
 * low ratings becomes an experiment candidate — the human decides, the
 * system only surfaces the signal.
 */

import { createHash } from 'node:crypto';

export const DEFAULT_EXPERIMENT_ARMS = ['control', 'variant'] as const;

export function assignExperimentArm(
  userId: string,
  experimentKey: string,
  arms: readonly string[] = DEFAULT_EXPERIMENT_ARMS,
): string {
  const digest = createHash('sha256').update(`${userId}::${experimentKey}`).digest();
  return arms[digest[0] % arms.length];
}

export interface FeedbackSceneRecord {
  scene: string;
  rating: number;
}

export interface FeedbackSceneInsight {
  scene: string;
  total: number;
  negative: number;
  candidate: boolean;
}

export const NEGATIVE_RATING_MAX = 2;
export const CANDIDATE_NEGATIVE_MIN = 3;

/**
 * Feedback reflow: scenes with >= CANDIDATE_NEGATIVE_MIN low ratings become
 * experiment candidates. Deterministic, bounded, and only ever a *signal* —
 * the owner decides which experiments run.
 */
export function deriveFeedbackInsights(
  records: readonly FeedbackSceneRecord[],
  negativeThreshold = NEGATIVE_RATING_MAX,
  candidateMin = CANDIDATE_NEGATIVE_MIN,
): { candidates: FeedbackSceneInsight[]; all: FeedbackSceneInsight[] } {
  const byScene = new Map<string, { total: number; negative: number }>();
  for (const record of records) {
    const bucket = byScene.get(record.scene) ?? { total: 0, negative: 0 };
    bucket.total += 1;
    if (record.rating <= negativeThreshold) bucket.negative += 1;
    byScene.set(record.scene, bucket);
  }
  const all: FeedbackSceneInsight[] = [...byScene.entries()]
    .map(([scene, bucket]) => ({
      scene,
      total: bucket.total,
      negative: bucket.negative,
      candidate: bucket.negative >= candidateMin,
    }))
    .sort((left, right) => right.negative - left.negative || right.total - left.total);
  return { candidates: all.filter((item) => item.candidate), all };
}
