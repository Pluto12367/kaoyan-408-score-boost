/**
 * V12-M3 Phase-C precondition — mastery semantic invariants (pure module).
 *
 * ## The problem this exists to prove
 *
 * The production EMA pulls mastery toward a per-outcome target:
 *
 *   target(correct, d) = min(1, 0.72 + 0.055d)      // d=1 → 0.775 … d=5 → 0.995
 *   target(wrong,   d) = max(0, 0.38 - 0.045(d-1))  // d=1 → 0.380 … d=5 → 0.200
 *
 * The target is the fixed point, so mastery converges to it. The consequence is
 * that whenever mastery sits on the wrong side of a target, the outcome moves
 * the estimate AGAINST its own direction:
 *
 *   • a WRONG answer raises mastery when mastery < target(wrong, d)
 *     (i.e. below 0.38 for an easy question — exactly the weak students this
 *     product exists to help)
 *   • a CORRECT answer lowers mastery when mastery > target(correct, d)
 *     (i.e. above 0.775 for an easy question)
 *
 * This module does not change any of that. It states the invariants, evaluates a
 * single transition against them, and reports the violation zone, so the claim
 * is testable rather than asserted.
 *
 * Pure: no IO, deterministic.
 */

import { updateMasteryAfterAttempt } from './mastery';
import type { AttemptSignal, MasteryState } from './types';

/** Transition equality tolerance — mastery is a float, so exact comparison is wrong. */
export const MASTERY_EPSILON = 1e-9;

export type MasteryModelId = 'production' | 'direction_preserving';

export interface MasteryInvariantSpec {
  readonly id: 'A' | 'B' | 'C' | 'D';
  readonly name: string;
  readonly statement: string;
}

/** Published invariant catalogue — docs, tests and endpoints read this. */
export const MASTERY_INVARIANTS: readonly MasteryInvariantSpec[] = [
  {
    id: 'A',
    name: '失败不提升',
    statement: '低掌握度 + 错误复习不得使 mastery 上升（newMastery <= oldMastery）。',
  },
  {
    id: 'B',
    name: '成功不下降',
    statement: '正确复习不得因复习本身产生反直觉的 mastery 下降（newMastery >= oldMastery）。',
  },
  {
    id: 'C',
    name: '失败不减轻薄弱',
    statement: '错误复习不得降低 weakness（weakness = 1 - mastery 不得变小）。',
  },
  {
    id: 'D',
    name: '影子差异可证',
    statement: '同一事件的 observed/unified 差异必须确定性、有界、可归因。',
  },
] as const;

export interface MasteryInvariantVerdict {
  readonly id: 'A' | 'B' | 'C' | 'D';
  readonly holds: boolean;
  readonly detail: string;
}

export interface MasteryTargetProfile {
  readonly difficulty: number;
  /** Production target for a correct answer. */
  readonly correctTarget: number;
  /** Production target for a wrong answer — a POSITIVE floor, hence the issue. */
  readonly wrongTarget: number;
  /** Below this mastery a wrong answer raises mastery. */
  readonly wrongRaisesBelow: number;
  /** Above this mastery a correct answer lowers mastery. */
  readonly correctLowersAbove: number;
}

export interface MasteryTransitionAudit {
  readonly model: MasteryModelId;
  readonly isCorrect: boolean;
  readonly difficulty: number;
  readonly before: number;
  readonly after: number;
  /** The target actually used by the model. */
  readonly effectiveTarget: number;
  /** The unmodified production target, for comparison. */
  readonly productionTarget: number;
  readonly delta: number;
  readonly direction: 'up' | 'down' | 'unchanged';
  readonly invariants: readonly MasteryInvariantVerdict[];
  /** True when A, B or C is violated by this single transition. */
  readonly suspicious: boolean;
  readonly primaryViolation: 'A' | 'B' | 'C' | null;
  readonly basis: string;
}

export function masteryTargetProfile(difficulty: number): MasteryTargetProfile {
  const d = clampDifficulty(difficulty);
  const correctTarget = round4(Math.min(1, 0.72 + d * 0.055));
  const wrongTarget = round4(Math.max(0, 0.38 - (d - 1) * 0.045));
  return {
    difficulty: d,
    correctTarget,
    wrongTarget,
    // A wrong answer pulls toward wrongTarget, so it raises mastery strictly below it.
    wrongRaisesBelow: wrongTarget,
    // A correct answer pulls toward correctTarget, so it lowers mastery strictly above it.
    correctLowersAbove: correctTarget,
  };
}

/**
 * Evaluate one transition against invariants A/B/C and the boundedness half of D.
 *
 * The `after` value always comes from the PRODUCTION function; the model id only
 * labels which model's output is being judged, so this auditor can judge a
 * candidate without importing its implementation.
 */
