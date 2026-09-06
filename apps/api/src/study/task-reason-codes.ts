/**
 * V8 backlog #58 — structured reason codes for classic 7-day plan tasks,
 * derived at read time from aggregates that already exist in the service.
 *
 * Honesty rules:
 * - Only codes backed by real evidence are emitted (weakness list membership,
 *   accuracy, wrong counts, exam proximity). Codes needing frequency
 *   snapshots or the prerequisite graph stay exclusive to the score-center
 *   recommendation engine.
 * - Cap of 3, highest task-specific signal first; EXAM_NEAR (the least
 *   specific) is dropped first when the cap hits.
 * - A task on an untracked point far from the exam gets [] — no fabricated
 *   justification.
 */

export interface TaskReasonWeakPoint {
  knowledgePointId: string;
  accuracyRate: number;
  wrongCount: number;
}

export interface TaskReasonContext {
  weakPoints: readonly TaskReasonWeakPoint[];
  remainingDays: number | null;
}

const LOW_ACCURACY_RATE = 55;
const REPEATED_WRONG_COUNT = 2;
const EXAM_NEAR_DAYS = 45;
const MAX_CODES = 3;

export function deriveTaskReasonCodes(
  task: { knowledgePointId: string },
  context: TaskReasonContext,
): string[] {
  const weak = context.weakPoints.find((point) => point.knowledgePointId === task.knowledgePointId);
  if (!weak) return [];

  const codes: string[] = ['LOW_MASTERY'];
  if (weak.accuracyRate < LOW_ACCURACY_RATE) codes.push('LOW_ACCURACY');
  if (weak.wrongCount >= REPEATED_WRONG_COUNT) codes.push('REPEATED_WRONG');
  if (context.remainingDays != null && context.remainingDays <= EXAM_NEAR_DAYS) codes.push('EXAM_NEAR');
  return codes.slice(0, MAX_CODES);
}
