/**
 * V14-② — memory-card scheduling (pure, shared; task book
 * docs/v14-memory-card-design.md, Owner-approved 2026-09-26).
 *
 * Owner constraints this module implements (current-sprint.md 待启动任务②):
 *   1. ZERO second memory formula — stability reuse `updateStabilityAfterReview`
 *      and retention reuse `estimateRetention`, the same two functions the
 *      canonical mastery writer and forgetting-risk/priority consume.
 *   2. 三档自评 maps onto the controlled review semantics: 记住→quality 4,
 *      模糊→2, 没记住→0 (the same quality family applyReview uses for redo
 *      outcomes; self-assessment is weaker evidence so it never takes 5/3).
 *   3. 「距考越近排得越密」 consumes the ONE canonical exam-timeline resolver
 *      (`resolveDaysToExamTracked`); an unset exam date walks the single named
 *      fallback (96d) which stays LABELLED (`basis: 'fallback_constant'`).
 *
 * Semantic fences (contract, docs/development/score-mastery-evidence-semantics.md):
 *   - Card self-assessment is self_reported (weak) evidence. It schedules the
 *     CARD only. It never writes UserKnowledgeMastery, ReviewSchedule, or the
 *     evidence ledger, and never influences any ability estimate.
 *   - The density factor is a PRODUCT scheduling policy (no open-source
 *     precedent; task book §9), not a memory-science claim. It scales the
 *     review interval only — retention itself is always the shared formula.
 *   - Honesty: a never-reviewed card has retention `null`, never the 0.5
 *     unknown-prior that `estimateRetention` answers for missing input
 *     (unknown ≠ a measurement, RULE-06).
 *
 * Pure: no clock (`now` arrives as input), no IO.
 */

import { estimateRetention, updateStabilityAfterReview } from './mastery';
import type { ReviewQuality } from './types';
import { applyExamTimelineFallback, resolveDaysToExamTracked, type ExamTimelineBasis } from './exam-timeline';

// ---------------------------------------------------------------------------
// 三档自评 → controlled review quality
// ---------------------------------------------------------------------------

export type CardSelfRating = 'remembered' | 'fuzzy' | 'forgot';

/** 记住 / 模糊 / 没记住 — the student-facing three levels. */
export const MEMORY_CARD_RATING_LABELS: Record<CardSelfRating, string> = {
  remembered: '记住',
  fuzzy: '模糊',
  forgot: '没记住',
};

/**
 * Quality subset of the shared ReviewQuality table: 4 → ×1.7, 2 → ×1.0,
 * 0 → ×0.6 (STABILITY_MULTIPLIERS in ./mastery — same source as applyReview).
 */
export const MEMORY_CARD_RATING_QUALITY: Record<CardSelfRating, ReviewQuality> = {
  remembered: 4,
  fuzzy: 2,
  forgot: 0,
};

export function isCardSelfRating(value: unknown): value is CardSelfRating {
  return value === 'remembered' || value === 'fuzzy' || value === 'forgot';
}

export function cardQualityOf(rating: CardSelfRating): ReviewQuality {
  return MEMORY_CARD_RATING_QUALITY[rating];
}

/** Stability delta for one card self-assessment, via the shared multiplier. */
export function applyCardReviewStability(
  state: { stabilityDays: number | null },
  rating: CardSelfRating,
): { stabilityBefore: number | null; stabilityAfter: number } {
  const quality = MEMORY_CARD_RATING_QUALITY[rating];
  const stabilityBefore = state.stabilityDays;
  return { stabilityBefore, stabilityAfter: updateStabilityAfterReview(stabilityBefore, quality) };
}

// ---------------------------------------------------------------------------
// Exam-date density policy (D2 approved values)
// ---------------------------------------------------------------------------

export interface MemoryCardDensityPhase {
  readonly phase: 'relaxed' | 'standard' | 'intensified' | 'sprint';
  readonly label: string;
  /** Inclusive upper bound of days-to-exam for this phase. */
  readonly maxDays: number;
  readonly factor: number;
}

/**
 * PRODUCT scheduling policy (task book §3.4/§9): the farther the exam, the
 * looser the cadence. These are Owner-approved product parameters, not a
 * memory model — displayed and logged as policy, never as science.
 */
export const MEMORY_CARD_DENSITY_PHASES: readonly MemoryCardDensityPhase[] = [
  { phase: 'sprint', label: '冲刺加密', maxDays: 7, factor: 0.5 },
  { phase: 'intensified', label: '加密复习', maxDays: 30, factor: 0.7 },
  { phase: 'standard', label: '标准节奏', maxDays: 60, factor: 1.0 },
  { phase: 'relaxed', label: '远期放宽', maxDays: Number.POSITIVE_INFINITY, factor: 1.25 },
];

