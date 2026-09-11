/**
 * V12-M3 — Shadow Decision Chain (pure module).
 *
 * ## The problem
 *
 * The unified-mastery shadow told us how much mastery *would* move, but stopped
 * there. A mastery delta is not a decision: the owner has to know whether that
 * delta changes what the student is told to study. This module carries the
 * divergence all the way down:
 *
 *   observed / unified mastery
 *        ↓  calculatePriority            (production primitive, unmodified)
 *        ↓  buildScoreOpportunity        (V12-M4 model, unmodified)
 *        ↓  runRecommendation            (production engine, unmodified)
 *   decision delta + attribution
 *
 * ## How correctness is preserved
 *
 * Both paths run the SAME production functions on the SAME candidate universe
 * with the SAME evidence, goal and clock. The only input that differs is the
 * per-node mastery state. That is what makes any downstream difference
 * attributable to the review rather than to a re-implementation drift.
 *
 * Nothing here writes anything: no mastery, no schedule, no recommendation, no
 * event. Every output carries `authoritative: false`. Switching production
 * semantics remains an owner decision, and this module deliberately produces
 * the evidence for that decision rather than the decision.
 *
 * All numbers are derived; `null` means "not measurable", never zero.
 */

import { calculatePriority } from './priority';
import { runRecommendation } from './recommendation';
import { buildScoreOpportunity } from './score-opportunity';
import type {
  MasteryState,
  PriorityReasonCode,
  RecommendationExamEvidence,
  RecommendationNodeState,
} from './types';

/** A priority swing at or above this is surfaced as a risk rather than reported quietly. */
export const SHADOW_PRIORITY_EXPLOSION_THRESHOLD = 25;

/** Above this many rank changes per changed node, the spread is called out. */
export const SHADOW_RANK_SPREAD_RATIO = 3;

export interface ShadowObservedState extends MasteryState {
  readonly retention: number | null;
  readonly stabilityDays: number | null;
  readonly lastReviewedAt: string | null;
  readonly pinned: boolean;
}

export interface ShadowTrigger {
  readonly eventId: string;
  readonly eventType: string;
  readonly at: string;
}

export interface ShadowChainNodeInput {
  readonly knowledgeNodeId: string;
  readonly title: string;
  readonly observed: ShadowObservedState;
  /** null = no observed review divergence for this node (nothing to shadow). */
  readonly unified: MasteryState | null;
  readonly evidence: RecommendationExamEvidence;
  readonly prerequisites: readonly string[];
  readonly trainingCostMinutes: number | null;
  readonly primaryScore5y: number | null;
  readonly evidenceConfidence: 'HIGH' | 'MEDIUM' | 'LOW';
  readonly everSucceeded: boolean | null;
  readonly prerequisiteReadiness: number | null;
  /** What produced the divergence — required for attribution. */
  readonly trigger: ShadowTrigger | null;
}

export interface ShadowChainInput {
  readonly userId: string;
  readonly now: string;
  readonly daysToExam: number;
  readonly availableMinutes: 30 | 60 | 120 | 180;
  readonly goal: {
    readonly stage: string | null;
    readonly targetScore: number | null;
    readonly currentScore: number | null;
    readonly remainingDays: number | null;
    readonly dailyHours: number | null;
  };
  readonly reviewSummary: { readonly dueCount: number; readonly overdueCount: number };
  readonly nodes: readonly ShadowChainNodeInput[];
  readonly maxItems?: number;
}

export type DeltaDirection = 'higher' | 'lower' | 'unchanged';
export type MasteryDirection = 'unified_higher' | 'unified_lower' | 'converged' | 'insufficient_data';

export interface ShadowDecisionRow {
  readonly knowledgeNodeId: string;
  readonly title: string;
  // mastery
  readonly observedMastery: number;
  readonly shadowMastery: number | null;
  readonly masteryDelta: number | null;
  readonly masteryDirection: MasteryDirection;
  // priority
  readonly observedPriority: number;
  readonly shadowPriority: number;
  readonly priorityDelta: number;
  readonly priorityDirection: DeltaDirection;
  readonly observedPriorityReasons: readonly PriorityReasonCode[];
  readonly shadowPriorityReasons: readonly PriorityReasonCode[];
  // opportunity
  readonly observedOpportunity: number | null;
  readonly shadowOpportunity: number | null;
  readonly opportunityDelta: number | null;
  readonly opportunityDirection: DeltaDirection | 'insufficient_data';
  // ranking (1-based position among the engine's node-level recommendations)
  readonly observedRank: number | null;
  readonly shadowRank: number | null;
  readonly rankDelta: number;
  readonly rankDirection: DeltaDirection;
  readonly triggerEventId: string | null;
  readonly triggerEventType: string | null;
  readonly confidence: 'high' | 'medium' | 'low' | 'none';
  readonly attribution: string;
  readonly authoritative: false;
}

