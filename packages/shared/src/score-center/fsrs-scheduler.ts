/**
 * LE/V11-M4 — FSRS predictor (pure, shared).
 *
 * FSRS-4.5 core (DSR model): three-component memory state
 *   D (difficulty, 1..10) · S (stability, days) · R (retrievability, 0..1)
 *
 *   R(t, S)  = (1 + FACTOR · t / S) ^ DECAY        (forgetting curve)
 *   I(r, S)  = S / FACTOR · (r ^ (1/DECAY) − 1)     (interval to hit target r)
 *
 * DEFAULT_FSRS_WEIGHTS are the published fsrs4anki FSRS-4.5 defaults,
 * explicitly UNTRAINED: per the honesty contract, predicted recall is a
 * model estimate — the shadow experiment (review-shadow.ts) comparing
 * predicted vs observed retention is the empirical validator, and weight
 * optimization is out of scope until real data supports it.
 *
 * Pure module: zero imports, deterministic, all outputs clamped.
 */

export const FSRS_DECAY = -0.5;
export const FSRS_FACTOR = 19 / 81;
export const DEFAULT_TARGET_RETENTION = 0.9;
export const MIN_STABILITY = 0.1;
export const MAX_STABILITY = 10000;
export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 10;

/** fsrs4anki FSRS-4.5 published default weights (17), untrained. */
export const DEFAULT_FSRS_WEIGHTS: readonly number[] = [
  0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474,
  0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755,
];

export interface FsrsMemoryState {
  readonly stability: number;
  readonly difficulty: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Forgetting curve: retrievability after `elapsedDays` at stability `stability`. */
export function recallProbability(elapsedDays: number, stability: number): number {
  const safeStability = Math.max(stability, MIN_STABILITY);
  return clamp((1 + FSRS_FACTOR * (elapsedDays / safeStability)) ** FSRS_DECAY, 0, 1);
}

/** Interval (days, rounded up) that keeps retrievability at `targetRetention`. */
export function nextInterval(stability: number, targetRetention = DEFAULT_TARGET_RETENTION): number {
  const safeStability = Math.max(stability, MIN_STABILITY);
  const raw = (safeStability / FSRS_FACTOR) * (targetRetention ** (1 / FSRS_DECAY) - 1);
  return Math.max(1, Math.ceil(raw));
}

/** Difficulty update after a graded review, clamped to [1, 10]. */
export function nextDifficulty(difficulty: number, grade: 1 | 2 | 3 | 4, weights: readonly number[] = DEFAULT_FSRS_WEIGHTS): number {
  const next = difficulty - weights[6] * (grade - 3);
  return clamp(Math.round(next * 1000) / 1000, MIN_DIFFICULTY, MAX_DIFFICULTY);
}

/** Initial stability for a first-time grade (w0..w3). */
export function initialStability(grade: 1 | 2 | 3 | 4, weights: readonly number[] = DEFAULT_FSRS_WEIGHTS): number {
  return clamp(weights[grade - 1], MIN_STABILITY, MAX_STABILITY);
}

/** Initial difficulty for a first-time grade (w4/w5). */
export function initialDifficulty(grade: 1 | 2 | 3 | 4, weights: readonly number[] = DEFAULT_FSRS_WEIGHTS): number {
  return clamp(Math.round((weights[4] - (grade - 3) * weights[5]) * 1000) / 1000, MIN_DIFFICULTY, MAX_DIFFICULTY);
}

/**
 * Stability after a graded review at retrievability R (FSRS-4.5 recall
 * branch, with hard-penalty / easy-bonus terms).
 */
export function nextStabilityAfterRecall(
  state: FsrsMemoryState,
  elapsedDays: number,
  grade: 2 | 3 | 4,
  weights: readonly number[] = DEFAULT_FSRS_WEIGHTS,
): number {
  const retrievability = recallProbability(elapsedDays, state.stability);
  const hardPenalty = grade === 2 ? weights[15] : 1;
  const easyBonus = grade === 4 ? weights[16] : 1;
  const growth =
    1 +
    Math.exp(weights[7]) *
      (11 - state.difficulty) *
      state.stability ** -weights[8] *
      (Math.exp(weights[9] * (1 - retrievability)) - 1) *
      hardPenalty *
      easyBonus;
  return clamp(state.stability * growth, MIN_STABILITY, MAX_STABILITY);
}

/** Stability after a lapse (grade 1): a fraction of the old stability. */
export function nextStabilityAfterLapse(
  state: FsrsMemoryState,
  retrievability: number,
  weights: readonly number[] = DEFAULT_FSRS_WEIGHTS,
): number {
  const next =
    weights[11] *
    state.difficulty ** -weights[12] *
    ((state.stability + 1) ** weights[13] - 1) *
    Math.exp(weights[14] * (1 - retrievability));
  return clamp(Math.round(next * 1000) / 1000, MIN_STABILITY, MAX_STABILITY);
}

/**
 * Unified one-step stability update for the shadow evaluator: correct
 * reviews take the FSRS-4.5 recall branch (grade 3), lapses the forget
 * branch. Returns the full memory state.
 */
export function nextStability(
  input: { readonly stability: number; readonly difficulty: number; readonly elapsedDays: number; readonly correct: boolean },
  weights: readonly number[] = DEFAULT_FSRS_WEIGHTS,
): FsrsMemoryState {
  const retrievability = recallProbability(input.elapsedDays, input.stability);
  if (input.correct) {
    const stability = nextStabilityAfterRecall(
      { stability: input.stability, difficulty: input.difficulty },
      input.elapsedDays,
      3,
      weights,
    );
    return { stability, difficulty: nextDifficulty(input.difficulty, 3, weights) };
  }
  return { stability: nextStabilityAfterLapse(input, retrievability, weights), difficulty: nextDifficulty(input.difficulty, 1, weights) };
}