export interface CardDensity {
  readonly factor: number;
  readonly phase: MemoryCardDensityPhase['phase'];
  readonly phaseLabel: string;
  readonly daysToExam: number;
  readonly basis: ExamTimelineBasis;
  /** True when the 96-day named fallback stood in for an unset exam date. */
  readonly isFallback: boolean;
  readonly contextLabel: string;
}

function phaseForDays(days: number): MemoryCardDensityPhase {
  return MEMORY_CARD_DENSITY_PHASES.find((entry) => days <= entry.maxDays) ?? MEMORY_CARD_DENSITY_PHASES[MEMORY_CARD_DENSITY_PHASES.length - 1];
}

/**
 * Resolve the density from the canonical exam timeline. Unknown dates fall
 * back to the single named constant (96d, labelled) — with that value landing
 * in the standard band, an unset exam date is behaviourally neutral while
 * still honestly labelled in the UI.
 */
export function resolveCardDensity(input: {
  examDate?: Date | string | null;
  remainingDays?: number | null;
  now: Date | string;
}): CardDensity {
  const resolution = applyExamTimelineFallback(
    resolveDaysToExamTracked({
      examDate: input.examDate ?? null,
      remainingDays: input.remainingDays ?? null,
      now: input.now,
    }),
  );
  const phase = phaseForDays(resolution.days);
  const contextLabel = resolution.basis === 'fallback_constant'
    ? `考试日期未设置 · 按默认节奏（${phase.label}）`
    : `距离考试 ${resolution.days} 天 · ${phase.label}`;
  return {
    factor: phase.factor,
    phase: phase.phase,
    phaseLabel: phase.label,
    daysToExam: resolution.days,
    basis: resolution.basis,
    isFallback: resolution.basis === 'fallback_constant',
    contextLabel,
  };
}

// ---------------------------------------------------------------------------
// Interval composition
// ---------------------------------------------------------------------------

export const MEMORY_CARD_MIN_INTERVAL_DAYS = 0.5;
export const MEMORY_CARD_MAX_INTERVAL_DAYS = 365;

/** Schedule interval = stability × density, clamped so 没记住 resurfaces fast. */
export function nextCardInterval(stabilityDays: number, factor: number): number {
  const raw = stabilityDays * factor;
  return Math.min(
    MEMORY_CARD_MAX_INTERVAL_DAYS,
    Math.max(MEMORY_CARD_MIN_INTERVAL_DAYS, raw),
  );
}

export function nextCardReviewAt(reviewedAt: Date | string, intervalDays: number): Date {
  const base = reviewedAt instanceof Date ? reviewedAt.getTime() : new Date(reviewedAt).getTime();
  return new Date(base + intervalDays * 86_400_000);
}

// ---------------------------------------------------------------------------
// Retention (honest null for never-reviewed cards)
// ---------------------------------------------------------------------------

/**
 * Shared-formula retention for ONE card. `estimateRetention` answers 0.5 for
 * missing input; that is a prior, not a measurement, so a card without review
 * history reports `null` instead (same honesty rule as forgetting-risk).
 */
export function deriveCardRetention(
  state: { lastReviewedAt: string | null; stabilityDays: number | null },
  now: Date | string,
): number | null {
  if (!state.lastReviewedAt || state.stabilityDays == null) return null;
  return estimateRetention(new Date(state.lastReviewedAt), state.stabilityDays, now instanceof Date ? now : new Date(now));
}

// ---------------------------------------------------------------------------
// Full review application (the only math the service needs)
// ---------------------------------------------------------------------------

export interface MemoryCardReviewApplication {
  readonly quality: ReviewQuality;
  readonly stabilityBefore: number | null;
  readonly stabilityAfter: number;
  readonly densityFactor: number;
  readonly densityBasis: ExamTimelineBasis;
  readonly intervalDays: number;
  readonly nextReviewAt: Date;
}

export function applyMemoryCardReview(input: {
  state: { stabilityDays: number | null };
  rating: CardSelfRating;
  density: CardDensity;
  reviewedAt: Date;
}): MemoryCardReviewApplication {
  const { stabilityBefore, stabilityAfter } = applyCardReviewStability(input.state, input.rating);
  const intervalDays = nextCardInterval(stabilityAfter, input.density.factor);
  return {
    quality: MEMORY_CARD_RATING_QUALITY[input.rating],
    stabilityBefore,
    stabilityAfter,
    densityFactor: input.density.factor,
    densityBasis: input.density.basis,
    intervalDays,
    nextReviewAt: nextCardReviewAt(input.reviewedAt, intervalDays),
  };
}

// ---------------------------------------------------------------------------
// Due queue
// ---------------------------------------------------------------------------

export const MEMORY_CARD_SESSION_CAP = 20;
export const MEMORY_CARD_NEW_CARD_CAP = 10;

