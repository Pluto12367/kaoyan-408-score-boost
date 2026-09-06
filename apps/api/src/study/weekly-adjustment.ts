/**
 * V9 Phase 2 — Adaptive Weekly Planner (pure module).
 *
 * Intensity changes must be earned by last week's evidence: gates passed and
 * real mastery movement raise the load; a negative week lowers it; without
 * enough evidence the planner maintains — never adjusts on a hunch.
 * Carried recovery tasks (ids prefixed carry-) keep their original load.
 */

export interface WeeklyOutcomeFact {
  attemptsInWindow: number;
  masteryGain: number | null;
  gatePassed: boolean;
}

export interface WeeklyAdjustmentInput {
  outcomes: readonly WeeklyOutcomeFact[];
  openDebt: number;
}

export interface WeeklyAdjustment {
  verdict: 'intensity_up' | 'maintain' | 'intensity_down';
  factor: number;
  note: string;
  evidence: { evaluated: number; avgGain: number | null; gatePassed: number };
}

const MIN_EVALUATED_ATTEMPTS = 2;
const UP_GAIN = 0.1;
const MINUTE_FLOOR = 15;
const QUESTION_FLOOR = 5;

export function deriveWeeklyAdjustment(input: WeeklyAdjustmentInput): WeeklyAdjustment {
  const evaluated = input.outcomes.filter((item) => item.attemptsInWindow >= MIN_EVALUATED_ATTEMPTS);
  const gatePassed = evaluated.filter((item) => item.gatePassed).length;
  const gains = evaluated.map((item) => item.masteryGain).filter((gain): gain is number => gain != null);
  const avgGain = gains.length
    ? Math.round((gains.reduce((sum, gain) => sum + gain, 0) / gains.length) * 10000) / 10000
    : null;

  const evidence = { evaluated: evaluated.length, avgGain, gatePassed };

  if (evaluated.length === 0) {
    return {
      verdict: 'maintain',
      factor: 1,
      note: '上周证据不足，维持现有计划强度。',
      evidence,
    };
  }

  if (avgGain != null && avgGain >= UP_GAIN && gatePassed >= 1) {
    return {
      verdict: 'intensity_up',
      factor: 1.2,
      note: `上周 ${gatePassed} 个节点证据充分、平均掌握提升 ${Math.round(avgGain * 100)}%——本周加码 20%。`,
      evidence,
    };
  }

  if (avgGain != null && avgGain < 0) {
    return {
      verdict: 'intensity_down',
      factor: 0.8,
      note: `上周平均掌握回落 ${Math.round(Math.abs(avgGain) * 100)}%——本周降载 20%，先稳节奏。`,
      evidence,
    };
  }

  return {
    verdict: 'maintain',
    factor: 1,
    note: `上周证据有限（充分节点 ${gatePassed} 个），维持现有强度。`,
    evidence,
  };
}

export function applyWeeklyIntensity<T extends { tasks: Array<{ id: string; minutes: number; questionCount: number }> }>(
  plan: T,
  adjustment: Pick<WeeklyAdjustment, 'factor' | 'verdict'> & { evidence?: unknown },
): T {
  if (adjustment.factor === 1) return plan;
  const tasks = plan.tasks.map((task) => {
    if (task.id.startsWith('carry-')) return task;
    return {
      ...task,
      minutes: Math.max(MINUTE_FLOOR, Math.round(task.minutes * adjustment.factor)),
      questionCount: Math.max(QUESTION_FLOOR, Math.round(task.questionCount * adjustment.factor)),
    };
  });
  return { ...plan, tasks };
}
