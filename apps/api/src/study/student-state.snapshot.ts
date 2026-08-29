// StudentStateSnapshot is a read-only derived projection.
// It must not be persisted, used as a Source of Truth, written directly,
// or turned into a second cached state. Its canonical facts come from
// User, PracticeRecord, UserKnowledgeMastery, WrongQuestionReview,
// ReviewSchedule, StudyPlan, StudyTask, and AssessmentHistoryItem.
import { studyDateKey } from './study-date';

export interface StudentGoalSnapshot {
  targetSchool: string | null;
  targetScore: number | null;
  currentScore: number | null;
  dailyHours: number | null;
  remainingDays: number | null;
  stage: string | null;
  weakestSubject: string | null;
  diagnosis: string | null;
  examYear: number | null;
  onboardingCompletedAt: string | null;
}

export interface StudentMasterySnapshot {
  source: 'user_knowledge_mastery' | 'empty';
  nodeCount: number;
  practicedNodeCount: number;
  averageMastery: number;
  weakCount: number;
  reviewCount: number;
  masteredCount: number;
  lastUpdatedAt: string | null;
}

export interface StudentWeakPointSnapshot {
  knowledgeNodeId: string;
  subject: string;
  chapter: string;
  title: string;
  masteryRate: number;
  accuracyRate: number;
  attempts: number;
  wrongCount: number;
}

export interface StudentWrongQuestionSummarySnapshot {
  source: 'practice_record_wrong_question_review';
  total: number;
  unresolved: number;
  reviewed: number;
  resolved: number;
  latestWrongAt: string | null;
}

export interface StudentReviewDueItemSnapshot {
  questionId: string;
  nextReviewAt: string;
  reviewCount: number;
  stability: string;
  overdue: boolean;
}

export interface StudentReviewDueSnapshot {
  dueCount: number;
  overdueCount: number;
  nextReviewAt: string | null;
  items: StudentReviewDueItemSnapshot[];
}

export interface StudentTaskSnapshot {
  id: string;
  title: string;
  status: string;
  scheduledDate: string;
  completed: boolean;
  completedAt: string | null;
  priority: string;
  mode: string;
  questionCount: number;
  minutes: number;
  completedQuestionCount: number;
  correctCount: number;
  minutesSpent: number;
  reachedTarget: boolean;
}

export interface StudentTaskSummarySnapshot {
  today: StudentTaskSnapshot[];
  counts: {
    pending: number;
    inProgress: number;
    postponed: number;
    completed: number;
  };
}

export interface StudentAssessmentSummarySnapshot {
  attemptCount: number;
  bestScore: number;
  latestAccuracyRate: number;
  improvementText: string;
}

export interface StudentStateSnapshot {
  userId: string;
  asOf: string;
  goal: StudentGoalSnapshot;
  mastery: StudentMasterySnapshot;
  weakPoints: StudentWeakPointSnapshot[];
  wrongQuestionSummary: StudentWrongQuestionSummarySnapshot;
  reviewDue: StudentReviewDueSnapshot;
  studyTasks: StudentTaskSummarySnapshot;
  assessmentSummary: StudentAssessmentSummarySnapshot;
}

export interface StudentStateMasteryRow {
  knowledgeNodeId: string;
  subject: string;
  chapter: string;
  title: string;
  importance: number;
  frequency: number;
  mastery: number;
  attempts: number;
  correctCount: number;
  wrongCount: number;
  status: 'untouched' | 'weak' | 'review' | 'mastered';
  updatedAt: Date | string | null;
}

export interface StudentStateWrongQuestionRow {
  questionId: string;
  latestCorrect: boolean;
  latestSubmittedAt: Date | string;
  reviewedAt: Date | string | null;
  resolved: boolean | null;
}

export interface StudentStateReviewScheduleRow {
  questionId: string;
  nextReviewAt: Date | string;
  reviewCount: number;
  stability: string;
}