export interface ShadowRisk {
  readonly code:
    | 'PRIORITY_SWING'
    | 'RANK_SPREAD'
    | 'UNIVERSE_MISMATCH'
    | 'UNATTRIBUTED_MASTERY'
    | 'UNATTRIBUTED_RANK';
  readonly severity: 'info' | 'warn';
  readonly nodeIds: readonly string[];
  readonly basis: string;
}

export interface ShadowDecisionChain {
  readonly userId: string;
  readonly generatedAt: string;
  readonly rows: readonly ShadowDecisionRow[];
  readonly summary: {
    readonly candidates: number;
    readonly changedMastery: number;
    readonly changedPriority: number;
    readonly changedOpportunity: number;
    readonly rankChanged: number;
    readonly noImpact: number;
    readonly affectedRatio: number;
    readonly noImpactRatio: number;
    readonly medianMasteryDelta: number;
    readonly p90MasteryDelta: number;
    readonly medianRankDelta: number;
    readonly maxRankDelta: number;
    readonly candidateUniverse: {
      readonly observed: number;
      readonly shadow: number;
      readonly consistent: boolean;
      readonly nodeIds: readonly string[];
    };
    readonly topN: {
      readonly n: number;
      readonly observed: readonly string[];
      readonly shadow: readonly string[];
      readonly entered: readonly string[];
      readonly exited: readonly string[];
      readonly rankChanged: readonly string[];
      readonly top1Changed: boolean;
    };
    readonly authoritative: false;
    readonly basis: string;
  };
  readonly risks: readonly ShadowRisk[];
  readonly authoritative: false;
  readonly productionSemanticsChanged: false;
}

// ---------------------------------------------------------------------------

