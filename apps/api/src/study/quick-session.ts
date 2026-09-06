/**
 * V8 backlog #12 — time-budget quick sessions (pure module).
 *
 * The recommended practice set was sized for a fixed 60-minute session.
 * Fragment-schedule students ("我现在只有 15 分钟") get a minutes-scaled
 * set instead: the base tier count shrinks to 5/10 questions for 15/30
 * minute budgets and is untouched from 60 minutes up.
 */

/** Clamped budget floor/ceiling in minutes. */
export const MIN_MINUTES_BUDGET = 10;
export const MAX_MINUTES_BUDGET = 120;

/** Parse the raw query value into a clamped budget; null = no budget (default flow). */
export function parseMinutesBudget(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return null;
  return Math.min(MAX_MINUTES_BUDGET, Math.max(MIN_MINUTES_BUDGET, parsed));
}

/**
 * Scale the base tier count down for small budgets. baseCount is the
 * existing per-stage sizing (冲刺 20 / 补强 16 / 标准 12) — never increased.
 */
export function questionCountForMinutes(minutes: number, baseCount: number): number {
  if (minutes <= 15) return Math.min(5, baseCount);
  if (minutes <= 30) return Math.min(10, baseCount);
  return baseCount;
}
