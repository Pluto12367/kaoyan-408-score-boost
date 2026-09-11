/**
 * V12-M3 Phase B — Review semantics unification SHADOW (pure module).
 *
 * ## The finding this module quantifies
 *
 * The audit (docs/v12-m3-review-semantics-audit.md) established that mastery
 * and stability are updated by DISJOINT paths:
 *
 *   practice  → updateMasteryAfterAttempt      (mastery, never stability)
 *   review    → updateStabilityAfterReview     (stability, never mastery)
 *
 * `applyReview` spreads the existing mastery state unchanged
 * (score-center/service.ts:156-171), and `retention` is written as the
 * constant 1. So an observed review outcome — which V12-M1 classifies as
 * STRONG evidence — contributes nothing to the ability estimate, and the
 * stored retention makes an unconditional claim of perfect recall.
 *
 * ## What this module does
 *
 * Nothing authoritative. It replays review history under the PROPOSED unified
 * semantics (reviews feed the same EMA as practice) and reports the divergence
 * against what is stored, plus a time-aware retention to compare with the
 * stored constant. Every output is marked non-authoritative; no production
 * write changes, and switching remains an owner-approved decision.
 *
 * Pure: imports only its sibling pure module so the shadow uses the exact same
 * EMA implementation as production (a re-implementation would make the
 * comparison meaningless).
 */

import { estimateRetention, updateMasteryAfterAttempt } from './mastery';
import type { MasteryState } from './types';

/** Divergence smaller than this is reported as converged (float noise). */
export const REVIEW_CONVERGENCE_EPSILON = 0.005;

export interface ReviewSemanticsRow {
  readonly action: string;
  readonly activity: boolean;
  /** Whether an objective observation is produced (V12-M1 strength: strong). */
  readonly evidence: boolean;
  /** Whether the action changes UserKnowledgeMastery today (empirically). */
  readonly changesMastery: boolean;
  /** Whether the action changes ReviewSchedule / nextReviewAt today. */
  readonly changesSchedule: boolean;
  readonly basis: string;
  readonly evidenceRef: string;
}

/**
 * The authoritative semantics table, as code. Docs, endpoints and tests read
 * this instead of restating it — restating semantics is how the two mastery
 * 口径 drifted apart in the first place.
 */
export const REVIEW_SEMANTICS_MATRIX: readonly ReviewSemanticsRow[] = [
  {
    action: 'wrong.opened',
    activity: true,
    evidence: false,
    changesMastery: false,
    changesSchedule: false,
    basis: '打开错题只产生浏览活动，未观测表现。',
    evidenceRef: 'apps/web/src/App.tsx:850',
  },
  {
    action: 'review.marked',
    activity: true,
    evidence: false,
    changesMastery: false,
    changesSchedule: false,
    basis: '“标记已复习”只登记动作；V12-M1 已如实记录为活动证据。',
    evidenceRef: 'apps/api/src/study/study.service.ts:2181-2211',
  },
  {
    action: 'review.reason_reported',
    activity: true,
    evidence: true,
    changesMastery: false,
    changesSchedule: true,
    basis: '错因上报产生回忆观测（强证据），但只安排次日复习，不改掌握度。',
    evidenceRef: 'apps/api/src/study/study.service.ts:2278-2302',
  },
  {
    action: 'review.recalled',
    activity: true,
    evidence: true,
    changesMastery: false,
    changesSchedule: true,
    basis: '复习重做是可观测表现，但 applyReview 原样 spread 掌握度，只写 stabilityDays/retention/nextReviewAt。',
    evidenceRef: 'apps/api/src/score-center/service.ts:156-171',
  },
  {
    action: 'practice.answered',
    activity: true,
    evidence: true,
    changesMastery: true,
    changesSchedule: false,
    basis: '已判分练习走 EMA 更新掌握度；完全不触碰复习排程。',
    evidenceRef: 'apps/api/src/score-center/service.ts:118-129',
  },
  {
    action: 'task.completed',
    activity: true,
    evidence: false,
    changesMastery: false,
    changesSchedule: true,
    basis: '完成任务只驱动次日计划；完成标记本身不是能力证据（V12-M1）。',
    evidenceRef: 'apps/api/src/study/study.service.ts:3450-3461',
  },
  {
    action: 'assessment.submitted',
    activity: true,
    evidence: true,
    changesMastery: true,
    changesSchedule: false,
    basis: '测评逐题走 createPracticeRecord，因此间接获得 EMA 掌握度更新。',
    evidenceRef: 'apps/api/src/study/study.service.ts:3595-3601',
  },
] as const;

