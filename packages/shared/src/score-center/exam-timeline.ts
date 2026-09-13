/**
 * S1-I0 (INV-3, INV-4) — the ONE canonical exam timeline resolver.
 *
 * ## The defect this closes
 *
 * `User.examDate` existed but no decision path read it. `daysToExam` was derived
 * in five independent places with five different semantics for the same concept:
 *
 *   remainingDays ?? 96        recommendation.service.ts, study.service.ts
 *   DAYS_FALLBACK = 96         score-opportunity.service.ts, shadow-decision-chain.service.ts
 *   DAYS_FALLBACK = 240        score-calibration.service.ts   ← opposite extreme
 *   examYear -> Dec 20         learning-loop-trigger.service.ts
 *   `${year}-12-20`            the WEB CLIENT invented an exam date
 *   remainingDays ?? 0         report surfaces, threshold checks
 *
 * `96` means "unknown, assume the default plan horizon"; `240` makes the
 * prediction's time factor 1 instead of 0; `0` asserts the exam is today. Those
 * are three different claims produced from one missing value.
 *
 * ## The rule
 *
 *   examDate (FACT)  >  remainingDays (LEGACY CACHE)  >  unknown (null)
 *
 * The resolver never fabricates a number: absence resolves to `null` with
 * `basis: 'unknown'`. A caller that genuinely needs a number asks for the
 * fallback explicitly, and the fallback is then *labelled* so it can never be
 * mistaken for a fact. `null` is never coerced to 0.
 *
 * Pure: no clock (time arrives as input), no IO.
 */

const DAY_MS = 86_400_000;

/** The single named fallback. There must be no second constant in the codebase. */
export const EXAM_TIMELINE_FALLBACK_DAYS = 96;

export type ExamTimelineBasis = 'exam_date' | 'legacy_remaining_days' | 'unknown' | 'fallback_constant';

export interface ExamTimelineResolution {
  /** null = unknown. Never 0-by-default, never the fallback. */
  readonly days: number | null;
  readonly basis: ExamTimelineBasis;
  /** The stored `remainingDays` disagreed with the examDate-derived value. */
  readonly drift: boolean;
  /** Present only when the caller applied the named fallback. */
  readonly fallbackDays?: number;
}

function utcDayStart(value: Date | string): number | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Canonical resolution. `examDate` is the fact; `remainingDays` is a legacy
 * derived cache that is only consulted when the fact is absent.
 */
export function resolveDaysToExam(input: {
  examDate?: Date | string | null;
  remainingDays?: number | null;
  now: Date | string;
}): ExamTimelineResolution {
  const today = utcDayStart(input.now);
  const examination = input.examDate == null ? null : utcDayStart(input.examDate);

  if (examination != null && today != null) {
    const days = Math.max(0, Math.round((examination - today) / DAY_MS));
    // A stale cache is exactly what the drift flag exists to surface: examDate
    // wins and the disagreement is observable rather than silently averaged.
    const drift = isFiniteNumber(input.remainingDays) && input.remainingDays !== days;
    return { days, basis: 'exam_date', drift };
  }

  if (isFiniteNumber(input.remainingDays)) {
    return { days: Math.max(0, input.remainingDays), basis: 'legacy_remaining_days', drift: false };
  }

  return { days: null, basis: 'unknown', drift: false };
}

/**
 * For callers that genuinely need a number (a plan horizon, a phase multiplier).
 * The fallback is applied HERE and LABELLED, so a default can never pass for a
 * fact — and so there is exactly one fallback constant in the system.
 */
export function applyExamTimelineFallback(
  resolution: ExamTimelineResolution,
  fallbackDays: number = EXAM_TIMELINE_FALLBACK_DAYS,
): ExamTimelineResolution & { days: number } {
  if (resolution.days != null) return resolution as ExamTimelineResolution & { days: number };
  return { days: fallbackDays, basis: 'fallback_constant', drift: false, fallbackDays };
}

/** Convenience for the many sites that only need the number. */
export function resolveDaysToExamNumber(input: {
  examDate?: Date | string | null;
  remainingDays?: number | null;
  now: Date | string;
}, fallbackDays: number = EXAM_TIMELINE_FALLBACK_DAYS): number {
  return applyExamTimelineFallback(resolveDaysToExam(input), fallbackDays).days;
}

/**
 * S1-I0 (P0-4) — the observable drift counter.
 *
 * The resolver is pure and emits nothing, so the "stored `remainingDays`
 * disagrees with the examDate-derived value" event would otherwise be a boolean
 * nobody counts. This is a module-level tally for that event, kept out of the
 * resolver so purity is preserved while the disagreement is still MEASURABLE.
 *
 * Counters are per-process and reset on restart by construction: they are an
 * operational signal ("is a writer still producing stale caches?"), not a
 * source of truth, and must never be read back into a decision.
 */
const driftCounts = { examDateVsCache: 0 };

export function recordExamTimelineDrift(resolution: ExamTimelineResolution): void {
  if (resolution.drift) driftCounts.examDateVsCache += 1;
}

export function getExamTimelineDriftCount(): number {
  return driftCounts.examDateVsCache;
}

/** Test seam only — production code must never reset an operational counter. */
export function resetExamTimelineDriftCount(): void {
  driftCounts.examDateVsCache = 0;
}

/**
 * Resolve AND account for drift in one call, for IO-boundary callers that
 * already have both fields in hand. Returns the same resolution the pure
 * resolver would, after tallying any disagreement.
 */
export function resolveDaysToExamTracked(input: {
  examDate?: Date | string | null;
  remainingDays?: number | null;
  now: Date | string;
}): ExamTimelineResolution {
  const resolution = resolveDaysToExam(input);
  recordExamTimelineDrift(resolution);
  return resolution;
}
