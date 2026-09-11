/**
 * V12-M3 — Review → Unified Mastery SHADOW pipeline (pure module).
 *
 * ## The product gap this pipeline closes (in shadow only)
 *
 * The M3 audit established that the review path never reaches the ability
 * estimate: `ScoreCenterService.applyReview` spreads the current mastery state
 * unchanged and writes only `retention` / `stabilityDays` / `lastReviewedAt` /
 * `nextReviewAt` (apps/api/src/score-center/service.ts:161-176). An observed
 * redo outcome is classified STRONG evidence by V12-M1
 * (`LEARNING_ACTION_TAXONOMY`, `review.recalled`) and is nonetheless invisible
 * to mastery.
 *
 * The decided-in-advance repair (C1, `MASTERY_SEMANTICS=c1`) is defensive: it
 * only constrains the direction of the EXISTING practice EMA. Switching it on
 * today changes nothing observable, because review observations never enter the
 * EMA at all. This module therefore does not touch the switch. It builds the
 * missing link as a shadow so the owner can see, on real data, what wiring
 * `review.recalled → mastery` would actually do.
 *
 * ## The boundary this module enforces (non-negotiable)
 *
 *   Review Event → Evidence Receipt → Evidence Projection → Mastery Shadow
 *
 * A review event reaches the mastery shadow ONLY when the evidence layer issued
 * a receipt for it. `Review → direct update of UserKnowledgeMastery` is not a
 * supported path here: there is no writer in this file, and the projection drops
 * any event whose receipt is absent (reported, never silently assumed).
 *
 * ## What is shadovelled and what is reused
 *
 * The mastery transition is NOT re-implemented — it is `applyMasteryModel` from
 * the approved candidate module, which for `production` is bit-identical to
 * `updateMasteryAfterAttempt`. A re-implementation is how two divergent 口径 get
 * created; a test asserts this module's node totals equal
 * `replayUnifiedReviewMastery`'s on identical inputs.
 *
 * Pure: no IO, no clock, no randomness. Every output carries
 * `authoritative: false`.
 */

import {
  classifyLearningAction,
  type EvidenceKind,
  type EvidenceStrength,
} from './learning-evidence';
import { applyMasteryModel, effectiveTargetFor } from './mastery-candidate';
import {
  REVIEW_CONVERGENCE_EPSILON,
  type ReplayDirection,
  type ReviewMasteryBaseline,
  type StoredNodeMastery,
} from './review-semantics';
import type { MasteryModelId } from './mastery-semantics';
import type { AttemptSignal, MasteryState } from './types';

/** A single review step is a real numeric change unless it is exactly zero. */
export const REVIEW_STEP_EPSILON = 1e-9;
/** Neutral seed, identical to `neutralMastery()` in production. */
const NEUTRAL_MASTERY = 0.5;

// ---------------------------------------------------------------------------
// Phase 3 — the evidence boundary
// ---------------------------------------------------------------------------

/**
 * A review occurrence as it exists in the source-of-truth table. One row per
 * `ReviewAttempt`; this is the only complete record of how many reviews
 * happened, so the pipeline is driven by it and reconciled against receipts.
 */
export interface ReviewEventFact {
  readonly reviewEventId: string;
  readonly scheduleId: string;
  readonly questionId: string;
  /** Resolved by the assembly layer (question → PRIMARY-preferred node). */
  readonly nodeId: string | null;
  readonly reviewedAt: string;
  readonly redoCorrect: boolean;
  readonly difficulty: number;
  /**
   * Whether the authoritative writer ran for this redo (`applyReview` is called
   * only when the caller passed `isReview`). `null` means the system does not
   * record it per attempt — which is itself a finding, so it is reported as
   * unknown rather than assumed.
   */
  readonly scheduledReview: boolean | null;
}

/** An `EVIDENCE_RECORDED` receipt for a review action, as stored. */
export interface ReviewEvidenceReceiptFact {
  readonly receiptId: string;
  readonly action: 'review.recalled' | 'review.marked';
  readonly questionId: string;
  readonly recordedAt: string;
  readonly scope: string | null;
  readonly kind: EvidenceKind;
  readonly strength: EvidenceStrength;
  readonly canInfluenceMastery: boolean;
}

export interface ProjectedReviewObservation {
  readonly reviewEventId: string;
  readonly scheduleId: string;
  readonly questionId: string;
  readonly nodeId: string;
  readonly reviewedAt: string;
  readonly redoCorrect: boolean;
  readonly difficulty: number;
  readonly scheduledReview: boolean | null;
  readonly receiptId: string | null;
  /** How the receipt was attached. `none` means no receipt was issued. */
  readonly receiptMatch: 'exact' | 'day_scope' | 'coalesced_day_scope' | 'none';
  readonly evidenceKind: EvidenceKind;
  readonly evidenceStrength: EvidenceStrength;
  /** The published V12-M1 taxonomy verdict for an observed recall. */
  readonly taxonomyCanInfluenceMastery: boolean;
  /** Receipt present AND the taxonomy allows an ability inference. */
  readonly eligibleForMastery: boolean;
  readonly basis: string;
}

export interface ReviewEvidenceReconciliation {
  readonly events: number;
  readonly eventsResolvedToNode: number;
  readonly eventsWithoutNode: number;
  readonly eventsWithReceipt: number;
  readonly eventsWithoutReceipt: number;
  readonly receiptsProvided: number;
  readonly recalledReceipts: number;
  readonly markedReceipts: number;
  readonly receiptsMatched: number;
  readonly receiptsOrphaned: number;
  /**
   * Receipts attached to more than one review event. The ledger's event key is
   * scoped by day (`LEARNING_EVIDENCE:{user}:review.recalled:{question}:{day}`),
   * so several reviews of one question on one day share a single receipt. The
   * multiplicity lives in the attempt rows; the receipt attests the day.
   */
  readonly coalescedReceipts: number;
  readonly maxEventsPerReceipt: number;
  /**
   * Observed reviews the system KNOWS did not reach `applyReview`, plus those
   * whose scheduling status it does not record at all. Reported separately so an
   * unknown is never read as a zero.
   */
  readonly observedNotScheduled: number;
  readonly scheduleUnknown: number;
  readonly authoritative: false;
  readonly basis: string;
}

