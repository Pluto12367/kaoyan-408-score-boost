import {
  FIRST_USE_ORDER,
  GUIDANCE_COOLDOWN_DAYS,
  GUIDANCE_DAILY_CAP,
  GUIDANCE_PER_SURFACE_CAP,
  GUIDANCE_PRIORITY_ORDER,
  HOW_GUIDANCE,
  type FirstUseFeatureKey,
  type GuidancePriority,
  type HowGuidance,
} from './guidance-copy';

/**
 * G1.3 — contextual first-use guidance.
 *
 * ## Why "first use" is derived from learning state, not stored separately
 *
 * A dedicated delivery-state store would be a second state system (task §17)
 * and a dedicated guidance API is deferred (owner decision A2). Instead the
 * precondition of every guide is read from facts that already exist: zero
 * graded attempts means "has not practised yet", an empty wrong-question list
 * means "has not seen the wrong-question flow", and so on. Delivery *dismissal*
 * is a UI preference (localStorage), never learning state.
 *
 * Pure: no IO, no clock. The caller supplies facts + what has already been seen.
 */

export interface FirstUseFacts {
  /** Backend says onboarding/diagnostic is still outstanding. */
  readonly onboardingOutstanding: boolean;
  /** Graded practice attempts recorded for this student. */
  readonly gradedPracticeCount: number;
  readonly wrongQuestionCount: number;
  readonly reviewAttemptCount: number;
  /** True once any transfer-probe event exists for this student. */
  readonly hasProbeHistory: boolean;
  /** A probe is deliverable right now (education is most useful then). */
  readonly probeDeliverable: boolean;
  readonly paperSessionCount: number;
}

export interface ResolveFirstUseInput {
  readonly facts: FirstUseFacts;
  /** feature keys already shown (persisted client-side as a UI preference). */
  readonly seen: readonly FirstUseFeatureKey[];
  /** The student explicitly muted all usage tips. */
  readonly muted?: boolean;
}

function preconditionMet(featureKey: FirstUseFeatureKey, facts: FirstUseFacts): boolean {
  switch (featureKey) {
    case 'first_diagnostic':
      return facts.onboardingOutstanding;
    case 'first_practice':
      return !facts.onboardingOutstanding && facts.gradedPracticeCount === 0;
    case 'first_wrong_question':
      return facts.wrongQuestionCount > 0;
    case 'first_review':
      return facts.reviewAttemptCount === 0 && facts.wrongQuestionCount > 0;
    case 'first_transfer_probe':
      return facts.probeDeliverable || facts.hasProbeHistory;
    case 'first_mock_exam':
      return facts.paperSessionCount === 0 && facts.gradedPracticeCount > 0;
    default:
      return false;
  }
}

/**
 * Returns at most one contextual guide: the highest-priority unseen feature
 * whose precondition actually holds. Quiet is the default.
 */
export function resolveFirstUseGuidance(input: ResolveFirstUseInput): HowGuidance | null {
  if (input.muted) return null;
  const seen = new Set(input.seen);
  for (const featureKey of FIRST_USE_ORDER) {
    if (seen.has(featureKey)) continue;
    if (!preconditionMet(featureKey, input.facts)) continue;
    return HOW_GUIDANCE[featureKey];
  }
  return null;
}

// ------------------------------------------------- frequency control (task §16)

export interface GuidanceDeliveryState {
  /** triggerId → ISO timestamp of the last dismissal. */
  readonly dismissedAt: Readonly<Record<string, string>>;
  /** triggerId → ISO timestamp of the last time it was shown. */
  readonly shownAt: Readonly<Record<string, string>>;
  /** Total items shown on this calendar day. */
  readonly shownToday: number;
}

export interface GuidanceCandidate {
  readonly triggerId: string;
  readonly priority: GuidancePriority;
  /** 0 disables the cooldown (one-shot education). */
  readonly cooldownDays: number;
}

export const EMPTY_DELIVERY_STATE: GuidanceDeliveryState = {
  dismissedAt: {},
  shownAt: {},
  shownToday: 0,
};

function daysBetween(earlierIso: string, nowIso: string): number {
  const earlier = Date.parse(earlierIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(earlier) || Number.isNaN(now)) return Number.POSITIVE_INFINITY;
  return (now - earlier) / 86_400_000;
}

/**
 * Applies cooldown, frequency cap and priority ordering. Returns the candidates
 * that are allowed to render, strongest first, capped per surface and per day.
 * A dismissal is only honoured for its own trigger and only until its cooldown
 * expires — and a dismissal never suppresses a *different* trigger.
 */
export function selectDeliverableGuidance(
  candidates: readonly GuidanceCandidate[],
  state: GuidanceDeliveryState,
  nowIso: string,
  options: { perSurfaceCap?: number; dailyCap?: number } = {},
): GuidanceCandidate[] {
  const perSurfaceCap = options.perSurfaceCap ?? GUIDANCE_PER_SURFACE_CAP;
  const dailyCap = options.dailyCap ?? GUIDANCE_DAILY_CAP;
  const remainingToday = Math.max(0, dailyCap - state.shownToday);
  if (remainingToday === 0) return [];

  return [...candidates]
    .sort((left, right) =>
      GUIDANCE_PRIORITY_ORDER[left.priority] - GUIDANCE_PRIORITY_ORDER[right.priority]
      || left.triggerId.localeCompare(right.triggerId))
    .filter((candidate) => {
      const dismissedAt = state.dismissedAt[candidate.triggerId];
      if (dismissedAt) {
        if (candidate.cooldownDays <= 0) return false; // one-shot: permanent
        if (daysBetween(dismissedAt, nowIso) < candidate.cooldownDays) return false;
      }
      const shownAt = state.shownAt[candidate.triggerId];
      if (shownAt && candidate.cooldownDays > 0) {
        if (daysBetween(shownAt, nowIso) < candidate.cooldownDays) return false;
      }
      return true;
    })
    .slice(0, Math.min(perSurfaceCap, remainingToday));
}

/** Cooldown a trigger would use; exported so callers cannot invent their own. */
export function cooldownForTrigger(triggerId: string): number {
  return GUIDANCE_COOLDOWN_DAYS[triggerId] ?? 7;
}
