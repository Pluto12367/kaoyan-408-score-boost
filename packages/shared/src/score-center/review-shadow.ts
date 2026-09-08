/**
 * LE-V10 F3 M1 — Review Shadow Evaluator (pure module).
 *
 * Measures how well the CURRENT review scheduler retains knowledge, from
 * facts that already exist: every ReviewAttempt carries its scheduled
 * interval (nextIntervalDays), and later same-question PracticeRecords show
 * whether the knowledge actually held. This is the baseline side of the
 * FSRS shadow experiment — the FSRS predictor will emit the same result
 * shape so the comparison is apples-to-apples.
 *
 * Honesty rules (constitution §7):
 *   - an attempt with no same-question follow-up practice in a window is
 *     "no evidence", never counted as forgotten (missing ≠ 0%)
 *   - per attempt and window, only the FIRST follow-up inside the window
 *     decides the outcome
 *   - below the preregistered sample floor the result is labelled
 *     insufficient_data — no migration conclusions without evidence
 * Pure module: zero imports, deterministic; the service owns all IO.
 */

export const MIN_SHADOW_SAMPLE = 30;

export interface ReviewShadowAttempt {
  readonly userId: string;
  readonly questionId: string;
  readonly reviewedAt: string;
  readonly redoCorrect: boolean;
  /** The old algorithm's scheduled interval for this attempt. */
  readonly nextIntervalDays: number;
}

export interface ReviewShadowPractice {
  readonly userId: string;
  readonly questionId: string;
  readonly practicedAt: string;
  readonly correct: boolean;
}

export interface ShadowWindowMetric {
  readonly window: string;
  readonly minDays: number;
  readonly maxDays: number;
  readonly eligibleAttempts: number;
  readonly correctFollowUps: number;
  /** null = no evidence in this window (never 0%). */
  readonly retentionRate: number | null;
}

export interface ReviewShadowResult {
  readonly totalAttempts: number;
  readonly attemptsWithFollowUp: number;
  readonly postReviewAccuracy: number | null;
  readonly windows: readonly ShadowWindowMetric[];
  readonly intervalBuckets: readonly ShadowWindowMetric[];
  readonly confidence: 'sufficient' | 'insufficient_data';
  readonly source: 'derived';
}

const DAY_MS = 86_400_000;
const OBSERVATION_HORIZON_DAYS = 17;

const POST_WINDOW = { window: 'post_1d', minDays: 0, maxDays: 1 } as const;
const RETENTION_WINDOWS = [
  { window: 'retention_7d', minDays: 2, maxDays: 9 },
  { window: 'retention_14d', minDays: 10, maxDays: 17 },
] as const;

const INTERVAL_BUCKETS = [
  { window: 'interval_1_2', minDays: 1, maxDays: 2 },
  { window: 'interval_3_6', minDays: 3, maxDays: 6 },
  { window: 'interval_7_13', minDays: 7, maxDays: 13 },
  { window: 'interval_14_plus', minDays: 14, maxDays: Number.MAX_SAFE_INTEGER },
] as const;

interface FollowUp {
  readonly days: number;
  readonly correct: boolean;
}

function daysBetween(fromIso: string, toIso: string): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / DAY_MS;
}

function windowOutcome(
  followUps: readonly FollowUp[],
  minDays: number,
  maxDays: number,
): FollowUp | null {
  for (const followUp of followUps) {
    if (followUp.days > minDays && followUp.days <= maxDays) return followUp;
  }
  return null;
}

function windowMetric(
  window: string,
  minDays: number,
  maxDays: number,
  attempts: readonly { followUps: readonly FollowUp[] }[],
): ShadowWindowMetric {
  let eligibleAttempts = 0;
  let correctFollowUps = 0;
  for (const attempt of attempts) {
    const outcome = windowOutcome(attempt.followUps, minDays, maxDays);
    if (!outcome) continue;
    eligibleAttempts += 1;
    if (outcome.correct) correctFollowUps += 1;
  }
  return {
    window,
    minDays,
    maxDays: maxDays === Number.MAX_SAFE_INTEGER ? -1 : maxDays,
    eligibleAttempts,
    correctFollowUps,
    retentionRate: eligibleAttempts > 0 ? Math.round((correctFollowUps / eligibleAttempts) * 100) : null,
  };
}

export function buildReviewShadow(
  attempts: readonly ReviewShadowAttempt[],
  practices: readonly ReviewShadowPractice[],
): ReviewShadowResult {
  const practicesByPair = new Map<string, { practicedAt: string; correct: boolean }[]>();
  for (const row of practices) {
    const key = `${row.userId}::${row.questionId}`;
    const list = practicesByPair.get(key) ?? (practicesByPair.set(key, []), practicesByPair.get(key)!);
    list.push({ practicedAt: row.practicedAt, correct: row.correct });
  }

  const attemptRows: { followUps: FollowUp[]; nextIntervalDays: number }[] = [];
  let attemptsWithFollowUp = 0;

  for (const row of attempts) {
    const key = `${row.userId}::${row.questionId}`;
    const reviewedMs = new Date(row.reviewedAt).getTime();
    const followUps = (practicesByPair.get(key) ?? [])
      .map((entry) => ({ days: (new Date(entry.practicedAt).getTime() - reviewedMs) / DAY_MS, correct: entry.correct }))
      .filter((entry) => entry.days > 0 && entry.days <= OBSERVATION_HORIZON_DAYS)
      .sort((left, right) => left.days - right.days);
    if (followUps.length > 0) attemptsWithFollowUp += 1;
    attemptRows.push({ followUps, nextIntervalDays: row.nextIntervalDays });
  }

  const postMetric = windowMetric('post_1d', 0, 1, attemptRows);
  const windows = RETENTION_WINDOWS.map((window) =>
    windowMetric(window.window, window.minDays, window.maxDays, attemptRows),
  );
  const intervalBuckets = INTERVAL_BUCKETS.map((bucket) => {
    const bucketRows = attemptRows.filter(
      (row) => row.nextIntervalDays >= bucket.minDays && row.nextIntervalDays <= bucket.maxDays,
    );
    const metric = windowMetric(bucket.window, 0, OBSERVATION_HORIZON_DAYS, bucketRows);
    return { ...metric, window: bucket.window, minDays: bucket.minDays, maxDays: bucket.maxDays === Number.MAX_SAFE_INTEGER ? -1 : bucket.maxDays };
  });

  return {
    totalAttempts: attemptRows.length,
    attemptsWithFollowUp,
    postReviewAccuracy: postMetric.retentionRate,
    windows,
    intervalBuckets,
    confidence: attemptsWithFollowUp >= MIN_SHADOW_SAMPLE ? 'sufficient' : 'insufficient_data',
    source: 'derived',
  };
}