export interface ReviewEvidenceProjection {
  readonly observations: readonly ProjectedReviewObservation[];
  readonly reconciliation: ReviewEvidenceReconciliation;
  readonly unresolved: readonly {
    readonly reviewEventId: string;
    readonly questionId: string;
    readonly reason: string;
  }[];
  readonly authoritative: false;
}

export function reviewEventIdOf(input: {
  readonly attemptId?: string | null;
  readonly scheduleId: string;
  readonly questionId: string;
  readonly reviewedAt: string;
  readonly idempotencyKey?: string | null;
}): string {
  if (input.attemptId) return `review-attempt:${input.attemptId}`;
  const key = input.idempotencyKey ? `:${input.idempotencyKey}` : '';
  return `review-attempt:${input.scheduleId}:${input.questionId}:${input.reviewedAt}${key}`;
}

/**
 * Project review events through the evidence boundary.
 *
 * Matching is two-pass and deterministic:
 *  1. exact `recordedAt === reviewedAt` on the same question, one-to-one;
 *  2. same question and same day scope, many-to-one, flagged as `coalesced`.
 *
 * The second pass exists because the ledger genuinely cannot represent two
 * reviews of one question on one day. Dropping those events would understate the
 * review history; silently inventing receipts would fake the boundary. So the
 * shared receipt is attached to each event and the coalescing is counted.
 */
export function projectReviewEvidence(input: {
  readonly events: readonly ReviewEventFact[];
  readonly receipts: readonly ReviewEvidenceReceiptFact[];
}): ReviewEvidenceProjection {
  const events = [...input.events].sort((left, right) => left.reviewedAt.localeCompare(right.reviewedAt));
  const receipts = [...input.receipts];

  const claimed = new Set<string>();
  const matchByEvent = new Map<string, { receipt: ReviewEvidenceReceiptFact; kind: 'exact' | 'day_scope' }>();

  // Pass 1 — exact timestamp match, one receipt per event.
  for (const event of events) {
    const receipt = receipts.find(
      (row) =>
        !claimed.has(row.receiptId)
        && row.action === 'review.recalled'
        && row.questionId === event.questionId
        && row.recordedAt === event.reviewedAt,
    );
    if (receipt) {
      claimed.add(receipt.receiptId);
      matchByEvent.set(event.reviewEventId, { receipt, kind: 'exact' });
    }
  }

  // Pass 2 — day-scoped match; a receipt may legitimately cover several events.
  for (const event of events) {
    if (matchByEvent.has(event.reviewEventId)) continue;
    const day = event.reviewedAt.slice(0, 10);
    const receipt = receipts.find(
      (row) =>
        row.action === 'review.recalled'
        && row.questionId === event.questionId
        && (row.scope === day || row.recordedAt.slice(0, 10) === day),
    );
    if (receipt) matchByEvent.set(event.reviewEventId, { receipt, kind: 'day_scope' });
  }

  const usageByReceipt = new Map<string, number>();
  for (const match of matchByEvent.values()) {
    usageByReceipt.set(match.receipt.receiptId, (usageByReceipt.get(match.receipt.receiptId) ?? 0) + 1);
  }

  const taxonomy = classifyLearningAction({ action: 'review.recalled', recallObserved: true });
  const observations: ProjectedReviewObservation[] = [];
  const unresolved: Array<{ reviewEventId: string; questionId: string; reason: string }> = [];

  for (const event of events) {
    if (!event.nodeId) {
      unresolved.push({
        reviewEventId: event.reviewEventId,
        questionId: event.questionId,
        reason: '该题没有可解析的知识节点（缺 QuestionKnowledgeNodeTag），无法进入掌握度影子。',
      });
      continue;
    }
    const match = matchByEvent.get(event.reviewEventId) ?? null;
    const usage = match ? usageByReceipt.get(match.receipt.receiptId) ?? 1 : 0;
    const receiptMatch: ProjectedReviewObservation['receiptMatch'] = !match
      ? 'none'
      : match.kind === 'exact'
        ? 'exact'
        : usage > 1
          ? 'coalesced_day_scope'
          : 'day_scope';
    const eligible = match != null && taxonomy.canInfluenceMastery;
    observations.push({
      reviewEventId: event.reviewEventId,
      scheduleId: event.scheduleId,
      questionId: event.questionId,
      nodeId: event.nodeId,
      reviewedAt: event.reviewedAt,
      redoCorrect: event.redoCorrect,
      difficulty: event.difficulty,
      scheduledReview: event.scheduledReview,
      receiptId: match?.receipt.receiptId ?? null,
      receiptMatch,
      evidenceKind: match?.receipt.kind ?? 'none',
      evidenceStrength: match?.receipt.strength ?? 'none',
      taxonomyCanInfluenceMastery: taxonomy.canInfluenceMastery,
      eligibleForMastery: eligible,
      basis: describeProjection(event, match?.receipt ?? null, receiptMatch, eligible, taxonomy.basis),
    });
  }

  const matchedReceiptIds = new Set([...matchByEvent.values()].map((row) => row.receipt.receiptId));
  const recalledReceipts = receipts.filter((row) => row.action === 'review.recalled').length;
  const markedReceipts = receipts.filter((row) => row.action === 'review.marked').length;
  const coalescedReceipts = [...usageByReceipt.values()].filter((count) => count > 1).length;
  const maxEventsPerReceipt = usageByReceipt.size > 0 ? Math.max(...usageByReceipt.values()) : 0;
  const eventsWithReceipt = observations.filter((row) => row.receiptId != null).length;
  const eventsWithoutReceipt = observations.length - eventsWithReceipt;
  const observedNotScheduled = observations.filter((row) => row.scheduledReview === false).length;
  const scheduleUnknown = observations.filter((row) => row.scheduledReview == null).length;

  return {
    observations,
    unresolved,
    reconciliation: {
      events: events.length,
      eventsResolvedToNode: observations.length,
      eventsWithoutNode: unresolved.length,
      eventsWithReceipt,
      eventsWithoutReceipt,
      receiptsProvided: receipts.length,
      recalledReceipts,
      markedReceipts,
      receiptsMatched: matchedReceiptIds.size,
      receiptsOrphaned: recalledReceipts - matchedReceiptIds.size,
      coalescedReceipts,
      maxEventsPerReceipt,
      observedNotScheduled,
      scheduleUnknown,
      authoritative: false,
      basis: events.length === 0
        ? '窗口内没有复习事件，证据投影为空。'
        : `投影 ${events.length} 个复习事件：${observations.length} 个解析到知识节点、${eventsWithReceipt} 个附带证据回执、${eventsWithoutReceipt} 个缺回执（不进入掌握度影子）；`
          + `回执 ${receipts.length} 条（回忆结果 ${recalledReceipts}、仅标记 ${markedReceipts}），其中 ${coalescedReceipts} 条被同日多次复习共用（台账事件键按天去重）；`
          + `其中 ${observedNotScheduled} 个已知未走排程复习、${scheduleUnknown} 个排程状态未记录。结果非权威。`,
    },
    authoritative: false,
  };
}

