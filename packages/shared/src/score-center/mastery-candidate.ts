/**
 * V12-M3 Phase-C precondition — mastery candidate model + old/new comparison.
 *
 * ## The candidate (stated plainly, not decided)
 *
 * Candidate C1 "direction-preserving target":
 *
 *   target_raw(correct, d) = min(1, 0.72 + 0.055d)      // unchanged
 *   target_raw(wrong,   d) = max(0, 0.38 - 0.045(d-1))  // unchanged
 *
 *   target_effective = isCorrect ? max(target_raw, mastery)
 *                                : min(target_raw, mastery)
 *   mastery' = clamp01(mastery + alpha * (target_effective - mastery))
 *
 * Because the EMA's fixed point IS the target, the two models share the same
 * equilibrium and differ only in the transient: the candidate may not move the
 * estimate against the direction of the outcome it just observed. That is the
 * smallest change that satisfies invariants A/B/C, it touches no data structure
 * and no API, and reverting it is a one-line change.
 *
 * This module does not apply anything. It computes both models side by side so
 * the owner can see the difference before deciding, and this file is the only
 * place the candidate exists.
 *
 * Pure: deterministic, no IO.
 */

import { updateMasteryAfterAttempt } from './mastery';
import { auditMasteryTransition, auditPairDeterminism, MASTERY_EPSILON } from './mastery-semantics';
import type { AttemptSignal, MasteryState } from './types';
import type { MasteryInvariantVerdict, MasteryModelId } from './mastery-semantics';

/**
 * Candidate C1. Identical to production except the effective target may not lie
 * on the far side of the current estimate.
 */
export function updateMasteryDirectionPreserving(
  state: MasteryState,
  signal: AttemptSignal,
): MasteryState {
  const production = updateMasteryAfterAttempt(state, signal);
  const alpha = signal.role === 'PRIMARY' ? 0.18 : 0.07;
  const rawTarget = signal.isCorrect
    ? Math.min(1, 0.72 + signal.difficulty * 0.055)
    : Math.max(0, 0.38 - (signal.difficulty - 1) * 0.045);
  const effectiveTarget = signal.isCorrect
    ? Math.max(rawTarget, state.mastery)
    : Math.min(rawTarget, state.mastery);
  const mastery = clamp01(state.mastery + alpha * (effectiveTarget - state.mastery));
  void production;
  return { ...production, mastery: round6(mastery) };
}

export function applyMasteryModel(
  model: MasteryModelId,
  state: MasteryState,
  signal: AttemptSignal,
): MasteryState {
  return model === 'production'
    ? updateMasteryAfterAttempt(state, signal)
    : updateMasteryDirectionPreserving(state, signal);
}

export function effectiveTargetFor(
  model: MasteryModelId,
  state: MasteryState,
  signal: AttemptSignal,
): number {
  const rawTarget = signal.isCorrect
    ? Math.min(1, 0.72 + signal.difficulty * 0.055)
    : Math.max(0, 0.38 - (signal.difficulty - 1) * 0.045);
  if (model === 'production') return round6(rawTarget);
  return round6(signal.isCorrect ? Math.max(rawTarget, state.mastery) : Math.min(rawTarget, state.mastery));
}

// ---------------------------------------------------------------------------
// Sweep: old vs candidate over bands × outcomes × difficulty × repeats
// ---------------------------------------------------------------------------

export const MASTERY_BANDS = [
  { label: '0.00-0.30', mastery: 0.22 },
  { label: '0.30-0.50', mastery: 0.40 },
  { label: '0.50-0.70', mastery: 0.60 },
  { label: '0.70-0.90', mastery: 0.80 },
  { label: '0.90-1.00', mastery: 0.95 },
] as const;

export interface ModelComparisonRow {
  readonly band: string;
  readonly outcome: 'correct' | 'incorrect';
  readonly difficulty: number;
  readonly repeats: number;
  readonly oldMastery: number;
  readonly candidateMastery: number;
  readonly masteryDelta: number;
  readonly direction: 'higher' | 'lower' | 'unchanged';
  /** Invariant violations left by each model after the full repeat sequence. */
  readonly oldViolations: readonly string[];
  readonly candidateViolations: readonly string[];
  readonly bounded: boolean;
  readonly deterministic: boolean;
  readonly basis: string;
}

export interface ModelComparisonSummary {
  readonly rows: number;
  readonly oldViolationRows: number;
  readonly candidateViolationRows: number;
  readonly maxAbsDelta: number;
  readonly changedRows: number;
  readonly candidateFixedAll: boolean;
  readonly rowsWithBoundedDelta: number;
  readonly rowsDeterministic: number;
  readonly authoritative: false;
  readonly basis: string;
}

export interface ModelComparison {
  readonly rows: readonly ModelComparisonRow[];
  readonly summary: ModelComparisonSummary;
  readonly invariants: readonly MasteryInvariantVerdict[];
}

/**
 * Run both models over the requested grid and report, per cell, what each model
 * leaves behind. The candidate is judged by whether the invariants hold for its
 * output — not by whether its numbers look nicer.
 */
