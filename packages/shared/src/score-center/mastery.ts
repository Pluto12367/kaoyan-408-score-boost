import type { AttemptSignal, MasteryState, ReviewQuality } from './types';

const PRIMARY_ALPHA = 0.18;
const SECONDARY_ALPHA = 0.07;
const RECENT_ACCURACY_ALPHA = 0.2;
const STABILITY_MULTIPLIERS: Record<ReviewQuality, number> = {
  0: 0.6,
  1: 0.8,
  2: 1.0,
  3: 1.35,
  4: 1.7,
  5: 2.1,
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function targetForAttempt(isCorrect: boolean, difficulty: number): number {
  if (isCorrect) return Math.min(1, 0.72 + difficulty * 0.055);
  return Math.max(0, 0.38 - (difficulty - 1) * 0.045);
}

export function updateMasteryAfterAttempt(
  state: MasteryState,
  signal: AttemptSignal,
): MasteryState {
  const attempts = state.attempts + 1;
  const correctCount = state.correctCount + (signal.isCorrect ? 1 : 0);
  const wrongCount = state.wrongCount + (signal.isCorrect ? 0 : 1);
  const accuracy = attempts > 0 ? correctCount / attempts : 0;
  const alpha = signal.role === 'PRIMARY' ? PRIMARY_ALPHA : SECONDARY_ALPHA;
  const target = targetForAttempt(signal.isCorrect, signal.difficulty);

  return {
    mastery: clamp01(state.mastery + alpha * (target - state.mastery)),
    accuracy,
    recentAccuracy: clamp01(
      state.recentAccuracy + RECENT_ACCURACY_ALPHA * ((signal.isCorrect ? 1 : 0) - state.recentAccuracy),
    ),
    attempts,
    correctCount,
    wrongCount,
    confidence: Math.min(1, 1 - Math.exp(-(attempts + 1) / 12)),
  };
}

export function estimateRetention(
  lastReviewedAt: Date | null,
  stabilityDays: number | null,
  now: Date,
): number {
  if (!lastReviewedAt || stabilityDays == null) return 0.5;
  const elapsedDays = Math.max(0, (now.getTime() - lastReviewedAt.getTime()) / 86_400_000);
  return clamp01(Math.exp(-elapsedDays / Math.max(1, stabilityDays)));
}

export function updateStabilityAfterReview(
  previousStabilityDays: number | null,
  quality: ReviewQuality,
): number {
  const base = previousStabilityDays ?? 1;
  return Math.max(0.5, base * STABILITY_MULTIPLIERS[quality]);
}