function describeProjection(
  event: ReviewEventFact,
  receipt: ReviewEvidenceReceiptFact | null,
  match: ProjectedReviewObservation['receiptMatch'],
  eligible: boolean,
  taxonomyBasis: string,
): string {
  const outcome = event.redoCorrect ? '重做正确' : '重做错误';
  if (!receipt) {
    return `${event.reviewedAt} 观测到${outcome}，但证据台账没有对应回执，按边界规则不参与掌握度影子。`;
  }
  const shared = match === 'coalesced_day_scope' ? '（同日多次复习共用一条按天去重的回执）' : '';
  const verdict = eligible
    ? '构成强证据，可进入统一掌握度影子。'
    : '该回执不允许能力推断，不进入掌握度影子。';
  return `${event.reviewedAt} 观测到${outcome}${shared}；回执 ${receipt.receiptId}（${receipt.kind}/${receipt.strength}）：${taxonomyBasis}${verdict}`;
}

// ---------------------------------------------------------------------------
// Phase 3/4 — per-event mastery shadow
// ---------------------------------------------------------------------------

export type MasteryStepDirection = 'up' | 'down' | 'unchanged';

export interface ReviewMasteryEventRow {
  readonly reviewEventId: string;
  readonly nodeId: string;
  readonly questionId: string;
  readonly reviewedAt: string;
  readonly observedResult: boolean;
  readonly difficulty: number;
  /** Mastery immediately before this event, inside the shadow trajectory. */
  readonly masteryBefore: number;
  /** Shadow mastery immediately after this event. */
  readonly shadowMastery: number;
  /** This event's own contribution. */
  readonly masteryStepDelta: number;
  /** Cumulative divergence from the authoritative value after this event. */
  readonly masteryDelta: number;
  /** The canonical model's target for this observation (from the model itself). */
  readonly canonicalTarget: number;
  readonly direction: MasteryStepDirection;
  readonly model: MasteryModelId;
  readonly basis: string;
}

export interface ReviewMasteryNodeRow {
  readonly nodeId: string;
  readonly events: number;
  readonly eligibleEvents: number;
  readonly skippedEvents: number;
  readonly correctEvents: number;
  readonly baselineMastery: number;
  readonly baselineSource: 'snapshot' | 'neutral';
  readonly shadowMastery: number;
  readonly authoritativeMastery: number | null;
  readonly masteryDelta: number | null;
  readonly direction: ReplayDirection;
  readonly finalState: MasteryState;
  readonly basis: string;
}

/**
 * The unrounded trajectory. Public event rows round to 4 dp for reading, which
 * would make an exact fidelity audit compare rounded-to-raw values and report
 * noise as failure. The audit therefore uses this trace, where the second step's
 * input is the first step's true output.
 */
export interface ReviewMasteryTraceStep {
  readonly reviewEventId: string;
  readonly beforeRaw: number;
  readonly afterRaw: number;
}

export interface ReviewMasteryTrace {
  readonly nodeId: string;
  readonly baselineRaw: number;
  readonly finalRaw: number;
  readonly steps: readonly ReviewMasteryTraceStep[];
}

export interface ReviewMasteryShadow {
  readonly model: MasteryModelId;
  readonly eventRows: readonly ReviewMasteryEventRow[];
  readonly nodeRows: readonly ReviewMasteryNodeRow[];
  readonly trace: readonly ReviewMasteryTrace[];
  readonly summary: {
    readonly nodes: number;
    readonly eventsReplayed: number;
    readonly eventsEligible: number;
    readonly eventsSkipped: number;
    readonly correctEvents: number;
    readonly incorrectEvents: number;
    /** Correct reviews that the canonical model nonetheless moved down. */
    readonly correctLowered: number;
    /** Incorrect reviews that the canonical model nonetheless moved up. */
    readonly incorrectRaised: number;
    readonly nodesChanged: number;
    readonly maxAbsNodeDelta: number;
    readonly authoritative: false;
    readonly basis: string;
  };
  readonly authoritative: false;
}