export function buildShadowDecisionChain(input: ShadowChainInput): ShadowDecisionChain {
  const daysToExam = Math.max(0, input.daysToExam);
  const maxItems = input.maxItems ?? 8;

  const ordered = [...input.nodes].sort((left, right) =>
    left.knowledgeNodeId.localeCompare(right.knowledgeNodeId),
  );

  // ---- build the two node-state sets: identical except the mastery input ----
  const observedStates: RecommendationNodeState[] = [];
  const shadowStates: RecommendationNodeState[] = [];
  for (const node of ordered) {
    observedStates.push(toNodeState(node, node.observed));
    shadowStates.push(toNodeState(node, node.unified ?? node.observed));
  }

  const declaredUniverse = ordered.map((node) => node.knowledgeNodeId);

  // ---- priority: production primitive, both paths --------------------------
  const priorityByNode = new Map<string, {
    observed: ReturnType<typeof calculatePriority>;
    shadow: ReturnType<typeof calculatePriority>;
  }>();
  for (const node of ordered) {
    const observedUser = toUserState(node, node.observed);
    const shadowUser = toUserState(node, node.unified ?? node.observed);
    const evidence = { ...node.evidence, knowledgePointId: node.knowledgeNodeId } as never;
    priorityByNode.set(node.knowledgeNodeId, {
      observed: calculatePriority(evidence, observedUser, { daysToExam }),
      shadow: calculatePriority(evidence, shadowUser, { daysToExam }),
    });
  }

  // ---- opportunity: the V12-M4 model, both paths ---------------------------
  const opportunityByNode = new Map<string, {
    observed: number | null;
    shadow: number | null;
  }>();
  for (const node of ordered) {
    const observedUser = node.observed;
    const shadowUser = node.unified ?? node.observed;
    const observed = buildScoreOpportunity({
      nodeId: node.knowledgeNodeId,
      title: node.title,
      weakness: 1 - observedUser.mastery,
      examImportance: node.primaryScore5y != null && node.primaryScore5y > 0
        ? Math.min(1, node.primaryScore5y / 45)
        : null,
      evidenceConfidence: node.evidenceConfidence,
      daysToExam,
      retentionNow: observedUser.retention,
      everSucceeded: node.everSucceeded,
      prerequisiteReadiness: node.prerequisiteReadiness,
      trainingCostMinutes: node.trainingCostMinutes,
    });
    const shadow = buildScoreOpportunity({
      nodeId: node.knowledgeNodeId,
      title: node.title,
      weakness: 1 - shadowUser.mastery,
      examImportance: node.primaryScore5y != null && node.primaryScore5y > 0
        ? Math.min(1, node.primaryScore5y / 45)
        : null,
      evidenceConfidence: node.evidenceConfidence,
      daysToExam,
      retentionNow: node.observed.retention,
      everSucceeded: node.everSucceeded,
      prerequisiteReadiness: node.prerequisiteReadiness,
      trainingCostMinutes: node.trainingCostMinutes,
    });
    opportunityByNode.set(node.knowledgeNodeId, { observed: observed.score, shadow: shadow.score });
  }

  // ---- ranking: the production engine, both paths -------------------------
  const baseInput = {
    meta: { userId: input.userId, now: input.now, generatedAt: input.now },
    student: {
      goal: input.goal,
      reviewSummary: input.reviewSummary,
    },
    content: {
      evidence: Object.fromEntries(ordered.map((node) => [node.knowledgeNodeId, node.evidence])),
      prerequisites: Object.fromEntries(ordered.map((node) => [node.knowledgeNodeId, [...node.prerequisites]])),
      prerequisiteMastery: Object.fromEntries(
        ordered.map((node) => [node.knowledgeNodeId, node.observed.mastery]),
      ),
    },
    config: { availableMinutes: input.availableMinutes, daysToExam, maxItems },
  };

  const observedRanking = rankKnowledge(
    runRecommendation({ ...baseInput, student: { ...baseInput.student, nodeStates: observedStates } }).items,
  );
  const shadowRanking = rankKnowledge(
    runRecommendation({ ...baseInput, student: { ...baseInput.student, nodeStates: shadowStates } }).items,
  );

  // Risk C: the two runs must have seen the same universe.
  const observedUniverse = [...observedRanking.keys()].sort();
  const shadowUniverse = [...shadowRanking.keys()].sort();
  const universeConsistent =
    observedUniverse.length === shadowUniverse.length
    && observedUniverse.every((id, index) => id === shadowUniverse[index]);

  // ---- rows ---------------------------------------------------------------
  const rows: ShadowDecisionRow[] = ordered.map((node) => {
    const priority = priorityByNode.get(node.knowledgeNodeId)!;
    const opportunity = opportunityByNode.get(node.knowledgeNodeId)!;
    const observedRank = observedRanking.get(node.knowledgeNodeId) ?? null;
    const shadowRank = shadowRanking.get(node.knowledgeNodeId) ?? null;
    const rankDelta = observedRank != null && shadowRank != null ? shadowRank - observedRank : 0;

    const masteryDelta = node.unified ? round4(node.unified.mastery - node.observed.mastery) : null;
    const priorityDelta = priority.shadow.score - priority.observed.score;
    const opportunityDelta =
      opportunity.observed != null && opportunity.shadow != null
        ? round4(opportunity.shadow - opportunity.observed)
        : null;

    return {
      knowledgeNodeId: node.knowledgeNodeId,
      title: node.title,
      observedMastery: round4(node.observed.mastery),
      shadowMastery: node.unified ? round4(node.unified.mastery) : null,
      masteryDelta,
      masteryDirection: resolveMasteryDirection(masteryDelta),
      observedPriority: priority.observed.score,
      shadowPriority: priority.shadow.score,
      priorityDelta,
      priorityDirection: directionOf(priorityDelta),
      observedPriorityReasons: priority.observed.reasons,
      shadowPriorityReasons: priority.shadow.reasons,
      observedOpportunity: opportunity.observed,
      shadowOpportunity: opportunity.shadow,
      opportunityDelta,
      opportunityDirection: opportunityDelta == null ? 'insufficient_data' : directionOf(opportunityDelta),
      observedRank,
      shadowRank,
      rankDelta,
      rankDirection: directionOf(rankDelta),
      triggerEventId: node.trigger?.eventId ?? null,
      triggerEventType: node.trigger?.eventType ?? null,
      confidence: resolveConfidence(node),
      attribution: describeAttribution(node, masteryDelta, priorityDelta, rankDelta),
      authoritative: false,
    };
  });

  const changedMastery = rows.filter((row) => row.masteryDelta != null && Math.abs(row.masteryDelta) > 0).length;
  const changedPriority = rows.filter((row) => row.priorityDelta !== 0).length;
  const changedOpportunity = rows.filter((row) => row.opportunityDelta != null && row.opportunityDelta !== 0).length;
  const rankChanged = rows.filter((row) => row.rankDelta !== 0).length;
  const noImpact = rows.filter(
    (row) => row.rankDelta === 0 && row.priorityDelta === 0 && (row.masteryDelta == null || row.masteryDelta === 0),
  ).length;

  const masteryDeltas = rows.map((row) => row.masteryDelta).filter((value): value is number => value != null);
  const rankDeltas = rows.map((row) => Math.abs(row.rankDelta));

  const observedTop = topN(observedRanking, maxItems);
  const shadowTop = topN(shadowRanking, maxItems);

  const risks = buildRisks({ rows, universeConsistent, declaredUniverse, observedUniverse, shadowUniverse, rankChanged, changedMastery });

  return {
    userId: input.userId,
    generatedAt: input.now,
    rows,
    summary: {
      candidates: rows.length,
      changedMastery,
      changedPriority,
      changedOpportunity,
      rankChanged,
      noImpact,
      affectedRatio: rows.length > 0 ? round4(changedMastery / rows.length) : 0,
      noImpactRatio: rows.length > 0 ? round4(noImpact / rows.length) : 1,
      medianMasteryDelta: median(masteryDeltas),
      p90MasteryDelta: percentile(masteryDeltas, 0.9),
      medianRankDelta: median(rankDeltas),
      maxRankDelta: rankDeltas.length > 0 ? Math.max(...rankDeltas) : 0,
      candidateUniverse: {
        observed: observedUniverse.length,
        shadow: shadowUniverse.length,
        consistent: universeConsistent,
        nodeIds: declaredUniverse,
      },
      topN: {
        n: maxItems,
        observed: observedTop,
        shadow: shadowTop,
        entered: shadowTop.filter((id) => !observedTop.includes(id)),
        exited: observedTop.filter((id) => !shadowTop.includes(id)),
        rankChanged: rows.filter((row) => row.rankDelta !== 0).map((row) => row.knowledgeNodeId),
        top1Changed: (observedTop[0] ?? null) !== (shadowTop[0] ?? null),
      },
      authoritative: false,
      basis: rows.length === 0
        ? '没有候选节点，影子决策链为空——不给出"无影响"的结论。'
        : `同一候选宇宙（${rows.length} 个节点）上并行运行生产原语：掌握度变化 ${changedMastery}、优先级变化 ${changedPriority}、机会分变化 ${changedOpportunity}、排名变化 ${rankChanged}。结果非权威，生产语义未改变。`,
    },
    risks,
    authoritative: false,
    productionSemanticsChanged: false,
  };
}

