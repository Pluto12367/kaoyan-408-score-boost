// TodayPlanSnapshot is a read-only derived projection for Today/Plan read model.
// It aggregates only facts; it must not contain presentation copy, recommendation
// strategy, sorting results, or legacy DTO shapes. The snapshot is assembled from
// StudentState, StudyPlan/StudyTask, StudyTaskProgress, PracticeRecord/ReviewSchedule,
// ActivityProjection, UserKnowledgeMastery, and optional ScoreCenter facts.
//
// Fact-source boundaries:
// - planFacts: StudyPlan / OnboardingPlan facts (phase, window, checkpoint state)
// - taskFacts: StudyTask + StudyTaskProgress facts for today and week window
// - reviewFacts: ReviewSchedule facts projected as due/overdue counts
// - activityFacts: ActivityProjection / streak facts
// - masteryFacts: UserKnowledgeMastery projection facts
// - scoreFacts: optional ScoreCenter raw facts (not recommendation copy)

// ---- Plan facts ----
// Source: StudyPlan / OnboardingPlanRepository
// Reuses StudentState: No - plan window/phase is not in base StudentStateSnapshot
// Legacy DTO needs: phase -> TodayPlan.phase, checkpointState -> checkpoint copy (adapter)
export interface TodayPlanPlanFacts {
  // planId: StudyPlan.id fact
  planId: string | null;
  // phase: StudyPlan.phase fact (e.g. 强化/冲刺)
  phase: string;
  // status: StudyPlan.status fact
  status: string;
  // windowStart: plan window start date key (YYYY-MM-DD)
  windowStart: string;
  // windowEnd: plan window end date key
  windowEnd: string;
  // generatedAt: plan generation ISO time
  generatedAt: string | null;
  // checkpointState: raw checkpoint state, not UI message
  checkpointState: string | null;
}

// ---- Task facts ----
// Source: StudyTask + StudyTaskProgress + task associations
// Reuses StudentState: Partial - studyTasks.today/counts are in StudentStateSnapshot,
//   but taskFacts here keeps full task association facts (knowledgePointId, questionIds, progress)
// Legacy DTO needs: todayTasks -> priorityTasks base, counts -> summary, weekDays -> weekProgress
export interface TodayPlanTaskProgressFacts {
  completedQuestionCount: number;
  correctCount: number;
  minutesSpent: number;
  reachedTarget: boolean;
}

export interface TodayPlanTaskFact {
  // id: StudyTask.id
  id: string;
  // knowledgePointId: StudyTask.knowledgePointId / task-node association
  knowledgePointId: string;
  // questionIds: StudyTask -> Question association facts
  questionIds: string[] | null;
  // title: StudyTask.title
  title: string;
  // subject: KnowledgePoint/KnowledgeNode subject fact
  subject: string;
  // chapter: KnowledgePoint/KnowledgeNode chapter fact
  chapter: string;
  // minutes: StudyTask.minutes
  minutes: number;
  // questionCount: StudyTask.questionCount
  questionCount: number;
  // mode: StudyTask.mode
  mode: string;
  // priority: StudyTask.priority
  priority: string;
  // scheduledDate: StudyTask.scheduledDate (YYYY-MM-DD)
  scheduledDate: string;
  // status: StudyTask.status (pending/in_progress/postponed/completed)
  status: string;
  // completed: StudyTask.completed boolean fact
  completed: boolean;
  // completedAt: StudyTask.completedAt
  completedAt: string | null;
  // startedAt: task start time fact
  startedAt: string | null;
  // postponeCount: derived from TaskPostpone fact count
  postponeCount: number;
  // nextAvailableAt: postpone next available time
  nextAvailableAt: string | null;
  // progress: StudyTaskProgress fact
  progress: TodayPlanTaskProgressFacts | null;
}

export interface TodayPlanWeekDayFacts {
  date: string;
  taskCount: number;
  completedTasks: number;
  totalMinutes: number;
  focusKnowledgePointId: string | null;
  focusCompleted: boolean | null;
}

export interface TodayPlanTaskFacts {
  // todayTasks: StudyTask facts for asOf date (unsorted facts)
  todayTasks: TodayPlanTaskFact[];
  // counts: aggregated task status counts
  counts: {
    pending: number;
    inProgress: number;
    postponed: number;
    completed: number;
  };
  // weekDays: week window task aggregates
  weekDays: TodayPlanWeekDayFacts[];
}

// ---- Review facts ----
// Source: ReviewSchedule (stability, nextReviewAt)
// Reuses StudentState: Yes - reviewDue is computed the same way as StudentStateSnapshot.reviewDue
// Legacy DTO needs: dueCount -> TodayPlan.reviewDue (legacy single number)
export interface TodayPlanReviewFacts {
  dueCount: number;
  overdueCount: number;
  nextReviewAt: string | null;
  items: Array<{
    questionId: string;
    nextReviewAt: string;
    reviewCount: number;
    stability: string;
    overdue: boolean;
  }>;
}

// ---- Activity facts ----
// Source: ActivityProjection / PracticeRecord aggregated activity
// Reuses StudentState: Indirect - streak can be derived from activity projection; kept explicit here
// Legacy DTO needs: streakDays -> TodayPlan.summary.streakDays
export interface TodayPlanActivityFacts {
  streakDays: number;
  isActiveToday: boolean;
  latestActivityAt: string | null;
}