export function buildReviewMasteryShadow(input: {
  readonly observations: readonly ProjectedReviewObservation[];
  readonly baselines?: readonly ReviewMasteryBaseline[];
  readonly authoritative?: readonly StoredNodeMastery[];
  readonly baselineApproximated?: boolean;
  readonly model?: MasteryModelId;
}): ReviewMasteryShadow {
  const model = input.model ?? 'production';
  const baselineByNode = new Map((input.baselines ?? []).map((row) => [row.nodeId, row]));
  const authoritativeByNode = new Map((input.authoritative ?? []).map((row) => [row.nodeId, row]));

  // Only an evidence-backed observation may reach the mastery engine.
  const eligible = input.observations.filter((row) => row.eligibleForMastery);
  const skipped = input.observations.filter((row) => !row.eligibleForMastery);

  const byNode = new Map<string, ProjectedReviewObservation[]>();
  for (const observation of eligible) {
    const list = byNode.get(observation.nodeId) ?? [];
    list.push(observation);
    byNode.set(observation.nodeId, list);
  }

  const skippedByNode = new Map<string, number>();
  for (const observation of skipped) {
    skippedByNode.set(observation.nodeId, (skippedByNode.get(observation.nodeId) ?? 0) + 1);
  }

  const nodeIds = new Set<string>([...byNode.keys(), ...skippedByNode.keys()]);
  const eventRows: ReviewMasteryEventRow[] = [];
  const nodeRows: ReviewMasteryNodeRow[] = [];
  const trace: ReviewMasteryTrace[] = [];

  for (const nodeId of nodeIds) {
    const nodeEvents = (byNode.get(nodeId) ?? [])
      .slice()
      .sort((left, right) => left.reviewedAt.localeCompare(right.reviewedAt));
    const baseline = baselineByNode.get(nodeId) ?? null;
    const authoritative = authoritativeByNode.get(nodeId) ?? null;

    let state: MasteryState = baseline
      ? {
          mastery: baseline.mastery,
          accuracy: baseline.accuracy,
          recentAccuracy: baseline.recentAccuracy,
          attempts: baseline.attempts,
          correctCount: baseline.correctCount,
          wrongCount: baseline.wrongCount,
          confidence: baseline.confidence,
        }
      : neutralState();

    const baselineMastery = state.mastery;
    const authoritativeMastery = authoritative ? round4(authoritative.mastery) : null;
    const traceSteps: ReviewMasteryTraceStep[] = [];

    for (const event of nodeEvents) {
      const before = state.mastery;
      const signal: AttemptSignal = {
        isCorrect: event.redoCorrect,
        difficulty: clampDifficulty(event.difficulty),
        role: 'PRIMARY',
      };
      const canonicalTarget = effectiveTargetFor(model, state, signal);
      const after = applyMasteryModel(model, state, signal);
      const step = after.mastery - before;
      const cumulative = authoritativeMastery == null ? null : round4(after.mastery - authoritativeMastery);
      traceSteps.push({ reviewEventId: event.reviewEventId, beforeRaw: before, afterRaw: after.mastery });

      eventRows.push({
        reviewEventId: event.reviewEventId,
        nodeId,
        questionId: event.questionId,
        reviewedAt: event.reviewedAt,
        observedResult: event.redoCorrect,
        difficulty: clampDifficulty(event.difficulty),
        masteryBefore: round4(before),
        shadowMastery: round4(after.mastery),
        masteryStepDelta: round4(step),
        masteryDelta: cumulative ?? round4(step),
        canonicalTarget,
        direction: step > REVIEW_STEP_EPSILON ? 'up' : step < -REVIEW_STEP_EPSILON ? 'down' : 'unchanged',
        model,
        basis: `${event.reviewedAt} 复习${event.redoCorrect ? '正确' : '错误'}（难度 ${clampDifficulty(event.difficulty)}）：掌握度 ${round4(before)} → ${round4(after.mastery)}（步进 ${round4(step)}，统一语义目标 ${canonicalTarget}）。`,
      });

      state = after;
    }

    const correctEvents = nodeEvents.filter((row) => row.redoCorrect).length;
    const shadowMastery = round4(state.mastery);
    trace.push({ nodeId, baselineRaw: baselineMastery, finalRaw: state.mastery, steps: traceSteps });
    const delta = authoritativeMastery == null ? null : round4(shadowMastery - authoritativeMastery);
    const direction: ReplayDirection = delta == null
      ? 'insufficient_data'
      : Math.abs(delta) <= REVIEW_CONVERGENCE_EPSILON
        ? 'converged'
        : delta > 0
          ? 'unified_higher'
          : 'unified_lower';

    nodeRows.push({
      nodeId,
      events: nodeEvents.length + (skippedByNode.get(nodeId) ?? 0),
      eligibleEvents: nodeEvents.length,
      skippedEvents: skippedByNode.get(nodeId) ?? 0,
      correctEvents,
      baselineMastery: round4(baselineMastery),
      baselineSource: baseline ? 'snapshot' : 'neutral',
      shadowMastery,
      authoritativeMastery,
      masteryDelta: delta,
      direction,
      finalState: state,
      basis: nodeEvents.length === 0
        ? `该节点的 ${skippedByNode.get(nodeId) ?? 0} 个复习事件缺证据回执，未进入掌握度影子，呈现权威值不变。`
        : `重放 ${nodeEvents.length} 次复习观测（正确 ${correctEvents} 次），基线 ${round4(baselineMastery)}${baseline ? '（日快照）' : '（中立初值）'} → 影子 ${shadowMastery}`
          + (delta == null ? '；无权威值可对比。' : `；与权威值相差 ${delta}。`),
    });
  }

  const correctLowered = eventRows.filter((row) => row.observedResult && row.direction === 'down').length;
  const incorrectRaised = eventRows.filter((row) => !row.observedResult && row.direction === 'up').length;
  const nodesChanged = nodeRows.filter(
    (row) => row.masteryDelta != null && Math.abs(row.masteryDelta) > REVIEW_CONVERGENCE_EPSILON,
  ).length;
  const deltas = nodeRows
    .map((row) => row.masteryDelta)
    .filter((value): value is number => value != null);
  const maxAbsNodeDelta = deltas.length > 0 ? round4(Math.max(...deltas.map(Math.abs))) : 0;

  return {
    model,
    eventRows,
    nodeRows,
    trace,
    summary: {
      nodes: nodeRows.length,
      eventsReplayed: eventRows.length,
      eventsEligible: eligible.length,
      eventsSkipped: skipped.length,
      correctEvents: eventRows.filter((row) => row.observedResult).length,
      incorrectEvents: eventRows.filter((row) => !row.observedResult).length,
      correctLowered,
      incorrectRaised,
      nodesChanged,
      maxAbsNodeDelta,
      authoritative: false,
      basis: eventRows.length === 0
        ? `没有带证据回执的复习观测，掌握度影子为空（模型 ${model}）。`
        : `以 ${model} 语义重放 ${eventRows.length} 个复习事件、覆盖 ${nodeRows.length} 个节点：${nodesChanged} 个节点与权威掌握度不同，最大差异 ${maxAbsNodeDelta}；`
          + `过程中 ${correctLowered} 次正确复习被下压、${incorrectRaised} 次错误复习被上抬（这是现行 EMA 在估计值位于语义目标另一侧时的固有行为，非本次接线引入）。结果非权威，未写任何表。`,
    },
    authoritative: false,
  };
}

// ---------------------------------------------------------------------------
// Phase 5/8/9 — dataset joined to the downstream decision chain
// ---------------------------------------------------------------------------

