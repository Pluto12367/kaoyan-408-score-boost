/**
 * M3 Phase-C migration switch — mastery semantics selector.
 *
 * ## What this is
 *
 * The single place that decides WHICH mastery transition the system applies.
 * The owner approved candidate C1 (direction-preserving) and rejected C2, but
 * explicitly did not authorise enabling it, so:
 *
 *   default      = legacy   (today's production behaviour, bit-identical)
 *   opt-in       = c1       (explicitly set MASTERY_SEMANTICS=c1)
 *
 * Reused conventions rather than a new flag system: the project already gates
 * behaviour on `process.env.X === 'true'` (ALLOW_DEMO_AUTH,
 * ALLOW_FAKE_DOCUMENT_PROVIDER, USE_KNODE_MASTERY), so this follows the same
 * shape — a plain env string with a safe default.
 *
 * ## Why a mapping table instead of renaming
 *
 * The mechanism was built and measured under the name `direction_preserving`
 * (see mastery-candidate.ts). The owner refers to it as C1. Rather than rename
 * working, measured code and risk a silent drift, the two vocabularies are
 * joined by ONE exported table, so there is still exactly one place that knows
 * the correspondence.
 *
 * ## Reversibility
 *
 * Rolling back is unsetting the variable: no schema change, no data migration,
 * no code change. What a rollback does NOT do is undo mastery values already
 * written while C1 was active — those stay, because rewriting history is exactly
 * what a mastery source of truth must not do. That is stated in the report.
 *
 * Pure functions only; no IO, no clock.
 */

import type { AttemptSignal, MasteryState } from './types';
import { updateMasteryAfterAttempt } from './mastery';
import { updateMasteryDirectionPreserving } from './mastery-candidate';
import type { MasteryModelId } from './mastery-semantics';

/** The switch vocabulary operators use. */
export type MasterySemanticsId = 'legacy' | 'c1';

/** Environment variable that selects the semantics. */
export const MASTERY_SEMANTICS_ENV = 'MASTERY_SEMANTICS';

/** Safe default: without an explicit opt-in the system behaves as it does today. */
export const DEFAULT_MASTERY_SEMANTICS: MasterySemanticsId = 'legacy';

/**
 * The one place that joins the operator vocabulary to the mechanism vocabulary.
 * `c1` is the owner-approved name; `direction_preserving` is the measured
 * mechanism.
 */
export const MASTERY_SEMANTICS_MODEL: Readonly<Record<MasterySemanticsId, MasteryModelId>> = {
  legacy: 'production',
  c1: 'direction_preserving',
};

export interface MasterySemanticsSpec {
  readonly id: MasterySemanticsId;
  readonly model: MasteryModelId;
  readonly label: string;
  readonly description: string;
  readonly approved: boolean;
}

export const MASTERY_SEMANTICS_CATALOGUE: readonly MasterySemanticsSpec[] = [
  {
    id: 'legacy',
    model: 'production',
    label: 'legacy（现行生产语义）',
    description: 'EMA 拉向按结果给定的目标值；不动点为该目标值。默认值，行为与切换前逐位一致。',
    approved: true,
  },
  {
    id: 'c1',
    model: 'direction_preserving',
    label: 'C1 方向保持（所有者已批准）',
    description:
      '目标值不变，但生效目标夹在当前估计本侧：correct → max(raw, mastery)、wrong → min(raw, mastery)。'
      + '均衡点与 legacy 相同，差异只在瞬态；修复"错误复习提升掌握度"的方向违反。',
    approved: true,
  },
] as const;

/**
 * Parse the env value. Anything other than an exact, known, lower-case id falls
 * back to legacy, so a typo cannot silently enable a semantic change.
 */
export function parseMasterySemantics(value: string | undefined | null): MasterySemanticsId {
  if (typeof value !== 'string') return DEFAULT_MASTERY_SEMANTICS;
  const normalised = value.trim().toLowerCase();
  return normalised === 'c1' ? 'c1' : DEFAULT_MASTERY_SEMANTICS;
}

/** Resolve the active semantics from an environment bag (defaults to process.env). */
export function resolveMasterySemantics(
  env: Record<string, string | undefined> = typeof process === 'undefined' ? {} : process.env,
): MasterySemanticsId {
  return parseMasterySemantics(env?.[MASTERY_SEMANTICS_ENV]);
}

/** True when the operator has explicitly opted into the approved candidate. */
export function isCandidateEnabled(
  env: Record<string, string | undefined> = typeof process === 'undefined' ? {} : process.env,
): boolean {
  return resolveMasterySemantics(env) === 'c1';
}

/**
 * Apply the selected semantics. This is the only entry point production should
 * use; with the default it delegates to the unchanged production transition.
 */
export function applyMasterySemantics(
  semantics: MasterySemanticsId,
  state: MasteryState,
  signal: AttemptSignal,
): MasteryState {
  return MASTERY_SEMANTICS_MODEL[semantics] === 'direction_preserving'
    ? updateMasteryDirectionPreserving(state, signal)
    : updateMasteryAfterAttempt(state, signal);
}

/**
 * Auditable one-line description for startup logs, mirroring the existing
 * `Demo auth: enabled/disabled` style so an operator can see which semantics a
 * running process is using.
 */
export function describeMasterySemantics(
  env: Record<string, string | undefined> = typeof process === 'undefined' ? {} : process.env,
): string {
  const active = resolveMasterySemantics(env);
  const spec = MASTERY_SEMANTICS_CATALOGUE.find((entry) => entry.id === active)!;
  const raw = env?.[MASTERY_SEMANTICS_ENV];
  const note = active === DEFAULT_MASTERY_SEMANTICS
    ? raw === undefined
      ? '（未设置，使用默认）'
      : `（已设置 "${raw}"，非 c1，回落默认）`
    : '（显式启用）';
  return `Mastery semantics: ${active} — ${spec.label}${note}`;
}