// ---- Mastery facts ----
// Source: UserKnowledgeMastery projection
// Reuses StudentState: Yes - mastery/mastery weakPoints are from StudentState/masterySummary
// Legacy DTO needs: not directly in TodayPlan DTO, used for phase/checkpoint input facts
export interface TodayPlanMasteryFacts {
  source: 'user_knowledge_mastery' | 'empty';
  averageMastery: number;
  weakCount: number;
  reviewCount: number;
  masteredCount: number;
  lastUpdatedAt: string | null;
  weakPoints: Array<{
    knowledgeNodeId: string;
    subject: string;
    chapter: string;
    title: string;
    masteryRate: number;
    accuracyRate: number;
    attempts: number;
    wrongCount: number;
  }>;
}

// ---- Score facts ----
// Source: ScoreCenter plan projection (optional facts)
// Reuses StudentState: No - StudentState does not include scoreCenter plan
// Legacy DTO needs: scoreCenter -> TodayPlan.scoreCenter (legacy optional field)
export interface TodayPlanScoreFacts {
  available: boolean;
  generatedAt: string | null;
  // raw: raw score center facts if available, null otherwise; never contains UI copy
  raw: unknown | null;
}

// ---- Root snapshot ----
// Source: composed read model from StudentState + Plan/Task + Review + Activity + Mastery + ScoreCenter
// Reuses StudentState: Aggregates existing StudentState fields (reviewDue, mastery, tasks) into plan-centric view
// Legacy DTO needs: snapshot is source for adapter to produce legacy TodayPlan DTO
export interface TodayPlanSnapshot {
  source: 'today_plan_student_state_score_center';
  userId: string;
  asOf: string;
  planFacts: TodayPlanPlanFacts;
  taskFacts: TodayPlanTaskFacts;
  reviewFacts: TodayPlanReviewFacts;
  activityFacts: TodayPlanActivityFacts;
  masteryFacts: TodayPlanMasteryFacts;
  scoreFacts: TodayPlanScoreFacts;
}

export interface BuildTodayPlanSnapshotInput {
  userId: string;
  asOf: Date | string;
  planFacts: TodayPlanPlanFacts;
  taskFacts: TodayPlanTaskFacts;
  reviewFacts: TodayPlanReviewFacts;
  activityFacts: TodayPlanActivityFacts;
  masteryFacts: TodayPlanMasteryFacts;
  scoreFacts: TodayPlanScoreFacts;
}

export function buildTodayPlanSnapshot(input: BuildTodayPlanSnapshotInput): TodayPlanSnapshot {
  return {
    source: 'today_plan_student_state_score_center',
    userId: input.userId,
    asOf: toIso(input.asOf),
    planFacts: {
      planId: input.planFacts.planId,
      phase: input.planFacts.phase,
      status: input.planFacts.status,
      windowStart: input.planFacts.windowStart,
      windowEnd: input.planFacts.windowEnd,
      generatedAt: toIsoOrNull(input.planFacts.generatedAt),
      checkpointState: input.planFacts.checkpointState,
    },
    taskFacts: {
      todayTasks: input.taskFacts.todayTasks.map((task) => ({
        id: task.id,
        knowledgePointId: task.knowledgePointId,
        questionIds: task.questionIds ? [...task.questionIds] : null,
        title: task.title,
        subject: task.subject,
        chapter: task.chapter,
        minutes: task.minutes,
        questionCount: task.questionCount,
        mode: task.mode,
        priority: task.priority,
        scheduledDate: task.scheduledDate,
        status: task.status,
        completed: task.completed,
        completedAt: toIsoOrNull(task.completedAt),
        startedAt: toIsoOrNull(task.startedAt),
        postponeCount: task.postponeCount,
        nextAvailableAt: toIsoOrNull(task.nextAvailableAt),
        progress: task.progress
          ? {
              completedQuestionCount: task.progress.completedQuestionCount,
              correctCount: task.progress.correctCount,
              minutesSpent: task.progress.minutesSpent,
              reachedTarget: task.progress.reachedTarget,
            }
          : null,
      })),
      counts: { ...input.taskFacts.counts },
      weekDays: input.taskFacts.weekDays.map((day) => ({ ...day })),
    },
    reviewFacts: {
      dueCount: input.reviewFacts.dueCount,
      overdueCount: input.reviewFacts.overdueCount,
      nextReviewAt: toIsoOrNull(input.reviewFacts.nextReviewAt),
      items: input.reviewFacts.items.map((item) => ({
        questionId: item.questionId,
        nextReviewAt: toIso(item.nextReviewAt),
        reviewCount: item.reviewCount,
        stability: item.stability,
        overdue: item.overdue,
      })),
    },
    activityFacts: {
      streakDays: input.activityFacts.streakDays,
      isActiveToday: input.activityFacts.isActiveToday,
      latestActivityAt: toIsoOrNull(input.activityFacts.latestActivityAt),
    },
    masteryFacts: {
      source: input.masteryFacts.source,
      averageMastery: input.masteryFacts.averageMastery,
      weakCount: input.masteryFacts.weakCount,
      reviewCount: input.masteryFacts.reviewCount,
      masteredCount: input.masteryFacts.masteredCount,
      lastUpdatedAt: toIsoOrNull(input.masteryFacts.lastUpdatedAt),
      weakPoints: input.masteryFacts.weakPoints.map((point) => ({ ...point })),
    },
    scoreFacts: {
      available: input.scoreFacts.available,
      generatedAt: toIsoOrNull(input.scoreFacts.generatedAt),
      raw: input.scoreFacts.raw ?? null,
    },
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toIsoOrNull(value: Date | string | null): string | null {
  return value == null ? null : toIso(value);
}