export interface ReviewDownstreamFact {
  readonly nodeId: string;
  readonly observedPriority: number | null;
  readonly shadowPriority: number | null;
  readonly observedOpportunity: number | null;
  readonly shadowOpportunity: number | null;
  readonly observedRank: number | null;
  readonly shadowRank: number | null;
  /** Human-readable provenance from the decision-chain shadow, if any. */
  readonly attributionBasis?: string | null;
}

/** The link names every row's provenance must contain, in order. */
export const REVIEW_ATTRIBUTION_CHAIN = [
  'review.recalled',
  'mastery',
  'priority',
  'opportunity',
  'recommendation',
] as const;

export interface ReviewIntegrationDatasetRow {
  readonly studentId: string;
  readonly nodeId: string;
  readonly reviewEventId: string;
  readonly reviewedAt: string;
  readonly observedResult: boolean;
  readonly observedMastery: number | null;
  readonly reviewShadowMastery: number;
  readonly masteryStepDelta: number;
  readonly masteryDelta: number;
  readonly masteryDirection: MasteryStepDirection;
  readonly observedPriority: number | null;
  readonly shadowPriority: number | null;
  readonly priorityDelta: number | null;
  readonly observedOpportunity: number | null;
  readonly shadowOpportunity: number | null;
  readonly opportunityDelta: number | null;
  readonly observedRank: number | null;
  readonly shadowRank: number | null;
  readonly rankDelta: number | null;
  readonly confidence: number;
  /**
   * Machine-checkable provenance: the first link is always the review event
   * that caused the step, followed by each downstream link that actually moved.
   * Computed from the deltas, not copied from prose, so "attributed" is a
   * structural fact.
   */
  readonly attribution: readonly string[];
  /** The decision-chain shadow's own explanation, when it covered this node. */
  readonly attributionBasis: string | null;
  readonly authoritative: false;
}

export interface DeltaDistribution {
  readonly count: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly median: number;
  readonly p90: number;
  readonly absMean: number;
  readonly nonZero: number;
}

export interface RankChangeRow {
  readonly nodeId: string;
  readonly observedRank: number | null;
  readonly shadowRank: number | null;
  readonly rankDelta: number | null;
}

export interface ReviewIntegrationDataset {
  readonly generatedAt: string;
  readonly studentId: string;
  readonly model: MasteryModelId;
  readonly authoritative: false;
  readonly rows: readonly ReviewIntegrationDatasetRow[];
  readonly summary: {
    readonly nodes: number;
    readonly events: number;
    readonly attributedEvents: number;
    readonly attributionComplete: boolean;
    readonly affectedNodes: number;
    readonly affectedNodeRatio: number;
    readonly masteryDelta: DeltaDistribution | null;
    readonly priorityDelta: DeltaDistribution | null;
    readonly opportunityDelta: DeltaDistribution | null;
    readonly rankChanges: number;
    readonly maxAbsRankChange: number;
    readonly topRankChanges: readonly RankChangeRow[];
    readonly confidenceMean: number | null;
    readonly authoritative: false;
    readonly basis: string;
  };
}

/**
 * Join the per-event mastery trajectory with the node-level downstream shadow.
 *
 * Priority / opportunity / rank are node-level quantities, so every event of a
 * node carries that node's downstream delta. `masteryDelta` is the CUMULATIVE
 * divergence after the event (what the owner would observe at that moment);
 * `masteryStepDelta` is what this event alone contributed, so each delta stays
 * traceable to a single review event.
 */