// ---------------------------------------------------------------------------

/**
 * Build a node state for one path.
 *
 * The unified proposal only changes the EMA mastery update, so the scheduling
 * fields (retention / stability / lastReviewedAt / pinned) are taken from the
 * authoritative stored state in BOTH paths. Inventing them on the shadow side
 * would make the comparison measure something nobody proposed.
 */
function toNodeState(node: ShadowChainNodeInput, state: MasteryState): RecommendationNodeState {
  return {
    knowledgeNodeId: node.knowledgeNodeId,
    mastery: state.mastery,
    accuracy: state.accuracy,
    recentAccuracy: state.recentAccuracy,
    attempts: state.attempts,
    correctCount: state.correctCount,
    wrongCount: state.wrongCount,
    retention: node.observed.retention,
    stabilityDays: node.observed.stabilityDays,
    lastReviewedAt: node.observed.lastReviewedAt,
    pinned: node.observed.pinned,
  };
}

function toUserState(node: ShadowChainNodeInput, state: MasteryState) {
  return {
    mastery: state.mastery,
    accuracy: state.accuracy,
    recentAccuracy: state.recentAccuracy,
    attempts: state.attempts,
    correctCount: state.correctCount,
    wrongCount: state.wrongCount,
    confidence: state.confidence,
    retention: node.observed.retention,
    pinned: node.observed.pinned,
  };
}

/** 1-based rank per node, in the engine's own order, node-level items only. */
function rankKnowledge(
  items: readonly { kind: string; knowledgeNodeId: string }[],
): Map<string, number> {
  const ranking = new Map<string, number>();
  let position = 0;
  for (const item of items) {
    if (item.kind !== 'KNOWLEDGE') continue;
    if (ranking.has(item.knowledgeNodeId)) continue;
    position += 1;
    ranking.set(item.knowledgeNodeId, position);
  }
  return ranking;
}

function topN(ranking: ReadonlyMap<string, number>, n: number): string[] {
  return [...ranking.entries()]
    .sort((left, right) => left[1] - right[1])
    .slice(0, n)
    .map(([nodeId]) => nodeId);
}

