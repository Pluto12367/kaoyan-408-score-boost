// ---- Auth ----
import type { FeedbackDraft, FeedbackScene, UserProfile, UserRole } from '@kaoyan408/shared';
import type {
  KnowledgePoint,
  Question,
  PracticeRecord,
  StudyPlan,
  WeaknessReport,
  DiagnosticProfile,
  Subject,
} from '@kaoyan408/shared';

export type { FeedbackDraft, FeedbackScene, UserProfile, UserRole, KnowledgePoint, Question, PracticeRecord, StudyPlan, WeaknessReport, DiagnosticProfile, Subject };

export interface AuthSession {
  token: string;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  user: UserProfile;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface DiagnosticInput {
  targetScore: number;
  currentScore: number;
  remainingDays: number;
  dailyHours: number;
  weakestSubject: Subject;
}

// ---- Dashboard ----
export interface DashboardOverview {
  source: 'memory-api' | 'postgresql' | 'mock';
  student: UserProfile;
  knowledgePoints: KnowledgePoint[];
  questions: Question[];
  practiceRecords: PracticeRecord[];
  wrongQuestions: WrongQuestion[];
  learningCalendar: LearningCalendar;
  stageAssessment: StageAssessment;
  report: WeaknessReport;
  plan: StudyPlan;
}

export interface LearningCalendar {
  days: LearningCalendarDay[];
  today: LearningCalendarDay;
  streakDays: number;
}

export interface LearningCalendarDay {
  date: string;
  completedTaskCount: number;
  practiceCount: number;
  isActive: boolean;
}

export interface StageAssessment {
  id: string;
  title: string;
  userId: string;
  description: string;
  estimatedMinutes: number;
  focusKnowledgePoints: KnowledgePoint[];
  questions: Question[];
}

export interface StageAssessmentResult {
  id: string;
  userId: string;
  submittedAt: string;
  totalQuestions: number;
  correctCount: number;
  score: number;
  adjustment: {
    previousStage: string;
    stage: string;
    planPhase: string;
    scoreBand: string;
    message: string;
  };
  reviewItems: Array<{
    questionId: string;
    stem: string;
    selectedAnswer?: string;
    correctAnswer?: string;
    knowledgePointId: string;
    knowledgePointTitle: string;
    mistakeReason: string | null;
    analysis?: string;
  }>;
  nextActions: string[];
}

export interface LearningProfile {
  userId: string;
  summary: {
    name: string;
    currentStage?: string;
    targetScore?: number;
    currentScore?: number;
    weakestSubject?: string;
    accuracyRate: number;
    streakDays: number;
  };
  loopStats: {
    diagnosticCompleted: boolean;
    practiceSetCount: number;
    stageAssessmentCount: number;
    reviewedWrongQuestionCount: number;
    wrongQuestionCount: number;
  };
  timeline: Array<{
    id: string;
    type: string;
    title: string;
    date: string;
    summary: string;
  }>;
  nextMilestone: string;
}

// ---- Practice ----
export interface PracticeSet {
  id: string;
  userId: string;
  title: string;
  stage: string;
  focus: string;
  reason: string;
  knowledgePointIds: string[];
  questionCount: number;
  estimatedMinutes: number;
  questions: Question[];
}

export interface PracticeSetResult {
  id: string;
  practiceSetId: string;
  userId: string;
  submittedAt: string;
  totalQuestions: number;
  correctCount: number;
  accuracyRate: number;
  results: Array<{
    questionId: string;
    stem: string;
    selectedAnswer?: string;
    correctAnswer?: string;
    correct: boolean;
    mistakeReason: string | null;
  }>;
  nextActions: string[];
}

// ---- Wrong Questions ----
export interface WrongQuestion {
  questionId: string;
  stem: string;
  answer?: string;
  analysis?: string;
  knowledgePointId: string;
  knowledgePointTitle: string;
  subject: string;
  chapter: string;
  wrongCount: number;
  latestMistakeReason: string | null;
  latestSubmittedAt: string;
  reviewStatus: 'pending' | 'reviewed';
  reviewedAt?: string | null;
  nextAction?: string;
  similarQuestions?: Array<{
    id: string;
    stem: string;
    difficulty: string;
    source: string;
  }>;
}

export interface WrongQuestionSummary {
  userId: string;
  pendingCount: number;
  reviewedCount: number;
  resolvedCount: number;
  totalWrongCount: number;
  mistakeReasonStats: Array<{ reason: string; count: number }>;
  priorityRedoItems: Array<{
    questionId: string;
    stem: string;
    knowledgePointTitle: string;
    wrongCount: number;
    latestMistakeReason: string | null;
    reviewStatus: 'pending' | 'reviewed';
    nextAction: string;
  }>;
  nextReviewActions: string[];
  generatedAt: string;
}

export interface TaskCompletionAdjustment {
  accuracyRate: number;
  completedQuestionCount: number;
  correctCount: number;
  minutesSpent: number;
  selfRating: number;
  intensity: 'increase' | 'hold' | 'decrease';
  tomorrowQuestionTarget: number;
  reviewTarget: number;
  focusKnowledgePointId: string;
  focusTitle: string;
  reasons: string[];
  nextActions: string[];
}

// ---- Trial & Reminders ----
export interface TrialProgress {
  userId: string;
  title: string;
  completedCount: number;
  totalCount: number;
  completionRate: number;
  items: Array<{
    id: string;
    title: string;
    description: string;
    completed: boolean;
    actionAnchor: string;
  }>;
  nextAction: string;
}

export interface StudyReminders {
  userId: string;
  title: string;
  generatedAt: string;
  items: Array<{
    id: string;
    type: 'weakness' | 'wrong-question' | 'daily-task' | 'habit' | 'trial' | 'feedback';
    priority: 'high' | 'medium' | 'low';
    title: string;
    reason: string;
    actionText: string;
    actionAnchor: string;
  }>;
}

export interface SprintPlan {
  userId: string;
  title: string;
  currentStage?: string;
  scoreGap: number;
  targetScore?: number;
  currentScore?: number;
  remainingDays?: number;
  weeklyQuestionTarget: number;
  weeklyReviewTarget: number;
  risks: string[];
  generatedAt: string;
  days: Array<{
    dayIndex: number;
    date: string;
    focus: string;
    minutes: number;
    questionTarget: number;
    reviewTarget: number;
    reason: string;
  }>;
}

export interface MasteryMap {
  userId: string;
  title: string;
  generatedAt: string;
  subjects: Array<{
    subject: string;
    averageMastery: number;
    weakCount: number;
    reviewCount: number;
    masteredCount: number;
    points: MasteryPoint[];
  }>;
  weakestPoints: Array<MasteryPoint & { subject: string }>;
}

export interface MasteryPoint {
  knowledgePointId: string;
  title: string;
  chapter: string;
  importance: number;
  frequency: number;
  masteryRate: number;
  accuracyRate: number;
  practiceCount: number;
  wrongCount: number;
  status: 'weak' | 'review' | 'mastered';
  nextAction: string;
  actionAnchor: string;
}

// ---- Review ----
export interface ReviewQueue {
  source: 'memory-api' | 'postgresql';
  pendingCount: number;
  approvedCount: number;
  items: ReviewItem[];
  generatedAt: string;
}

export interface ReviewItem {
  id: string;
  contentType: 'question' | 'ai_reply';
  relatedId: string;
  title: string;
  summary: string;
  status: 'pending' | 'approved' | 'needs_recheck';
  riskLevel: 'low' | 'medium' | 'high';
  reviewReason: string;
  suggestedAction: string;
  createdAt: string;
  reviewerId?: string;
  reviewedAt?: string;
}

export interface FeedbackItem {
  id: string;
  userId: string;
  rating: number;
  scene: FeedbackScene;
  message: string;
  surveyUrl: string;
  status: 'new' | 'reviewed';
  createdAt: string;
}

export interface FeedbackList {
  totalCount: number;
  averageRating: number;
  surveyUrl: string;
  items: FeedbackItem[];
}

// ---- Admin ----
export interface AdminMetrics {
  source: 'memory-api' | 'postgresql';
  activeStudentCount: number;
  questionCount: number;
  knowledgePointCount: number;
  practiceRecordCount: number;
  todayPracticeCount: number;
  todayCompletedTaskCount: number;
  completedTaskCount: number;
  accuracyRate: number;
  weakPointCount: number;
  pendingWrongQuestionCount: number;
  pendingReviewCount: number;
  averagePracticeTimeSec: number;
  retentionDays: number;
  topWeakPoint: string | null;
  core: Record<AdminCoreMetricKey, AdminRateMetric>;
  generatedAt: string;
}

export type QuestionImportStatus = 'uploaded' | 'queued' | 'parsing' | 'parsing_partial_failure' | 'review' | 'partially_imported' | 'completed' | 'failed' | 'cancelled' | 'expired';
export type QuestionImportCandidateStatus = 'pending_review' | 'needs_edit' | 'duplicate_suspected' | 'approved' | 'ignored' | 'parse_failed' | 'imported';
export type QuestionImportDuplicateAction = 'skip' | 'create' | 'new_version';

export interface QuestionImportBatchSummary {
  id: string; originalFileName: string; fileType: 'pdf' | 'xlsx' | 'csv'; source: string;
  status: QuestionImportStatus; statusCounts: Record<string, number>; createdAt: string; updatedAt: string; expiresAt: string;
}
export interface QuestionImportBatch extends QuestionImportBatchSummary {
  title?: string | null; year?: number | null; defaultSubject?: string | null; defaultChapter?: string | null;
  pageRange?: string | null; costSummary?: { available?: boolean; totalCost?: number | null; estimated?: number; confirmed?: number; estimatedCost?: number; confirmedCost?: number } | null;
  providerSummary?: { provider?: string; name?: string; [key: string]: unknown } | null;
  jobs: Array<{ id: string; pageStart: number; pageEnd: number; provider: string; attempt: number; state: string }>;
}
export interface QuestionImportCandidate {
  id: string; batchId: string; revision: number; status: QuestionImportCandidateStatus;
  stem: string; options: string[]; answer: string; analysis: string; source: string; year?: number | null;
  difficulty: string; type: string; expectedTimeSec: number; knowledgePointIds: string[]; warnings: Array<{ code: string; severity: 'warning' | 'error'; field?: string; message: string; suggestion: string; rowNumber?: number }>;
  duplicateAction: QuestionImportDuplicateAction; targetFamilyId?: string | null; sourceRowNumber?: number | null; sourcePageNumber?: number | null;
  exactDuplicates?: Array<{ id: string; stem: string }> ; similarDuplicates?: Array<{ id: string; stem: string }>;
  duplicateTarget?: { id: string; familyId: string; stem: string; options: string[]; answer: string; analysis: string; source: string; year?: number | null } | null;
  sourceRegion?: { x: number; y: number; width: number; height: number };
  formulas: Array<{ latex: string; region?: { x: number; y: number; width: number; height: number } }>;
  assetIds: string[];
}

export type AdminCoreMetricKey =
  | 'registrationCompletionRate'
  | 'diagnosticCompletionRate'
  | 'firstTaskCompletionRate'
  | 'day1RetentionRate'
  | 'day7RetentionRate'
  | 'weeklyPlanCompletionRate'
  | 'wrongQuestionSecondAccuracyRate'
  | 'mockExamCompletionRate'
  | 'apiFailureRate'
  | 'sessionRecoverySuccessRate';

export interface AdminRateMetric {
  rate: number | null;
  numerator: number;
  denominator: number;
  window: string;
}

export type TrialStatus = 'invited' | 'active' | 'completed' | 'follow_up';

export interface AdminManagedUser {
  id: string;
  email?: string;
  name: string;
  role: 'student' | 'teacher' | 'admin';
  accountStatus?: 'active' | 'disabled';
  mustChangePassword?: boolean;
  trialStatus: TrialStatus;
  stage?: string;
  targetScore?: number;
  targetSchool?: string;
  lastActiveAt: string;
  nextAction: string;
}

export interface AdminInvitation {
  id: string;
  codePrefix: string;
  label: string;
  maxUses: number;
  usedCount: number;
  startsAt: string;
  expiresAt: string;
  disabledAt?: string | null;
  createdAt: string;
  status: 'available' | 'not_started' | 'expired' | 'disabled' | 'exhausted';
}

export interface AdminInvitationList {
  invitations: AdminInvitation[];
}

export interface CreatedInvitation extends AdminInvitation {
  code: string;
}

export interface ManagedUserCreationResult {
  user: AdminManagedUser;
  temporaryPassword: string;
}

export interface AdminUserManagement {
  source: 'memory-api' | 'postgresql' | 'mock';
  generatedAt: string;
  summary: {
    totalUsers: number;
    studentCount: number;
    activeTrialCount: number;
    followUpCount: number;
  };
  users: AdminManagedUser[];
}

export interface TeacherStudentAuthorization {
  id: string;
  teacherId: string;
  teacherName: string;
  studentId: string;
  studentName: string;
  createdAt: string;
}

export interface TeacherStudentAuthorizationList {
  source: 'memory-api' | 'postgresql' | 'mock';
  generatedAt: string;
  items: TeacherStudentAuthorization[];
}

export interface SystemConfig {
  source: 'memory-api' | 'postgresql';
  recommendation: {
    stageAssessmentQuestionLimit: number;
    dailyTargetQuestionCount: number;
    speedRiskMultiplier: number;
  };
  updatedBy: string;
  updatedAt: string;
}

// ---- Teacher ----
export interface TeacherClassAnalytics {
  source: 'memory-api' | 'postgresql' | 'mock';
  className: string;
  generatedAt: string;
  overview: {
    studentCount: number;
    activeStudentCount: number;
    averageAccuracyRate: number;
    averageCompletionRate: number;
    pendingWrongQuestionCount: number;
  };
  subjectWeakness: Array<{
    subject: string;
    weakPointCount: number;
    averageMastery: number;
    recommendation: string;
  }>;
  weakKnowledgePoints: Array<{
    knowledgePointId: string;
    title: string;
    subject: string;
    accuracyRate: number;
    wrongCount: number;
    recommendedAction: string;
  }>;
  atRiskStudents: Array<{
    userId: string;
    name: string;
    riskType: string;
    reason: string;
    nextAction: string;
  }>;
  teachingActions: string[];
}

export interface CreateTeacherQuestionInput {
  stem: string;
  options: string[];
  answer: string;
  analysis: string;
  knowledgePointIds: string[];
  difficulty: string;
  type: string;
  source: string;
  year?: number;
  expectedTimeSec?: number;
}

export interface CreateKnowledgePointInput {
  id: string;
  subject: KnowledgePoint['subject'];
  chapter: string;
  title: string;
  importance: number;
  frequency: number;
  prerequisites: string[];
}

export interface GeneratedPaper {
  id: string;
  title: string;
  paperType: '模拟卷' | '阶段卷' | '专项卷';
  questionCount: number;
  knowledgePointIds: string[];
  questions: Question[];
  estimatedMinutes: number;
  createdBy: string;
  createdAt: string;
}

export interface GeneratePaperInput {
  title: string;
  paperType: GeneratedPaper['paperType'];
  knowledgePointIds: string[];
  questionCount: number;
  createdBy: string;
}

export interface PaperSubmitResult {
  id: string;
  paperId: string;
  userId: string;
  submittedAt: string;
  totalQuestions: number;
  correctCount: number;
  score: number;
  accuracyRate: number;
  subjectBreakdown: Array<{
    subject: string;
    totalQuestions: number;
    correctCount: number;
    accuracyRate: number;
  }>;
  reviewItems: Array<{
    questionId: string;
    stem: string;
    selectedAnswer?: string;
    correctAnswer?: string;
    correct: boolean;
    knowledgePointId: string;
    knowledgePointTitle: string;
    subject: string;
    mistakeReason: string | null;
  }>;
  weakKnowledgePoints: string[];
  syncedPracticeRecordCount: number;
  examSession: {
    answeredCount: number;
    unansweredCount: number;
    totalQuestions: number;
    elapsedSec: number;
    timeLimitSec: number;
    overtime: boolean;
    progressRate: number;
  };
  nextActions: string[];
}

// ---- AI Tutor ----
export interface TutorReply {
  id: string;
  userId: string;
  questionId: string;
  prompt?: string;
  knowledgePointId: string;
  knowledgePointTitle: string;
  answerCheck: string;
  explanationSteps: string[];
  similarQuestions: Array<{
    id: string;
    stem: string;
    difficulty: string;
    source: string;
  }>;
  nextActions: string[];
  source: string;
}

export interface AiFollowUp {
  id: string;
  userId: string;
  questionId: string;
  message: string;
  relatedKnowledgePoint: {
    id?: string;
    title: string;
    subject: string;
    chapter: string;
  };
  replySteps: string[];
  misconceptionTips: string[];
  reviewCards: Array<{
    id: string;
    type: 'concept' | 'rule' | 'confusion';
    title: string;
    content: string;
    nextAction: string;
  }>;
  nextActions: string[];
  source: string;
}

// ---- Review Resources ----
export interface ReviewResourceRecommendation {
  source: 'memory-api' | 'postgresql';
  userId: string;
  generatedAt: string;
  weakPointCount: number;
  items: ReviewResource[];
}

export interface ReviewResource {
  id: string;
  knowledgePointId: string;
  knowledgePointTitle: string;
  subject: string;
  resourceType: 'concept_card' | 'mistake_checklist' | 'example_walkthrough' | 'practice_set';
  title: string;
  summary: string;
  estimatedMinutes: number;
  difficulty: '基础' | '中等' | '提高';
  actionText: string;
  actionAnchor: string;
}

// ---- Assessment History ----
export interface AssessmentHistoryItem {
  id: string;
  paperId?: string;
  userId: string;
  title: string;
  submittedAt: string;
  score: number;
  totalScore: number;
  accuracyRate: number;
  elapsedSec: number;
  unansweredCount: number;
  weakPointTitle: string;
  reviewSuggestion: string;
}

export interface AssessmentHistory {
  userId: string;
  items: AssessmentHistoryItem[];
  summary: {
    attemptCount: number;
    bestScore: number;
    latestAccuracyRate: number;
    improvementText: string;
  };
}