export function joinReviewIntegrationDataset(input: {
  readonly studentId: string;
  readonly shadow: ReviewMasteryShadow;
  readonly downstream: readonly ReviewDownstreamFact[];
  readonly generatedAt: string;
  readonly confidenceByNode?: Readonly<Record<string, number>>;
}): ReviewIntegrationDataset {
  const downstreamByNode = new Map(input.downstream.map((row) => [row.nodeId, row]));
  const nodeById = new Map(input.shadow.nodeRows.map((row) => [row.nodeId, row]));

  const rows: ReviewIntegrationDatasetRow[] = input.shadow.eventRows.map((event) => {
    const node = nodeById.get(event.nodeId);
    const downstream = downstreamByNode.get(event.nodeId) ?? null;
    const observedMastery = node?.authoritativeMastery ?? null;
    const rankDelta =
      downstream?.observedRank != null && downstream?.shadowRank != null
        ? downstream.shadowRank - downstream.observedRank
        : null;
    const priorityDelta = subtract(downstream?.shadowPriority ?? null, downstream?.observedPriority ?? null);
    const opportunityDelta = subtract(downstream?.shadowOpportunity ?? null, downstream?.observedOpportunity ?? null);
    return {
      studentId: input.studentId,
      nodeId: event.nodeId,
      reviewEventId: event.reviewEventId,
      reviewedAt: event.reviewedAt,
      observedResult: event.observedResult,
      observedMastery,
      reviewShadowMastery: event.shadowMastery,
      masteryStepDelta: event.masteryStepDelta,
      masteryDelta: event.masteryDelta,
      masteryDirection: event.direction,
      observedPriority: downstream?.observedPriority ?? null,
      shadowPriority: downstream?.shadowPriority ?? null,
      priorityDelta,
      observedOpportunity: downstream?.observedOpportunity ?? null,
      shadowOpportunity: downstream?.shadowOpportunity ?? null,
      opportunityDelta,
      observedRank: downstream?.observedRank ?? null,
      shadowRank: downstream?.shadowRank ?? null,
      rankDelta,
      confidence: input.confidenceByNode?.[event.nodeId] ?? 0,
      attribution: buildAttribution({
        reviewEventId: event.reviewEventId,
        masteryStepDelta: event.masteryStepDelta,
        priorityDelta,
        opportunityDelta,
        rankDelta,
      }),
      attributionBasis: downstream?.attributionBasis ?? null,
      authoritative: false,
    };
  });

  const nodeRows = input.shadow.nodeRows;
  const affectedNodes = nodeRows.filter(
    (row) => row.masteryDelta != null && Math.abs(row.masteryDelta) > REVIEW_CONVERGENCE_EPSILON,
  ).length;

  const masteryDistribution = summarizeDeltas(
    nodeRows.map((row) => row.masteryDelta).filter((value): value is number => value != null),
  );
  const priorityDistribution = summarizeDeltas(
    input.downstream.map((row) => subtract(row.shadowPriority, row.observedPriority)).filter((v): v is number => v != null),
  );
  const opportunityDistribution = summarizeDeltas(
    input.downstream.map((row) => subtract(row.shadowOpportunity, row.observedOpportunity)).filter((v): v is number => v != null),
  );

  const rankChanges = rows.filter((row) => row.rankDelta != null && row.rankDelta !== 0);
  // Deduplicated by node, largest |delta| first: rank is a node-level quantity,
  // so listing the same node once per review event would misreport what moved.
  const byNodeRank = new Map<string, ReviewIntegrationDatasetRow>();
  for (const row of [...rankChanges].sort(
    (left, right) => Math.abs(right.rankDelta ?? 0) - Math.abs(left.rankDelta ?? 0),
  )) {
    if (!byNodeRank.has(row.nodeId)) byNodeRank.set(row.nodeId, row);
  }
  const topRankChanges = [...byNodeRank.values()].slice(0, 10).map((row) => ({
    nodeId: row.nodeId,
    observedRank: row.observedRank,
    shadowRank: row.shadowRank,
    rankDelta: row.rankDelta,
  }));

  const confidences = input.downstream
    .map((row) => input.confidenceByNode?.[row.nodeId])
    .filter((value): value is number => typeof value === 'number');
  const confidenceMean = confidences.length > 0
    ? round4(confidences.reduce((sum, value) => sum + value, 0) / confidences.length)
    : null;

  // A row is fully attributed when its provenance starts at a review event AND
  // the downstream shadow actually covered the node. A node the chain never
  // reached is reported as incomplete rather than assumed unchanged.
  const attributedEvents = rows.filter(
    (row) => row.attribution[0]?.startsWith('review.recalled:') && row.attributionBasis != null,
  ).length;
  const attributionComplete = rows.length === 0 ? true : attributedEvents === rows.length;

  return {
    generatedAt: input.generatedAt,
    studentId: input.studentId,
    model: input.shadow.model,
    authoritative: false,
    rows,
    summary: {
      nodes: nodeRows.length,
      events: rows.length,
      attributedEvents,
      attributionComplete,
      affectedNodes,
      affectedNodeRatio: nodeRows.length > 0 ? round4(affectedNodes / nodeRows.length) : 0,
      masteryDelta: masteryDistribution,
      priorityDelta: priorityDistribution,
      opportunityDelta: opportunityDistribution,
      rankChanges: rankChanges.length,
      maxAbsRankChange: rankChanges.length > 0
        ? Math.max(...rankChanges.map((row) => Math.abs(row.rankDelta ?? 0)))
        : 0,
      topRankChanges,
      confidenceMean,
      authoritative: false,
      basis: rows.length === 0
        ? '没有可归因的复习事件，决策数据集为空。'
        : `${nodeRows.length} 个节点 / ${rows.length} 个复习事件：${affectedNodes} 个节点掌握度受影响（比例 ${nodeRows.length > 0 ? round4(affectedNodes / nodeRows.length) : 0}），`
          + `排名变化 ${rankChanges.length} 处，归因完整 ${attributionComplete ? '是' : `否（${rows.length - attributedEvents} 条缺归因）`}。结果非权威，未写任何表。`,
    },
  };
}

export function summarizeDeltas(values: readonly number[]): DeltaDistribution | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  return {
    count: sorted.length,
    min: round4(sorted[0]),
    max: round4(sorted[sorted.length - 1]),
    mean: round4(sum / sorted.length),
    median: round4(quantile(sorted, 0.5)),
    p90: round4(quantile(sorted, 0.9)),
    absMean: round4(sorted.reduce((acc, value) => acc + Math.abs(value), 0) / sorted.length),
    nonZero: sorted.filter((value) => Math.abs(value) > REVIEW_CONVERGENCE_EPSILON).length,
  };
}

// ---------------------------------------------------------------------------
// Phase 6/9 — cohort aggregate
// ---------------------------------------------------------------------------

export interface ReviewIntegrationCohortAggregate {
  readonly students: number;
  readonly studentsWithReviewHistory: number;
  readonly studentsAffected: number;
  readonly affectedStudentRatio: number;
  readonly nodes: number;
  readonly affectedNodes: number;
  readonly affectedNodeRatio: number;
  readonly events: number;
  readonly attributionComplete: boolean;
  readonly masteryDelta: DeltaDistribution | null;
  readonly priorityDelta: DeltaDistribution | null;
  readonly opportunityDelta: DeltaDistribution | null;
  readonly rankChanges: number;
  readonly authoritative: false;
  readonly basis: string;
}

export function aggregateReviewIntegrationCohort(
  datasets: readonly ReviewIntegrationDataset[],
): ReviewIntegrationCohortAggregate {
  const withHistory = datasets.filter((row) => row.summary.events > 0);
  const affectedStudents = withHistory.filter((row) => row.summary.affectedNodes > 0).length;
  const nodes = datasets.reduce((sum, row) => sum + row.summary.nodes, 0);
  const affectedNodes = datasets.reduce((sum, row) => sum + row.summary.affectedNodes, 0);
  const events = datasets.reduce((sum, row) => sum + row.summary.events, 0);

  const masteryValues = datasets
    .flatMap((row) => row.rows.map((event) => event.masteryDelta));
  const priorityValues = datasets
    .flatMap((row) => row.rows.map((event) => event.priorityDelta))
    .filter((value): value is number => value != null);
  const opportunityValues = datasets
    .flatMap((row) => row.rows.map((event) => event.opportunityDelta))
    .filter((value): value is number => value != null);

  const attributionComplete = datasets.every((row) => row.summary.attributionComplete);
  const rankChanges = datasets.reduce((sum, row) => sum + row.summary.rankChanges, 0);

  return {
    students: datasets.length,
    studentsWithReviewHistory: withHistory.length,
    studentsAffected: affectedStudents,
    affectedStudentRatio: withHistory.length > 0 ? round4(affectedStudents / withHistory.length) : 0,
    nodes,
    affectedNodes,
    affectedNodeRatio: nodes > 0 ? round4(affectedNodes / nodes) : 0,
    events,
    attributionComplete,
    masteryDelta: summarizeDeltas(masteryValues),
    priorityDelta: summarizeDeltas(priorityValues),
    opportunityDelta: summarizeDeltas(opportunityValues),
    rankChanges,
    authoritative: false,
    basis: datasets.length === 0
      ? '队列为空，无聚合结果。'
      : `${datasets.length} 名学生中 ${withHistory.length} 名有复习历史，其中 ${affectedStudents} 名（比例 ${withHistory.length > 0 ? round4(affectedStudents / withHistory.length) : 0}）的掌握度会被复习接线改变；`
        + `节点受影响比例 ${nodes > 0 ? round4(affectedNodes / nodes) : 0}，排名变化 ${rankChanges} 处。结果非权威。`,
  };
}