export function compareMasteryModels(input: {
  readonly bands?: readonly { readonly label: string; readonly mastery: number }[];
  readonly difficulties?: readonly number[];
  readonly repeatCounts?: readonly number[];
} = {}): ModelComparison {
  const bands = input.bands ?? MASTERY_BANDS;
  const difficulties = input.difficulties ?? [1, 3, 5];
  const repeatCounts = input.repeatCounts ?? [1, 3];

  const rows: ModelComparisonRow[] = [];

  for (const band of bands) {
    for (const difficulty of difficulties) {
      for (const repeatCount of repeatCounts) {
        for (const outcome of ['correct', 'incorrect'] as const) {
          let oldState = baseState(band.mastery);
          let candidateState = baseState(band.mastery);
          const oldViolations = new Set<string>();
          const candidateViolations = new Set<string>();
          let bounded = true;
          let deterministic = true;

          for (let repeat = 0; repeat < repeatCount; repeat += 1) {
            const signal: AttemptSignal = { isCorrect: outcome === 'correct', difficulty: difficulty as 1 | 2 | 3 | 4 | 5, role: 'PRIMARY' };

            const productionAfter = updateMasteryAfterAttempt(oldState, signal);
            const oldAudit = auditMasteryTransition({
              model: 'production',
              state: oldState,
              signal,
              after: productionAfter.mastery,
              effectiveTarget: effectiveTargetFor('production', oldState, signal),
            });
            if (!oldAudit.invariants.every((verdict) => verdict.holds)) oldViolations.add(oldAudit.primaryViolation ?? 'D');

            const candidateAfter = updateMasteryDirectionPreserving(candidateState, signal);
            const candidateAudit = auditMasteryTransition({
              model: 'direction_preserving',
              state: candidateState,
              signal,
              after: candidateAfter.mastery,
              effectiveTarget: effectiveTargetFor('direction_preserving', candidateState, signal),
            });
            if (!candidateAudit.invariants.every((verdict) => verdict.holds)) {
              candidateViolations.add(candidateAudit.primaryViolation ?? 'D');
            }
            if (!candidateAudit.invariants.find((verdict) => verdict.id === 'D')!.holds) bounded = false;

            const pairAudit = auditPairDeterminism({ state: oldState, signal, candidateAfter: candidateAfter.mastery });
            if (!pairAudit.holds) deterministic = false;

            oldState = productionAfter;
            candidateState = candidateAfter;
          }

          const delta = round6(candidateState.mastery - oldState.mastery);
          rows.push({
            band: band.label,
            outcome,
            difficulty,
            repeats: repeatCount,
            oldMastery: round4(oldState.mastery),
            candidateMastery: round4(candidateState.mastery),
            masteryDelta: delta,
            direction: delta > MASTERY_EPSILON ? 'higher' : delta < -MASTERY_EPSILON ? 'lower' : 'unchanged',
            oldViolations: [...oldViolations],
            candidateViolations: [...candidateViolations],
            bounded,
            deterministic,
            basis: `掌握度区间 ${band.label}、${outcome === 'correct' ? '正确' : '错误'}复习 ${repeatCount} 次（难度 ${difficulty}）：旧模型 ${round4(oldState.mastery)}，候选 ${round4(candidateState.mastery)}。`
              + (oldViolations.size > 0 ? ` 旧模型违反 ${[...oldViolations].join('/')}。` : '')
              + (candidateViolations.size > 0 ? ` 候选仍违反 ${[...candidateViolations].join('/')}。` : ''),
          });
        }
      }
    }
  }

  const oldViolationRows = rows.filter((row) => row.oldViolations.length > 0).length;
  const candidateViolationRows = rows.filter((row) => row.candidateViolations.length > 0).length;
  const changedRows = rows.filter((row) => row.masteryDelta !== 0).length;
  const maxAbsDelta = rows.length > 0
    ? round4(Math.max(...rows.map((row) => Math.abs(row.masteryDelta))))
    : 0;

  return {
    rows,
    summary: {
      rows: rows.length,
      oldViolationRows,
      candidateViolationRows,
      maxAbsDelta,
      changedRows,
      candidateFixedAll: candidateViolationRows === 0 && oldViolationRows > 0,
      rowsWithBoundedDelta: rows.filter((row) => row.bounded).length,
      rowsDeterministic: rows.filter((row) => row.deterministic).length,
      authoritative: false,
      basis: `比较 ${rows.length} 个组合：旧模型在 ${oldViolationRows} 个组合违反不变量，候选在 ${candidateViolationRows} 个组合违反；`
        + `${changedRows} 个组合两模型结果不同，最大差异 ${maxAbsDelta}。结果非权威，未应用于生产。`,
    },
    invariants: [
      auditPairDeterminism({
        state: baseState(0.5),
        signal: { isCorrect: false, difficulty: 3, role: 'PRIMARY' },
        candidateAfter: updateMasteryDirectionPreserving(baseState(0.5), { isCorrect: false, difficulty: 3, role: 'PRIMARY' }).mastery,
      }),
    ],
  };
}

function baseState(mastery: number): MasteryState {
  return {
    mastery,
    accuracy: mastery,
    recentAccuracy: mastery,
    attempts: 4,
    correctCount: Math.round(4 * mastery),
    wrongCount: 4 - Math.round(4 * mastery),
    confidence: 0.3,
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