// ---------------------------------------------------------------------------
// Mastery replay under the proposed unified semantics
// ---------------------------------------------------------------------------

export interface ReviewObservation {
  readonly nodeId: string;
  readonly questionId: string;
  readonly reviewedAt: string;
  readonly redoCorrect: boolean;
  readonly difficulty: number;
}

export interface ReviewMasteryBaseline {
  readonly nodeId: string;
  readonly mastery: number;
  readonly accuracy: number;
  readonly recentAccuracy: number;
  readonly attempts: number;
  readonly correctCount: number;
  readonly wrongCount: number;
  readonly confidence: number;
  readonly at: string;
}

export interface StoredNodeMastery {
  readonly nodeId: string;
  readonly mastery: number;
  readonly stabilityDays: number | null;
}

export type ReplayDirection = 'unified_higher' | 'unified_lower' | 'converged' | 'insufficient_data';

export interface ReviewMasteryReplayRow {
  readonly nodeId: string;
  readonly observations: number;
  readonly observedCorrect: number;
  readonly storedMastery: number | null;
  readonly replayMastery: number | null;
  readonly delta: number | null;
  readonly direction: ReplayDirection;
  readonly basis: string;
  /**
   * The full replayed memory state, so downstream shadows (priority /
   * opportunity / ranking) can consume the SAME number this module computed
   * instead of replaying it a second time with their own formula.
   * null when there was nothing to replay.
   */
  readonly replayState: MasteryState | null;
}

export interface ReviewMasteryReplay {
  readonly rows: readonly ReviewMasteryReplayRow[];
  readonly summary: {
    readonly nodesEvaluated: number;
    readonly unifiedHigher: number;
    readonly unifiedLower: number;
    readonly converged: number;
    readonly insufficientData: number;
    readonly authoritative: false;
    readonly basis: string;
  };
}

