/**
 * V6.2 Intervention Event — pure derivation from existing Source Facts.
 *
 * An InterventionEvent is a DERIVED VIEW built from existing
 * RecommendationAction + StudyTask + StudyTaskCompletion + ReviewSchedule
 * rows. No new tables, no new fact source, fully rebuildable.
 *
 * Event status lifecycle (derived, not stored):
 *   delivered → executed → completed
 *                        → expired (past scheduledDate, not completed)
 *                        → ignored (delivered > N days ago, no user action)
 */

export interface InterventionEvent {
  interventionId: string;
  userId: string;
  type: 'recommendation' | 'study_plan_task' | 'review_task' | 'practice_task' | 'coach_prompt' | 'exam_simulation';
  targetKnowledgeNodeId: string | null;
  targetSubject: string | null;
  source: string;
  createdAt: string;
  executedAt: string | null;
  completedAt: string | null;
  status: 'delivered' | 'executed' | 'completed' | 'expired' | 'ignored';
  /** Links to existing canonical IDs. */
  recommendationActionId: string | null;
  studyTaskId: string | null;
  reviewScheduleId: string | null;
  /** Deterministic idempotency key derived from existing IDs. */
  eventKey: string;
}

export interface RawActionRow {
  id: string;
  userId: string;
  actionType: string;
  status: string;
  creationKey: string;
  studyTaskId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface RawTaskRow {
  id: string;
  knowledgeNodeId: string | null;
  knowledgePointId: string;
  title: string;
  status: string;
  scheduledDate: string;
  completed: boolean;
  completedAt: Date | string | null;
  startedAt: Date | string | null;
  planId: string;
}

export interface RawCompletionRow {
  taskId: string;
  completedDate: string;
  completedAt: Date | string;
}

export interface RawReviewRow {
  id: string;
  userId: string;
  questionId: string;
  stability: string;
  consecutiveCorrect: number;
  nextReviewAt: Date | string;
  createdAt: Date | string;
}

const IGNORE_DAYS = 7;

function toISO(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.toISOString();
}

/**
 * Derive InterventionEvents from real DB rows.
 * Pure function: same input → same output (rebuildable).
 */
export function deriveInterventionEvents(params: {
  actions: readonly RawActionRow[];
  tasks: readonly RawTaskRow[];
  completions: readonly RawCompletionRow[];
  reviews: readonly RawReviewRow[];
  asOf: string;
}): InterventionEvent[] {
  const events: InterventionEvent[] = [];
  const now = new Date(params.asOf).getTime();
  const completionByTask = new Map(params.completions.map((c) => [c.taskId, c]));
  const taskById = new Map(params.tasks.map((t) => [t.id, t]));

  // ---- Recommendation + Planner interventions (from RecommendationAction) ----
  for (const action of params.actions) {
    const task = action.studyTaskId ? taskById.get(action.studyTaskId) : undefined;
    const completion = action.studyTaskId ? completionByTask.get(action.studyTaskId) : undefined;
    const createdAt = toISO(action.createdAt) ?? params.asOf;
    const executedAt = task?.startedAt ? toISO(task.startedAt) : null;
    const completedAt = completion ? toISO(completion.completedAt) : toISO(task?.completedAt ?? null);

    let status: InterventionEvent['status'];
    if (completedAt) status = 'completed';
    else if (executedAt) status = 'executed';
    else {
      const ageMs = now - new Date(createdAt).getTime();
      const scheduledDate = task?.scheduledDate;
      if (scheduledDate && new Date(scheduledDate + 'T23:59:59').getTime() < now) {
        status = 'expired';
      } else if (ageMs > IGNORE_DAYS * 86_400_000) {
        status = 'ignored';
      } else {
        status = 'delivered';
      }
    }

    const type: InterventionEvent['type'] = task ? 'study_plan_task' : 'recommendation';
    events.push({
      interventionId: action.id,
      userId: action.userId,
      type,
      targetKnowledgeNodeId: task?.knowledgeNodeId ?? null,
      targetSubject: null,
      source: 'recommendation_engine',
      createdAt,
      executedAt,
      completedAt,
      status,
      recommendationActionId: action.id,
      studyTaskId: action.studyTaskId ?? null,
      reviewScheduleId: null,
      eventKey: `intervention:${action.creationKey}`,
    });
  }

  // ---- Review interventions (from ReviewSchedule) ----
  for (const review of params.reviews) {
    const createdAt = toISO(review.createdAt) ?? params.asOf;
    const isDue = new Date(review.nextReviewAt as string).getTime() <= now;
    const status: InterventionEvent['status'] = review.consecutiveCorrect >= 3 ? 'completed' : isDue ? 'delivered' : 'delivered';
    events.push({
      interventionId: review.id,
      userId: review.userId,
      type: 'review_task',
      targetKnowledgeNodeId: null,
      targetSubject: null,
      source: 'review_engine',
      createdAt,
      executedAt: null,
      completedAt: review.consecutiveCorrect >= 3 ? createdAt : null,
      status,
      recommendationActionId: null,
      studyTaskId: null,
      reviewScheduleId: review.id,
      eventKey: `intervention:review:${review.id}`,
    });
  }

  // Deduplicate by eventKey (idempotency)
  const seen = new Set<string>();
  return events.filter((event) => {
    if (seen.has(event.eventKey)) return false;
    seen.add(event.eventKey);
    return true;
  });
}

/**
 * User Action Correlation: classify student response to an intervention.
 */
export type UserActionStatus = 'executed' | 'ignored' | 'expired' | 'completed' | 'partial';

export function correlateUserAction(
  event: InterventionEvent,
  practiceRecords: readonly { questionId: string; submittedAt: string }[],
): { status: UserActionStatus; detail: string } {
  if (event.status === 'completed') return { status: 'completed', detail: 'task completed' };
  if (event.status === 'expired') return { status: 'expired', detail: 'past scheduled date, not completed' };

  // Check if there's a practice record after the intervention was delivered
  const createdAt = new Date(event.createdAt).getTime();
  const matchingPractice = practiceRecords.find((record) =>
    new Date(record.submittedAt).getTime() >= createdAt,
  );
  if (matchingPractice) return { status: 'executed', detail: 'student practiced after intervention' };

  const ageDays = (Date.now() - createdAt) / 86_400_000;
  if (ageDays > IGNORE_DAYS) return { status: 'ignored', detail: 'no user action within 7 days' };

  return { status: 'partial', detail: 'delivered but not yet acted upon' };
}

/**
 * Outcome Correlation: link intervention events to learning outcomes.
 * Correlation ≠ causation — the output only claims association.
 */
export function correlateOutcome(
  event: InterventionEvent,
  outcomes: readonly { knowledgeNodeId: string | null; interventionId: string | null; deltas: { masteryGain: number | null } }[],
): { matched: boolean; method: string; masteryGain: number | null } {
  // Direct: outcome explicitly references this intervention
  const direct = outcomes.find((o) => o.interventionId === event.interventionId);
  if (direct) return { matched: true, method: 'direct', masteryGain: direct.deltas.masteryGain };

  // Knowledge node: outcome node matches event target
  if (event.targetKnowledgeNodeId) {
    const byNode = outcomes.find((o) => o.knowledgeNodeId === event.targetKnowledgeNodeId);
    if (byNode) return { matched: true, method: 'knowledge_node', masteryGain: byNode.deltas.masteryGain };
  }

  return { matched: false, method: 'none', masteryGain: null };
}