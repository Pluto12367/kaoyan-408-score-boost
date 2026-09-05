/**
 * Canonical StudentContext v1.
 *
 * This module contains only the read-model contract and small value helpers.
 * It deliberately has no framework, database, clock, or recommendation
 * dependencies so the selector and its callers can remain deterministic.
 */

export const STUDENT_CONTEXT_VERSION = 'student-context-v1' as const;

export type StudentContextTrendStatus = 'sufficient' | 'insufficient_data';

export type StudentContextWindow =
  | 'last7d'
  | 'last30d'
  | 'assessment'
  | 'all_time'
  | (string & {});

export interface StudentContextTrend<T> {
  readonly window: StudentContextWindow;
  readonly baseline: T | null;
  readonly sampleSize: number;
  readonly status: StudentContextTrendStatus;
  readonly value: T | null;
}

export function createInsufficientTrend<T>(window: StudentContextWindow): StudentContextTrend<T> {
  return {
    window,
    baseline: null,
    sampleSize: 0,
    status: 'insufficient_data',
    value: null,
  };
}

export function createSufficientTrend<T>(
  window: StudentContextWindow,
  value: T,
  baseline: T,
  sampleSize: number,
): StudentContextTrend<T> {
  return {
    window,
    baseline,
    sampleSize,
    status: 'sufficient',
    value,
  };
}

export interface StudentContextProfile {
  readonly userId: string;
  readonly name: string | null;
  readonly role: string | null;
  readonly targetSchool: string | null;
  readonly weakestSubject: string | null;
  readonly diagnosis: string | null;
}

export interface StudentContextExam {
  readonly examYear: number | null;
  readonly targetScore: number | null;
  readonly currentScore: number | null;
  readonly remainingDays: number | null;
  readonly studyStage: string | null;
}

export interface StudentContextNodeMastery {
  readonly knowledgeNodeId: string;
  readonly subject: string;
  readonly chapter: string;
  readonly title: string;
  readonly mastery: number;
  readonly accuracy: number | null;
  readonly attempts: number;
  readonly wrongCount: number;
  readonly status: string;
  readonly updatedAt: string | null;
}

export interface StudentContextPracticeWeakness {
  readonly knowledgePointId: string;
  readonly subject: string;
  readonly chapter: string;
  readonly title: string;
  readonly attempts: number;
  readonly wrongCount: number;
  readonly accuracy: number | null;
  readonly latestAt: string | null;
}

export interface StudentContextMastery {
  readonly source: 'user_knowledge_mastery' | 'empty';
  readonly weakNodes: readonly StudentContextNodeMastery[];
  /** Point-level practice weakness; this is not synthetic point mastery. */
  readonly weakPoints: readonly StudentContextPracticeWeakness[];
  /** Despite the historical name, these rows retain node identity and include review-stage mastery nodes. */
  readonly improvingPoints: readonly StudentContextNodeMastery[];
  /** Despite the historical name, these rows retain node identity. */
  readonly masteredPoints: readonly StudentContextNodeMastery[];
  readonly lastUpdatedAt: string | null;
}

export interface StudentContextPractice {
  readonly source: 'practice_record' | 'empty';
  readonly recentAccuracy: StudentContextTrend<number>;
  readonly recentVolume: StudentContextTrend<number>;
  readonly subjectDistribution: {
    readonly status: StudentContextTrendStatus;
    readonly items: readonly { readonly subject: string; readonly count: number; readonly share: number }[];
  };
  readonly totalCount: number;
  readonly latestSubmittedAt: string | null;
}

export interface StudentContextHighRiskQuestion {
  readonly questionId: string;
  readonly knowledgePointId: string | null;
  readonly wrongCount: number;
  readonly overdue: boolean;
  readonly nextReviewAt: string | null;
  readonly stability: string | null;
}

export interface StudentContextReview {
  readonly source: 'review_schedule' | 'empty';
  readonly dueCount: number;
  readonly overdueCount: number;
  readonly reviewedCount: number;
  readonly resolvedCount: number;
  readonly highRiskQuestions: readonly StudentContextHighRiskQuestion[];
  readonly nextReviewAt: string | null;
}

export interface StudentContextTask {
  readonly studyTaskId: string;
  readonly actionId: string | null;
  readonly title: string;
  readonly status: string;
  readonly scheduledDate: string;
  readonly completed: boolean;
  readonly completedAt: string | null;
  readonly knowledgePointId: string | null;
  readonly knowledgeNodeId: string | null;
  readonly minutes: number;
  readonly questionCount: number;
}

export interface StudentContextPlan {
  readonly source: 'study_plan' | 'empty';
  readonly planId: string | null;
  readonly todayTasks: readonly StudentContextTask[];
  readonly completion: {
    readonly completedCount: number;
    readonly totalCount: number;
    readonly rate: StudentContextTrend<number>;
  };
}

export interface StudentContextSession {
  readonly learningSessionId: string;
  readonly actionId: string | null;
  readonly type: string;
  readonly startedAt: string;
  readonly lastActiveAt: string;
  readonly completed: boolean;
}

export interface StudentContextMomentum {
  readonly studyStreak: number;
  readonly recentSessions: readonly StudentContextSession[];
  readonly activityTrend: StudentContextTrend<number>;
}

export interface StudentContextEvidence {
  readonly source: string;
  readonly timestamp: string | null;
  readonly knowledgeNodeId?: string;
  readonly knowledgePointId?: string;
  readonly actionId?: string;
  readonly studyTaskId?: string;
  readonly referenceId?: string;
}

export interface StudentContextFreshness {
  readonly asOf: string;
  readonly status: StudentContextTrendStatus;
  readonly sources: readonly {
    readonly source: string;
    readonly observedAt: string | null;
    readonly status: 'available' | 'unavailable';
  }[];
}

export interface StudentContext {
  readonly version: typeof STUDENT_CONTEXT_VERSION;
  readonly userId: string;
  readonly asOf: string;
  readonly freshness: StudentContextFreshness;
  readonly profile: StudentContextProfile;
  readonly exam: StudentContextExam;
  readonly mastery: StudentContextMastery;
  readonly practice: StudentContextPractice;
  readonly review: StudentContextReview;
  readonly plan: StudentContextPlan;
  readonly momentum: StudentContextMomentum;
  readonly recommendationEvidence: readonly StudentContextEvidence[];
}

