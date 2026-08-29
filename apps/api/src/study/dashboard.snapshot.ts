// DashboardSnapshot is a read-only fact projection for the dashboard aggregate.
// It deliberately does not model the legacy DTO or presentation strategy.
// Fact boundaries:
// - stateFacts: StudentStateProjectionService / StudentStateSnapshot
// - wrongQuestionFacts: WrongQuestionProjectionService / WrongQuestionSnapshot
// - todayPlanFacts: TodayPlanProjectionService / TodayPlanSnapshot
// - practiceFacts: PracticeRecord facts, only when dashboard history is requested
// - sessionFacts: LearningSession facts, only when session activity is requested
// - assessmentFacts: assessment persistence/projection facts

export interface DashboardStateFacts {
  source: 'student_state' | 'empty';
  goal: unknown | null;
  mastery: unknown | null;
  weakPoints: unknown[];
  activity: unknown | null;
}

export interface DashboardWrongQuestionFacts {
  source: 'wrong_question_projection' | 'empty';
  total: number;
  unresolved: number;
  reviewed: number;
  resolved: number;
  latestWrongAt: string | null;
  dueCount: number;
}

export interface DashboardTodayPlanFacts {
  source: 'today_plan_projection' | 'empty';
  planId: string | null;
  phase: string | null;
  status: string | null;
  todayTaskCount: number;
  completedTaskCount: number;
  completionRate: number;
  reviewDueCount: number;
  asOf: string;
}

export interface DashboardPracticeFact {
  id: string;
  userId: string;
  questionId: string;
  knowledgePointId: string | null;
  correct: boolean;
  timeSpentSec: number;
  mistakeReason: string | null;
  submittedAt: string;
  variantQuestionId: string | null;
}

export interface DashboardPracticeFacts {
  source: 'practice_record' | 'empty';
  totalCount: number;
  todayCount: number;
  correctCount: number;
  accuracy: number;
  lastPracticeAt: string | null;
  studyDuration: number;
  latestSubmittedAt: string | null;
  records: DashboardPracticeFact[];
}

export interface DashboardSessionFact {
  id: string;
  userId: string;
  type: string;
  startedAt: string;
  lastActiveAt: string;
  completed: boolean;
}

export interface DashboardLearningSessionFacts {
  source: 'learning_session' | 'empty';
  activeCount: number;
  latestActiveAt: string | null;
  sessions: DashboardSessionFact[];
}

export interface DashboardAssessmentFacts {
  source: 'assessment' | 'empty';
  attemptCount: number;
  bestScore: number | null;
  latestScore: number | null;
  lastAssessmentAt: string | null;
  latestAccuracyRate: number | null;
  latestSubmittedAt: string | null;
  history: Array<{ id: string; score: number; submittedAt: string }>;
}

export interface DashboardSnapshot {
  source: 'dashboard_facts';
  userId: string;
  asOf: string;
  stateFacts: DashboardStateFacts;
  wrongQuestionFacts: DashboardWrongQuestionFacts;
  todayPlanFacts: DashboardTodayPlanFacts;
  practiceFacts: DashboardPracticeFacts;
  sessionFacts: DashboardLearningSessionFacts;
  assessmentFacts: DashboardAssessmentFacts;
}

export interface BuildDashboardSnapshotInput {
  userId: string;
  asOf: Date | string;
  stateFacts?: DashboardStateFacts;
  wrongQuestionFacts?: DashboardWrongQuestionFacts;
  todayPlanFacts?: DashboardTodayPlanFacts;
  practiceFacts?: DashboardPracticeFacts;
  sessionFacts?: DashboardLearningSessionFacts;
  assessmentFacts?: DashboardAssessmentFacts;
}

export function buildDashboardSnapshot(input: BuildDashboardSnapshotInput): DashboardSnapshot {
  return {
    source: 'dashboard_facts',
    userId: input.userId,
    asOf: toIso(input.asOf),
    stateFacts: input.stateFacts ?? emptyStateFacts(),
    wrongQuestionFacts: input.wrongQuestionFacts ?? emptyWrongQuestionFacts(),
    todayPlanFacts: input.todayPlanFacts ?? emptyTodayPlanFacts(input.asOf),
    practiceFacts: input.practiceFacts ?? emptyPracticeFacts(),
    sessionFacts: input.sessionFacts ?? emptySessionFacts(),
    assessmentFacts: input.assessmentFacts ?? emptyAssessmentFacts(),
  };
}

function emptyStateFacts(): DashboardStateFacts {
  return { source: 'empty', goal: null, mastery: null, weakPoints: [], activity: null };
}

function emptyWrongQuestionFacts(): DashboardWrongQuestionFacts {
  return { source: 'empty', total: 0, unresolved: 0, reviewed: 0, resolved: 0, latestWrongAt: null, dueCount: 0 };
}

function emptyTodayPlanFacts(asOf: Date | string): DashboardTodayPlanFacts {
  return { source: 'empty', planId: null, phase: null, status: null, todayTaskCount: 0, completedTaskCount: 0, completionRate: 0, reviewDueCount: 0, asOf: toIso(asOf) };
}

function emptyPracticeFacts(): DashboardPracticeFacts {
  return { source: 'empty', totalCount: 0, todayCount: 0, correctCount: 0, accuracy: 0, lastPracticeAt: null, studyDuration: 0, latestSubmittedAt: null, records: [] };
}

function emptySessionFacts(): DashboardLearningSessionFacts {
  return { source: 'empty', activeCount: 0, latestActiveAt: null, sessions: [] };
}

function emptyAssessmentFacts(): DashboardAssessmentFacts {
  return { source: 'empty', attemptCount: 0, bestScore: null, latestScore: null, lastAssessmentAt: null, latestAccuracyRate: null, latestSubmittedAt: null, history: [] };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