export function replayUnifiedReviewMastery(input: {
  readonly observations: readonly ReviewObservation[];
  readonly baselines: readonly ReviewMasteryBaseline[];
  readonly stored: readonly StoredNodeMastery[];
  /**
   * True when the baseline state was reconstructed from a daily snapshot, which
   * stores mastery/attempts/correctCount but NOT accuracy/recentAccuracy — so
   * recentAccuracy had to be approximated. Stated in the row basis rather than
   * passed off as a full baseline.
   */
  readonly baselineApproximated?: boolean;
}): ReviewMasteryReplay {
  const baselineByNode = new Map(input.baselines.map((row) => [row.nodeId, row]));
  const storedByNode = new Map(input.stored.map((row) => [row.nodeId, row]));

  const byNode = new Map<string, ReviewObservation[]>();
  for (const observation of input.observations) {
    const list = byNode.get(observation.nodeId) ?? [];
    list.push(observation);
    byNode.set(observation.nodeId, list);
  }

  const nodeIds = new Set<string>([
    ...byNode.keys(),
    ...baselineByNode.keys(),
    ...storedByNode.keys(),
  ]);

  const rows: ReviewMasteryReplayRow[] = [];
  for (const nodeId of nodeIds) {
    const observations = (byNode.get(nodeId) ?? [])
      .slice()
      .sort((left, right) => left.reviewedAt.localeCompare(right.reviewedAt));
    const baseline = baselineByNode.get(nodeId) ?? null;
    const stored = storedByNode.get(nodeId) ?? null;

    if (observations.length === 0) {
      rows.push({
        nodeId,
        observations: 0,
        observedCorrect: 0,
        storedMastery: stored?.mastery ?? null,
        replayMastery: null,
        delta: null,
        direction: 'insufficient_data',
        basis: '该节点无复习观测，无法重放统一语义。',
        replayState: null,
      });
      continue;
    }

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

    for (const observation of observations) {
      state = updateMasteryAfterAttempt(state, {
        isCorrect: observation.redoCorrect,
        difficulty: clampDifficulty(observation.difficulty),
        role: 'PRIMARY',
      });
    }

    const replayMastery = round4(state.mastery);
    const storedMastery = stored ? round4(stored.mastery) : null;
    const delta = storedMastery == null ? null : round4(replayMastery - storedMastery);
    const direction = resolveDirection(delta);
    const correct = observations.filter((row) => row.redoCorrect).length;

    rows.push({
      nodeId,
      observations: observations.length,
      observedCorrect: correct,
      storedMastery,
      replayMastery,
      delta,
      direction,
      replayState: state,
      basis: describeReplay({
        hasBaseline: baseline != null,
        hasStored: storedMastery != null,
        observations: observations.length,
        correct,
        delta,
        direction,
        approximated: input.baselineApproximated === true,
      }),
    });
  }

  const count = (direction: ReplayDirection) => rows.filter((row) => row.direction === direction).length;
  const unifiedHigher = count('unified_higher');
  const unifiedLower = count('unified_lower');
  const converged = count('converged');
  const insufficientData = count('insufficient_data');

  return {
    rows,
    summary: {
      nodesEvaluated: rows.length,
      unifiedHigher,
      unifiedLower,
      converged,
      insufficientData,
      authoritative: false,
      basis: rows.length === 0
        ? '窗口内没有可重放的复习历史。'
        : `影子重放 ${rows.length} 个节点：统一语义更高 ${unifiedHigher}、更低 ${unifiedLower}、一致 ${converged}、证据不足 ${insufficientData}。结果非权威，不写任何表。`,
    },
  };
}

// ---------------------------------------------------------------------------
// Retention honesty: stored constant vs time-aware computation
// ---------------------------------------------------------------------------

export interface RetentionShadowInputRow {
  readonly nodeId: string;
  readonly stabilityDays: number | null;
  readonly storedRetention: number | null;
  readonly lastReviewedAt: string | null;
  readonly asOf: string;
}

export type RetentionVerdict = 'stored_optimistic' | 'consistent' | 'unknown';

export interface RetentionShadowRow {
  readonly nodeId: string;
  readonly storedRetention: number | null;
  readonly computedRetention: number | null;
  readonly gap: number | null;
  readonly verdict: RetentionVerdict;
  readonly basis: string;
}

export interface RetentionShadow {
  readonly rows: readonly RetentionShadowRow[];
  readonly summary: {
    readonly rowsEvaluated: number;
    readonly storedOptimistic: number;
    readonly consistent: number;
    readonly unknown: number;
    readonly authoritative: false;
    readonly basis: string;
  };
}