export interface QueueCardInput {
  readonly cardId: string;
  readonly knowledgeNodeId: string;
  readonly cardType: string;
  readonly front: string;
  readonly back: string;
  /** null = never reviewed (a new card). */
  readonly state: {
    readonly stabilityDays: number | null;
    readonly lastReviewedAt: string | null;
    readonly nextReviewAt: string | null;
  } | null;
}

export type CardQueuePhase = 'due' | 'new';

export interface MemoryCardQueueItem {
  readonly cardId: string;
  readonly knowledgeNodeId: string;
  readonly cardType: string;
  readonly front: string;
  readonly back: string;
  readonly phase: CardQueuePhase;
  /** null = not yet measured (new card or no stability history). */
  readonly retention: number | null;
}

function compareDue(left: { cardId: string; retention: number | null }, right: { cardId: string; retention: number | null }): number {
  if (left.retention == null && right.retention != null) return 1;
  if (right.retention == null && left.retention != null) return -1;
  if (left.retention != null && right.retention != null && left.retention !== right.retention) {
    return left.retention - right.retention;
  }
  return left.cardId.localeCompare(right.cardId);
}

/**
 * Deterministic review queue: due cards (nextReviewAt ≤ now) first, weakest
 * retention first (null last, ties by cardId), then new cards in input order.
 * Caps bind per the approved policy; summary counts report the FULL pool even
 * when the queue is capped.
 */
export function buildMemoryCardQueue(input: {
  cards: readonly QueueCardInput[];
  now: Date;
  sessionCap?: number;
  newCardCap?: number;
}): {
  queue: MemoryCardQueueItem[];
  summary: { dueCount: number; newCount: number; returned: number };
} {
  const sessionCap = input.sessionCap ?? MEMORY_CARD_SESSION_CAP;
  const newCardCap = input.newCardCap ?? MEMORY_CARD_NEW_CARD_CAP;

  const due: MemoryCardQueueItem[] = [];
  const fresh: MemoryCardQueueItem[] = [];
  let dueCount = 0;
  let newCount = 0;

  for (const card of input.cards) {
    if (card.state == null) {
      newCount += 1;
      if (fresh.length < newCardCap) {
        fresh.push({ cardId: card.cardId, knowledgeNodeId: card.knowledgeNodeId, cardType: card.cardType, front: card.front, back: card.back, phase: 'new', retention: null });
      }
      continue;
    }
    const dueAt = card.state.nextReviewAt ? new Date(card.state.nextReviewAt).getTime() : null;
    if (dueAt == null || dueAt > input.now.getTime()) continue;
    dueCount += 1;
    due.push({
      cardId: card.cardId,
      knowledgeNodeId: card.knowledgeNodeId,
      cardType: card.cardType,
      front: card.front,
      back: card.back,
      phase: 'due',
      retention: deriveCardRetention(card.state, input.now),
    });
  }

  due.sort(compareDue);
  const queue = [...due, ...fresh].slice(0, Math.max(0, sessionCap));
  return { queue, summary: { dueCount, newCount, returned: queue.length } };
}

// ---------------------------------------------------------------------------
// Intra-session retry (会话内重现, roadmap §2)
// ---------------------------------------------------------------------------

/**
 * Cards the student rated 没记住 resurface once at the END of the same
 * session (UI-session policy, roadmap docs/v14-memory-card-roadmap.md §2).
 * Pure bookkeeping: forgot ratings only, first-forgot order, each card at
 * most once per session no matter how often it is re-rated. This does NOT
 * change persisted scheduling — the backend review application is unchanged;
 * only the presentation order inside one session gains a tail round.
 */
export function collectIntraSessionRetries(
  evaluations: ReadonlyArray<{ cardId: string; rating: CardSelfRating }>,
): string[] {
  const ordered: string[] = [];
  const everForgotten = new Set<string>();
  for (const evaluation of evaluations) {
    if (evaluation.rating !== 'forgot') continue;
    if (!everForgotten.has(evaluation.cardId)) {
      everForgotten.add(evaluation.cardId);
      ordered.push(evaluation.cardId);
    }
  }
  return ordered;
}

/**
 * Catch-up pacing estimate for a backlog that exceeds one session
 * (roadmap §2 到期堆积摊平): ceil(dueCount ÷ sessionCap) days at the current
 * cap, or null when the backlog fits within one session (no plan needed).
 * DERIVED display fact only — it does not alter scheduling.
 */
export function estimateCatchUpDays(dueCount: number, sessionCap: number = MEMORY_CARD_SESSION_CAP): number | null {
  if (!Number.isFinite(dueCount) || dueCount <= sessionCap) return null;
  if (sessionCap <= 0) return null;
  return Math.ceil(dueCount / sessionCap);
}