export function auditMasteryTransition(input: {
  readonly model: MasteryModelId;
  readonly state: MasteryState;
  readonly signal: AttemptSignal;
  /** Optional override so the auditor can judge a candidate's output. */
  readonly after?: number;
  readonly effectiveTarget?: number;
}): MasteryTransitionAudit {
  const before = input.state.mastery;
  const production = updateMasteryAfterAttempt(input.state, input.signal);
  const after = input.after ?? production.mastery;
  const delta = round6(after - before);
  const profile = masteryTargetProfile(input.signal.difficulty);

  const roseOnFailure = !input.signal.isCorrect && delta > MASTERY_EPSILON;
  const fellOnSuccess = input.signal.isCorrect && delta < -MASTERY_EPSILON;
  const weaknessShrankOnFailure = !input.signal.isCorrect && (1 - after) < (1 - before) - MASTERY_EPSILON;
  const alpha = input.signal.role === 'PRIMARY' ? 0.18 : 0.07;
  const bounded = Math.abs(delta) <= alpha + MASTERY_EPSILON;

  const invariants: MasteryInvariantVerdict[] = [
    {
      id: 'A',
      holds: !roseOnFailure,
      detail: roseOnFailure
        ? `错误复习使掌握度从 ${round4(before)} 升到 ${round4(after)}（+${Math.abs(delta)}）——低于错误目标值 ${profile.wrongTarget} 时会发生。`
        : '错误复习未提升掌握度。',
    },
    {
      id: 'B',
      holds: !fellOnSuccess,
      detail: fellOnSuccess
        ? `正确复习使掌握度从 ${round4(before)} 降到 ${round4(after)}（−${Math.abs(delta)}）——高于正确目标值 ${profile.correctTarget} 时会发生。`
        : '正确复习未降低掌握度。',
    },
    {
      id: 'C',
      holds: !weaknessShrankOnFailure,
      detail: weaknessShrankOnFailure
        ? `错误复习使 weakness 从 ${round4(1 - before)} 降到 ${round4(1 - after)}——薄弱程度被减轻。`
        : '错误复习未减轻 weakness。',
    },
    {
      id: 'D',
      holds: bounded,
      detail: bounded
        ? `单次变化 |${Math.abs(delta)}| ≤ alpha ${alpha}，有界。`
        : `单次变化 |${Math.abs(delta)}| 超过 alpha ${alpha}，越界。`,
    },
  ];

  const primaryViolation = (invariants.find((v) => !v.holds && v.id !== 'D')?.id ?? null) as 'A' | 'B' | 'C' | null;

  return {
    model: input.model,
    isCorrect: input.signal.isCorrect,
    difficulty: profile.difficulty,
    before: round4(before),
    after: round4(after),
    effectiveTarget: round4(input.effectiveTarget ?? production.mastery),
    productionTarget: input.signal.isCorrect ? profile.correctTarget : profile.wrongTarget,
    delta,
    direction: delta > MASTERY_EPSILON ? 'up' : delta < -MASTERY_EPSILON ? 'down' : 'unchanged',
    invariants,
    suspicious: primaryViolation != null,
    primaryViolation,
    basis: primaryViolation == null
      ? `${input.signal.isCorrect ? '正确' : '错误'}复习（难度 ${profile.difficulty}）：${round4(before)} → ${round4(after)}，不变量全部成立。`
      : `不变量 ${primaryViolation} 被违反：${invariants.find((v) => v.id === primaryViolation)!.detail}`,
  };
}

/**
 * Determinism + attributable-difference half of invariant D, evaluated over a
 * pair of models on the same event.
 */
export function auditPairDeterminism(input: {
  readonly state: MasteryState;
  readonly signal: AttemptSignal;
  readonly candidateAfter: number;
}): MasteryInvariantVerdict {
  const first = updateMasteryAfterAttempt(input.state, input.signal).mastery;
  const second = updateMasteryAfterAttempt(input.state, input.signal).mastery;
  if (first !== second) {
    return { id: 'D', holds: false, detail: '同一输入两次计算的 production 结果不一致，差异不可证。' };
  }
  if (!Number.isFinite(input.candidateAfter)) {
    return { id: 'D', holds: false, detail: '候选模型输出非有限值，差异不可证。' };
  }
  const divergence = Math.abs(round6(input.candidateAfter - first));
  const alpha = input.signal.role === 'PRIMARY' ? 0.18 : 0.07;
  return divergence <= alpha + MASTERY_EPSILON
    ? { id: 'D', holds: true, detail: `两模型差异 ${divergence} 有界且确定（≤ alpha ${alpha}），并可由该事件归因。` }
    : { id: 'D', holds: false, detail: `两模型差异 ${divergence} 超出单事件上界 alpha ${alpha}。` };
}

function clampDifficulty(value: number): 1 | 2 | 3 | 4 | 5 {
  if (!Number.isFinite(value)) return 3;
  const rounded = Math.min(5, Math.max(1, Math.round(value)));
  return rounded as 1 | 2 | 3 | 4 | 5;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