// ---------------------------------------------------------------------------
// Phase 7 — product invariants
// ---------------------------------------------------------------------------

export interface ReviewIntegrationCheck {
  readonly id: string;
  readonly name: string;
  readonly passed: boolean;
  readonly observed: string;
  readonly basis: string;
}

export interface ReviewIntegrationAudit {
  readonly checks: readonly ReviewIntegrationCheck[];
  readonly passed: boolean;
  readonly authoritative: false;
  readonly basis: string;
}

/**
 * The invariants the shadow must satisfy. Each is computed from the artefacts
 * themselves (no assertion of intent), so a broken pipeline fails here rather
 * than being reported as green.
 */
export function auditReviewMasteryIntegration(input: {
  readonly observations: readonly ProjectedReviewObservation[];
  readonly shadow: ReviewMasteryShadow;
  readonly dataset?: ReviewIntegrationDataset | null;
  /** Counted by the caller: any authoritative write performed during assembly. */
  readonly authoritativeWrites?: number;
}): ReviewIntegrationAudit {
  const { observations, shadow } = input;
  const checks: ReviewIntegrationCheck[] = [];

  // A1 — every evidence-backed review event produced exactly one mastery step.
  const eligibleIds = observations.filter((row) => row.eligibleForMastery).map((row) => row.reviewEventId);
  const rowIds = shadow.eventRows.map((row) => row.reviewEventId);
  const ineligible = new Set(observations.filter((row) => !row.eligibleForMastery).map((row) => row.reviewEventId));
  const missing = eligibleIds.filter((id) => !rowIds.includes(id));
  const duplicated = rowIds.filter((id, index) => rowIds.indexOf(id) !== index);
  const leaked = rowIds.filter((id) => ineligible.has(id));
  const a1Passed = missing.length === 0 && duplicated.length === 0 && leaked.length === 0;
  checks.push({
    id: 'A1',
    name: '每个带证据回执的复习事件恰好产生一次掌握度步进，且无回执事件不进入影子',
    passed: a1Passed,
    observed: `eligible=${eligibleIds.length} rows=${rowIds.length} missing=${missing.length} duplicated=${duplicated.length} leaked=${leaked.length}`,
    basis: a1Passed
      ? '证据边界成立：影子中的每一次步进都能回指到一个带回执的复习事件。'
      : `归因断裂：缺步进 ${missing.length} 个、重复 ${duplicated.length} 个、越界 ${leaked.length} 个。`,
  });

  // A2 — the transition is the canonical model, bit for bit. Compared on the
  // unrounded trace, so the second step consumes the first step's true output.
  let fidelityFailures = 0;
  let stepsChecked = 0;
  for (const node of shadow.trace) {
    for (const step of node.steps) {
      stepsChecked += 1;
      const observation = observations.find((row) => row.reviewEventId === step.reviewEventId);
      if (!observation) {
        fidelityFailures += 1;
        continue;
      }
      const recomputed = applyMasteryModel(shadow.model, rebuildState(step.beforeRaw), {
        isCorrect: observation.redoCorrect,
        difficulty: clampDifficulty(observation.difficulty),
        role: 'PRIMARY',
      });
      if (!Object.is(recomputed.mastery, step.afterRaw)) fidelityFailures += 1;
      // The published rows must be the published trace, rounded — a later
      // post-processing step that adjusts one without the other is exactly the
      // regression this check exists to catch.
      const row = shadow.eventRows.find((candidate) => candidate.reviewEventId === step.reviewEventId);
      if (!row) {
        fidelityFailures += 1;
        continue;
      }
      if (!Object.is(row.shadowMastery, round4(step.afterRaw))) fidelityFailures += 1;
      if (!Object.is(row.masteryBefore, round4(step.beforeRaw))) fidelityFailures += 1;
      if (row.observedResult !== observation.redoCorrect) fidelityFailures += 1;
    }
  }
  const a2Passed = fidelityFailures === 0;
  checks.push({
    id: 'A2',
    name: '每一步都是统一掌握度语义本身，未自行发明公式',
    passed: a2Passed,
    observed: `steps=${stepsChecked} mismatches=${fidelityFailures}`,
    basis: a2Passed
      ? '逐步独立重算与影子轨迹位级一致，复习接线未引入第二套口径。'
      : `${fidelityFailures} 步与统一语义重算不一致——影子在自造公式。`,
  });

  // A3 — deltas are conserved: the steps add up to the node total, exactly.
  let conservationFailures = 0;
  for (const node of shadow.trace) {
    const sum = node.steps.reduce((acc, step) => acc + (step.afterRaw - step.beforeRaw), 0);
    const total = node.finalRaw - node.baselineRaw;
    if (Math.abs(sum - total) > 1e-12) conservationFailures += 1;
    if (node.steps.length > 0) {
      const first = node.steps[0];
      if (!Object.is(first.beforeRaw, node.baselineRaw)) conservationFailures += 1;
      const last = node.steps[node.steps.length - 1];
      if (!Object.is(last.afterRaw, node.finalRaw)) conservationFailures += 1;
    }
    for (let index = 1; index < node.steps.length; index += 1) {
      if (!Object.is(node.steps[index].beforeRaw, node.steps[index - 1].afterRaw)) {
        conservationFailures += 1;
      }
    }
  }
  const a3Passed = conservationFailures === 0;
  checks.push({
    id: 'A3',
    name: '每个节点的掌握度变化等于其复习步进之和（无不可归因的增量）',
    passed: a3Passed,
    observed: `nodes=${shadow.trace.length} mismatched=${conservationFailures}`,
    basis: a3Passed
      ? '无凭空增量：节点级变化完全由可归因的复习步进解释，且轨迹首尾与基线/终值严格衔接。'
      : `${conservationFailures} 处节点的变化无法由复习步进解释。`,
  });

  // A4 — every step moves toward its canonical target, never away from it.
  let offTarget = 0;
  let correctLowered = 0;
  let incorrectRaised = 0;
  for (const row of shadow.eventRows) {
    const before = row.masteryBefore;
    const moved = row.shadowMastery - before;
    const gap = row.canonicalTarget - before;
    if (Math.abs(moved) > REVIEW_STEP_EPSILON && Math.sign(moved) !== Math.sign(gap)) offTarget += 1;
    if (row.observedResult && moved < -REVIEW_STEP_EPSILON) correctLowered += 1;
    if (!row.observedResult && moved > REVIEW_STEP_EPSILON) incorrectRaised += 1;
  }
  const a4Passed = offTarget === 0;
  checks.push({
    id: 'A4',
    name: '复习结果与掌握度变化方向一致（正确不因接线下压、错误不因接线上抬的目标方向）',
    passed: a4Passed,
    observed: `offTarget=${offTarget} correctLowered=${correctLowered} incorrectRaised=${incorrectRaised}`,
    basis: a4Passed
      ? `每一步都朝自身语义目标移动。如实披露：现行 EMA 在估计值位于目标另一侧时，会有 ${correctLowered} 次正确复习被下压、${incorrectRaised} 次错误复习被上抬——` +
        '这是现行语义的固有瞬态（C1 候选正是为消除它而提出），由 A2 证明不是本次接线引入。'
      : `${offTarget} 步朝反方向移动，说明接线或符号有误。`,
  });

  // A5 — student isolation.
  const dataset = input.dataset ?? null;
  const studentIds = new Set(dataset ? dataset.rows.map((row) => row.studentId) : []);
  const observationNodes = new Set(observations.map((row) => row.nodeId));
  const foreignNodes = dataset
    ? dataset.rows.filter((row) => !observationNodes.has(row.nodeId)).length
    : 0;
  const a5Passed = studentIds.size <= 1 && foreignNodes === 0;
  checks.push({
    id: 'A5',
    name: '学生隔离：数据集只包含被请求学生自己的节点与事件',
    passed: a5Passed,
    observed: `studentIds=${[...studentIds].join(',') || '(none)'} foreignNodes=${foreignNodes}`,
    basis: a5Passed
      ? '所有行都属于同一名学生，且节点全部来自该学生自己的复习事件解析结果。'
      : `出现 ${studentIds.size} 名学生或 ${foreignNodes} 个外来节点。`,
  });

  // A6 — no authoritative write.
  const writes = input.authoritativeWrites ?? 0;
  const a6Passed = writes === 0 && shadow.authoritative === false && (dataset?.authoritative ?? false) === false;
  checks.push({
    id: 'A6',
    name: 'authoritative writes = 0：影子未写任何权威表',
    passed: a6Passed,
    observed: `writes=${writes} shadowAuthoritative=${shadow.authoritative} datasetAuthoritative=${dataset?.authoritative ?? 'n/a'}`,
    basis: a6Passed
      ? '装配与计算全程只读，产物显式标记为非权威。'
      : '检测到权威写入或权威标记被置真。',
  });

  // A7 — the receipt boundary held.
  const boundaryViolations = shadow.eventRows.length - eligibleIds.length;
  const a7Passed = shadow.eventRows.length === eligibleIds.length && shadow.summary.eventsSkipped === observations.length - eligibleIds.length;
  checks.push({
    id: 'A7',
    name: '证据边界：无回执的复习事件不得进入掌握度影子',
    passed: a7Passed,
    observed: `eligible=${eligibleIds.length} replayed=${shadow.eventRows.length} skipped=${shadow.summary.eventsSkipped} drift=${boundaryViolations}`,
    basis: a7Passed
      ? 'Review → 直接改写权威掌握度 的路径不存在：先有回执，才进入影子。'
      : `边界漂移：${boundaryViolations} 个事件的回执状态与是否进入影子不一致。`,
  });

  const passed = checks.every((check) => check.passed);
  return {
    checks,
    passed,
    authoritative: false,
    basis: passed
      ? `全部 ${checks.length} 项产品不变量成立。`
      : `未通过：${checks.filter((check) => !check.passed).map((check) => check.id).join('/')}。`,
  };
}