function buildRisks(input: {
  rows: readonly ShadowDecisionRow[];
  universeConsistent: boolean;
  declaredUniverse: readonly string[];
  observedUniverse: readonly string[];
  shadowUniverse: readonly string[];
  rankChanged: number;
  changedMastery: number;
}): ShadowRisk[] {
  const risks: ShadowRisk[] = [];

  const swings = input.rows
    .filter((row) => Math.abs(row.priorityDelta) >= SHADOW_PRIORITY_EXPLOSION_THRESHOLD)
    .map((row) => row.knowledgeNodeId);
  if (swings.length > 0) {
    risks.push({
      code: 'PRIORITY_SWING',
      severity: 'warn',
      nodeIds: swings,
      basis: `优先级变化达到或超过 ${SHADOW_PRIORITY_EXPLOSION_THRESHOLD} 分。切换前必须确认这种幅度是否符合产品预期，而不是先切换再看。`,
    });
  }

  if (input.changedMastery > 0 && input.rankChanged > input.changedMastery * SHADOW_RANK_SPREAD_RATIO) {
    risks.push({
      code: 'RANK_SPREAD',
      severity: 'warn',
      nodeIds: input.rows.filter((row) => row.rankDelta !== 0).map((row) => row.knowledgeNodeId),
      basis: `仅 ${input.changedMastery} 个节点的掌握度变化，却引起 ${input.rankChanged} 个节点排名变化——排名扩散超出变化源，需检查是否由 tie-break 位移造成。`,
    });
  }

  if (!input.universeConsistent) {
    risks.push({
      code: 'UNIVERSE_MISMATCH',
      severity: 'warn',
      nodeIds: [],
      basis: `两条路径的候选宇宙不一致（observed ${input.observedUniverse.length} vs shadow ${input.shadowUniverse.length}）——此时任何排名差异都不可归因于掌握度。`,
    });
  }

  const unattributedMastery = input.rows
    .filter((row) => row.masteryDelta != null && Math.abs(row.masteryDelta) > 0 && row.triggerEventId == null)
    .map((row) => row.knowledgeNodeId);
  if (unattributedMastery.length > 0) {
    risks.push({
      code: 'UNATTRIBUTED_MASTERY',
      severity: 'warn',
      nodeIds: unattributedMastery,
      basis: '存在掌握度差异但无法回溯到具体复习/证据事件：这种差异不允许作为切换依据。',
    });
  }

  const unattributedRank = input.rows
    .filter((row) => row.rankDelta !== 0 && row.priorityDelta === 0 && (row.masteryDelta == null || row.masteryDelta === 0))
    .map((row) => row.knowledgeNodeId);
  if (unattributedRank.length > 0) {
    risks.push({
      code: 'UNATTRIBUTED_RANK',
      severity: 'info',
      nodeIds: unattributedRank,
      basis: '该节点自身优先级未变但排名变化：由其他节点分数变化引起的相对位移（tie-break / 排序位置），不是它自身的能力变化。',
    });
  }

  return risks;
}

function describeAttribution(
  node: ShadowChainNodeInput,
  masteryDelta: number | null,
  priorityDelta: number,
  rankDelta: number,
): string {
  if (masteryDelta == null) {
    return '该节点无复习观测差异：两条路径输入相同，因此优先级与排名不变。';
  }
  const source = node.trigger
    ? `${node.trigger.eventType}（${node.trigger.eventId}）`
    : '未知来源（缺少可回溯事件）';
  const masteryPart = `掌握度 ${round4(node.observed.mastery)} → ${round4(node.unified!.mastery)}（${masteryDelta > 0 ? '+' : ''}${masteryDelta}）`;
  const priorityPart = priorityDelta === 0
    ? '优先级未变'
    : `优先级 ${priorityDelta > 0 ? '上升' : '下降'} ${Math.abs(priorityDelta)} 分`;
  const rankPart = rankDelta === 0
    ? '推荐排名未变'
    : `推荐排名 ${rankDelta < 0 ? '前进' : '后退'} ${Math.abs(rankDelta)} 位`;
  return `${source} → ${masteryPart} → ${masteryPart && priorityPart} → ${rankPart}。`;
}

function resolveMasteryDirection(delta: number | null): MasteryDirection {
  if (delta == null) return 'insufficient_data';
  if (Math.abs(delta) <= 1e-9) return 'converged';
  return delta > 0 ? 'unified_higher' : 'unified_lower';
}

function directionOf(delta: number): DeltaDirection {
  if (delta === 0) return 'unchanged';
  return delta > 0 ? 'higher' : 'lower';
}

function resolveConfidence(node: ShadowChainNodeInput): 'high' | 'medium' | 'low' | 'none' {
  if (node.unified == null) return 'none';
  if (node.everSucceeded == null || node.prerequisiteReadiness == null) return 'low';
  if (node.trigger == null) return 'low';
  return 'medium';
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? round4((sorted[middle - 1] + sorted[middle]) / 2)
    : round4(sorted[middle]);
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1));
  return round4(sorted[index]);
}
