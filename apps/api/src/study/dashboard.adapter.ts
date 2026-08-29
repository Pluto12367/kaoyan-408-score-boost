import type { DashboardSnapshot } from './dashboard.snapshot';

export interface LegacyDashboardOverviewDto {
  source: string;
  generatedAt: string;
  student: Record<string, unknown>;
  knowledgePoints: unknown[];
  questions: unknown[];
  practiceRecords: unknown[];
  wrongQuestions: unknown[];
  learningCalendar: Record<string, unknown>;
  stageAssessment: Record<string, unknown>;
  report: Record<string, unknown>;
  plan: Record<string, unknown>;
  scoreCenter: unknown | null;
}

export function toLegacyDashboardOverview(
  snapshot: DashboardSnapshot,
  generatedAt = snapshot.asOf,
): LegacyDashboardOverviewDto {
  const goal = asRecord(snapshot.stateFacts.goal);
  const mastery = asRecord(snapshot.stateFacts.mastery);
  const wrong = snapshot.wrongQuestionFacts;
  const plan = snapshot.todayPlanFacts;
  const assessment = snapshot.assessmentFacts;

  return {
    source: snapshot.source,
    generatedAt,
    student: {
      id: snapshot.userId,
      ...goal,
    },
    knowledgePoints: [],
    questions: [],
    practiceRecords: snapshot.practiceFacts.records.map((record) => ({ ...record })),
    wrongQuestions: Array.from({ length: wrong.total }, (_, index) => ({
      questionId: `wrong-${index + 1}`,
      reviewed: index < wrong.reviewed,
      resolved: index >= wrong.unresolved,
    })),
    learningCalendar: {
      source: 'student_state',
      latestActivityAt: snapshot.sessionFacts.latestActiveAt,
      isActiveToday: snapshot.sessionFacts.activeCount > 0,
    },
    stageAssessment: {
      attemptCount: assessment.attemptCount,
      bestScore: assessment.bestScore,
      latestScore: assessment.latestScore,
      latestAccuracyRate: assessment.latestAccuracyRate,
    },
    report: {
      mastery,
      weakPoints: snapshot.stateFacts.weakPoints.map((point) => ({ ...asRecord(point) })),
      wrongQuestionCount: wrong.total,
      dueReviewCount: wrong.dueCount,
    },
    plan: {
      planId: plan.planId,
      phase: plan.phase,
      status: plan.status,
      todayTaskCount: plan.todayTaskCount,
      completedTaskCount: plan.completedTaskCount,
      completionRate: plan.completionRate,
      reviewDue: plan.reviewDueCount,
    },
    scoreCenter: null,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}
