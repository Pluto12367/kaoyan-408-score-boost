/**
 * V8 backlog #13 — missed-day recovery (pure module).
 *
 * When a student returns after the 7-day window lapsed, the plan rebuild used
 * to drop every open overdue task silently. Recovery harvests the most
 * overdue open tasks (cap 3, oldest first) and re-anchors them onto the first
 * days of the fresh window — a light re-entry instead of guilt or amnesia.
 * Dependency-free: the service wires it into getTodayPlan's rebuild branch.
 */

import type { ScheduledStudyTaskState } from './onboarding-plan.repository';

export const CARRY_OVER_LIMIT = 3;

export interface RecoveredGapInfo {
  carriedCount: number;
  recoveredOn: string;
}

/** Open = not completed (in_progress counts: the student had started it). */
export function harvestCarryOverTasks(
  tasks: readonly ScheduledStudyTaskState[],
  today: string,
  limit = CARRY_OVER_LIMIT,
): ScheduledStudyTaskState[] {
  return tasks
    .filter((task) => task.status !== 'completed' && task.scheduledDate < today)
    .sort((left, right) =>
      left.scheduledDate.localeCompare(right.scheduledDate)
      || left.id.localeCompare(right.id))
    .slice(0, limit);
}

function dateKeyFromOffset(today: string, offset: number): string {
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function applyCarryOver<T extends { tasks: ScheduledStudyTaskState[] }>(
  plan: T,
  carryOver: readonly ScheduledStudyTaskState[],
  today: string,
): T & { recoveredFromGap?: RecoveredGapInfo } {
  if (carryOver.length === 0) return plan;
  const augmented = [...plan.tasks];
  carryOver.forEach((task, index) => {
    const scheduledDate = dateKeyFromOffset(today, index);
    const { startedAt, nextAvailableAt, completedAt, ...rest } = task;
    const carried: ScheduledStudyTaskState = {
      ...rest,
      id: `carry-${index + 1}-${task.id}`,
      scheduledDate,
      status: 'pending',
      postponeCount: 0,
      reason: `断档补做：${task.reason || task.title}`,
    };
    const firstIndexOfDay = augmented.findIndex((candidate) => candidate.scheduledDate === scheduledDate);
    if (firstIndexOfDay >= 0) augmented.splice(firstIndexOfDay, 0, carried);
    else augmented.push(carried);
  });
  return {
    ...plan,
    tasks: augmented,
    recoveredFromGap: { carriedCount: carryOver.length, recoveredOn: today },
  };
}