// ---------------------------------------------------------------------------

/**
 * Provenance as a structural fact: the review event that caused the step, then
 * each downstream link that actually moved. `opportunity` / `recommendation` are
 * recorded only when the downstream shadow covered the node, so a node missing
 * from the chain reads as unattributed rather than silently complete.
 */
function buildAttribution(input: {
  readonly reviewEventId: string;
  readonly masteryStepDelta: number;
  readonly priorityDelta: number | null;
  readonly opportunityDelta: number | null;
  readonly rankDelta: number | null;
}): readonly string[] {
  const steps: string[] = [`review.recalled:${input.reviewEventId}`];
  if (Math.abs(input.masteryStepDelta) > REVIEW_STEP_EPSILON) steps.push('mastery');
  if (input.priorityDelta != null && Math.abs(input.priorityDelta) > REVIEW_STEP_EPSILON) steps.push('priority');
  if (input.opportunityDelta != null && Math.abs(input.opportunityDelta) > REVIEW_STEP_EPSILON) {
    steps.push('opportunity');
  }
  if (input.rankDelta != null && input.rankDelta !== 0) steps.push('recommendation');
  return steps;
}

function neutralState(): MasteryState {  return {
    mastery: NEUTRAL_MASTERY,
    accuracy: 0.55,
    recentAccuracy: 0.55,
    attempts: 0,
    correctCount: 0,
    wrongCount: 0,
    confidence: 0,
  };
}

/** A2 compares only the mastery component, so the rest of the state is inert. */
function rebuildState(mastery: number): MasteryState {
  return { ...neutralState(), mastery };
}

function subtract(left: number | null | undefined, right: number | null | undefined): number | null {
  if (typeof left !== 'number' || typeof right !== 'number') return null;
  return round4(left - right);
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function clampDifficulty(value: number): 1 | 2 | 3 | 4 | 5 {
  if (!Number.isFinite(value)) return 3;
  const rounded = Math.min(5, Math.max(1, Math.round(value)));
  return rounded as 1 | 2 | 3 | 4 | 5;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