export function reviewRetentionShadow(input: {
  readonly rows: readonly RetentionShadowInputRow[];
}): RetentionShadow {
  const rows: RetentionShadowRow[] = input.rows.map((row) => {
    if (row.stabilityDays == null || row.lastReviewedAt == null || row.storedRetention == null) {
      return {
        nodeId: row.nodeId,
        storedRetention: row.storedRetention,
        computedRetention: null,
        gap: null,
        verdict: 'unknown' as const,
        basis: '缺少稳定性或复习时间，无法计算保持率——不做判断。',
      };
    }
    const elapsedDays = Math.max(
      0,
      (new Date(row.asOf).getTime() - new Date(row.lastReviewedAt).getTime()) / 86_400_000,
    );
    // Reuse the production formula, but keep the honest null for missing input
    // (estimateRetention itself answers 0.5 for "unknown", which would read as a
    // measurement rather than an absence).
    const computed = round4(
      estimateRetention(new Date(row.lastReviewedAt), row.stabilityDays, new Date(row.asOf)),
    );
    const gap = round4(row.storedRetention - computed);
    const verdict: RetentionVerdict = gap > REVIEW_CONVERGENCE_EPSILON ? 'stored_optimistic' : 'consistent';
    return {
      nodeId: row.nodeId,
      storedRetention: row.storedRetention,
      computedRetention: computed,
      gap,
      verdict,
      basis: verdict === 'stored_optimistic'
        ? `已过 ${Math.round(elapsedDays)} 天、稳定性 ${row.stabilityDays} 天，时间感知保持率应为 ${computed}，但存储值为 ${row.storedRetention}（恒定声明）。`
        : `存储保持率与时间感知计算一致（${computed}）。`,
    };
  });

  const count = (verdict: RetentionVerdict) => rows.filter((row) => row.verdict === verdict).length;
  const storedOptimistic = count('stored_optimistic');
  const consistent = count('consistent');
  const unknown = count('unknown');

  return {
    rows,
    summary: {
      rowsEvaluated: rows.length,
      storedOptimistic,
      consistent,
      unknown,
      authoritative: false,
      basis: rows.length === 0
        ? '没有可评估的节点保持率。'
        : `影子评估 ${rows.length} 个节点：${storedOptimistic} 个存储保持率高于时间感知计算、${consistent} 个一致、${unknown} 个证据不足。结果非权威。`,
    },
  };
}

// ---------------------------------------------------------------------------

function neutralState(): MasteryState {
  return {
    mastery: 0.5,
    accuracy: 0.55,
    recentAccuracy: 0.55,
    attempts: 0,
    correctCount: 0,
    wrongCount: 0,
    confidence: 0,
  };
}

function resolveDirection(delta: number | null): ReplayDirection {
  if (delta == null) return 'insufficient_data';
  if (Math.abs(delta) <= REVIEW_CONVERGENCE_EPSILON) return 'converged';
  return delta > 0 ? 'unified_higher' : 'unified_lower';
}

function describeReplay(input: {
  hasBaseline: boolean;
  hasStored: boolean;
  observations: number;
  correct: number;
  delta: number | null;
  direction: ReplayDirection;
  approximated: boolean;
}): string {
  const head = input.hasBaseline
    ? `以快照为基线重放 ${input.observations} 次复习观测（正确 ${input.correct} 次）${input.approximated ? '（快照不含 accuracy/recentAccuracy，已用可恢复值近似）' : ''}`
    : `无历史快照，以中立初值重放 ${input.observations} 次复习观测（正确 ${input.correct} 次）`;
  if (!input.hasStored) return `${head}；无存储掌握度可对比，因此不给偏差。`;
  switch (input.direction) {
    case 'unified_higher':
      return `${head}；统一语义下掌握度将高 ${input.delta}（复习证据目前完全未参与能力估计）。`;
    case 'unified_lower':
      return `${head}；统一语义下掌握度将低 ${Math.abs(input.delta ?? 0)}。`;
    case 'converged':
      return `${head}；与存储掌握度一致，统一语义不会改变该节点。`;
    default:
      return `${head}；证据不足。`;
  }
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** AttemptSignal.difficulty is a 1..5 bucket; review observations carry a raw value. */
function clampDifficulty(value: number): 1 | 2 | 3 | 4 | 5 {
  if (!Number.isFinite(value)) return 3;
  const rounded = Math.min(5, Math.max(1, Math.round(value)));
  return rounded as 1 | 2 | 3 | 4 | 5;
}