export interface StudentStateTaskRow {
  id: string;
  title: string;
  status: string;
  scheduledDate: string;
  completed: boolean;
  completedAt: Date | string | null;
  priority: string;
  mode: string;
  questionCount: number;
  minutes: number;
  completedQuestionCount?: number;
  correctCount?: number;
  minutesSpent?: number;
  reachedTarget?: boolean;
}

export interface StudentStateUserRow {
  targetSchool: string | null;
  targetScore: number | null;
  currentScore: number | null;
  dailyHours: number | null;
  remainingDays: number | null;
  studyStage: string | null;
  weakestSubject: string | null;
  diagnosis: string | null;
  examYear: number | null;
  onboardingCompletedAt: Date | string | null;
}

export interface BuildStudentStateSnapshotInput {
  userId: string;
  asOf: Date | string;
  user: StudentStateUserRow | null;
  masteryRows: StudentStateMasteryRow[];
  mastery?: StudentMasterySnapshot;
  weakPoints?: StudentWeakPointSnapshot[];
  wrongQuestionRows: StudentStateWrongQuestionRow[];
  reviewSchedules: StudentStateReviewScheduleRow[];
  studyTasks: StudentStateTaskRow[];
  assessmentSummary: StudentAssessmentSummarySnapshot;
}

export function buildStudentStateSnapshot(input: BuildStudentStateSnapshotInput): StudentStateSnapshot {
  const asOf = toIso(input.asOf);
  return {
    userId: input.userId,
    asOf,
    goal: buildGoal(input.user),
    mastery: input.mastery ?? buildMastery(input.masteryRows),
    weakPoints: input.weakPoints ?? buildWeakPoints(input.masteryRows),
    wrongQuestionSummary: buildWrongQuestionSummary(input.wrongQuestionRows),
    reviewDue: buildReviewDue(input.reviewSchedules, asOf),
    studyTasks: buildStudyTasks(input.studyTasks, asOf),
    assessmentSummary: input.assessmentSummary,
  };
}

function buildGoal(user: StudentStateUserRow | null): StudentGoalSnapshot {
  return {
    targetSchool: user?.targetSchool ?? null,
    targetScore: user?.targetScore ?? null,
    currentScore: user?.currentScore ?? null,
    dailyHours: user?.dailyHours ?? null,
    remainingDays: user?.remainingDays ?? null,
    stage: user?.studyStage ?? null,
    weakestSubject: user?.weakestSubject ?? null,
    diagnosis: user?.diagnosis ?? null,
    examYear: user?.examYear ?? null,
    onboardingCompletedAt: toIsoOrNull(user?.onboardingCompletedAt ?? null),
  };
}

function buildMastery(rows: StudentStateMasteryRow[]): StudentMasterySnapshot {
  const practiced = rows.filter((row) => row.attempts > 0);
  const latestUpdatedAt = rows
    .map((row) => toIsoOrNull(row.updatedAt))
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
  return {
    source: rows.length ? 'user_knowledge_mastery' : 'empty',
    nodeCount: rows.length,
    practicedNodeCount: practiced.length,
    averageMastery: rows.length
      ? Math.round((rows.reduce((sum, row) => sum + row.mastery, 0) / rows.length) * 100)
      : 0,
    weakCount: rows.filter((row) => row.status === 'weak').length,
    reviewCount: rows.filter((row) => row.status === 'review').length,
    masteredCount: rows.filter((row) => row.status === 'mastered').length,
    lastUpdatedAt: latestUpdatedAt,
  };
}

function buildWeakPoints(rows: StudentStateMasteryRow[]): StudentWeakPointSnapshot[] {
  return rows
    .filter((row) => row.attempts > 0 && row.status === 'weak')
    .sort((left, right) => left.mastery - right.mastery || right.wrongCount - left.wrongCount || left.knowledgeNodeId.localeCompare(right.knowledgeNodeId))
    .slice(0, 5)
    .map((row) => ({
      knowledgeNodeId: row.knowledgeNodeId,
      subject: row.subject,
      chapter: row.chapter,
      title: row.title,
      masteryRate: Math.round(row.mastery * 100),
      accuracyRate: row.attempts ? Math.round((row.correctCount / row.attempts) * 100) : 0,
      attempts: row.attempts,
      wrongCount: row.wrongCount,
    }));
}

function buildWrongQuestionSummary(rows: StudentStateWrongQuestionRow[]): StudentWrongQuestionSummarySnapshot {
  const currentWrong = rows.filter((row) => !row.latestCorrect);
  const resolved = rows.filter((row) => row.resolved === true).length;
  return {
    source: 'practice_record_wrong_question_review',
    total: currentWrong.length,
    unresolved: currentWrong.length,
    reviewed: currentWrong.filter((row) => Boolean(row.reviewedAt)).length,
    resolved,
    latestWrongAt: currentWrong
      .map((row) => toIso(row.latestSubmittedAt))
      .sort()
      .at(-1) ?? null,
  };
}

function buildReviewDue(rows: StudentStateReviewScheduleRow[], asOf: string): StudentReviewDueSnapshot {
  const today = studyDateKey(asOf);
  const dueRows = rows
    .filter((row) => toIso(row.nextReviewAt) <= asOf)
    .sort((left, right) => toIso(left.nextReviewAt).localeCompare(toIso(right.nextReviewAt)) || left.questionId.localeCompare(right.questionId));
  return {
    dueCount: dueRows.length,
    overdueCount: dueRows.filter((row) => studyDateKey(row.nextReviewAt) < today).length,
    nextReviewAt: rows
      .map((row) => toIso(row.nextReviewAt))
      .sort()[0] ?? null,
    items: dueRows.slice(0, 5).map((row) => ({
      questionId: row.questionId,
      nextReviewAt: toIso(row.nextReviewAt),
      reviewCount: row.reviewCount,
      stability: row.stability,
      overdue: studyDateKey(row.nextReviewAt) < today,
    })),
  };
}

function buildStudyTasks(rows: StudentStateTaskRow[], asOf: string): StudentTaskSummarySnapshot {
  const today = studyDateKey(asOf);
  const toTask = (row: StudentStateTaskRow): StudentTaskSnapshot => {
    const completedQuestionCount = row.completedQuestionCount ?? (row.completed ? row.questionCount : 0);
    const correctCount = row.correctCount ?? (row.completed ? row.questionCount : 0);
    const minutesSpent = row.minutesSpent ?? (row.completed ? row.minutes : 0);
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      scheduledDate: row.scheduledDate,
      completed: row.completed,
      completedAt: toIsoOrNull(row.completedAt),
      priority: row.priority,
      mode: row.mode,
      questionCount: row.questionCount,
      minutes: row.minutes,
      completedQuestionCount,
      correctCount,
      minutesSpent,
      reachedTarget: row.reachedTarget ?? completedQuestionCount >= row.questionCount,
    };
  };
  return {
    today: rows
      .filter((row) => row.scheduledDate === today)
      .sort((left, right) => statusRank(left.status) - statusRank(right.status) || left.id.localeCompare(right.id))
      .map(toTask),
    counts: {
      pending: rows.filter((row) => row.status === 'pending').length,
      inProgress: rows.filter((row) => row.status === 'in_progress').length,
      postponed: rows.filter((row) => row.status === 'postponed').length,
      completed: rows.filter((row) => row.status === 'completed' || row.completed).length,
    },
  };
}

function statusRank(status: string): number {
  if (status === 'in_progress') return 0;
  if (status === 'pending') return 1;
  if (status === 'postponed') return 2;
  if (status === 'completed') return 3;
  return 4;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toIsoOrNull(value: Date | string | null): string | null {
  return value == null ? null : toIso(value);
}
