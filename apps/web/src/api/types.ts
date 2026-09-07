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

/** Canonical Overview v1 read model used by the migrated homepage summary. */
export interface CanonicalOverview {
  contractVersion: 'overview-report-v1';
  userId: string;
  asOf: string;
  summary: {
    goal: { targetScore: number | null; currentScore: number | null; remainingDays: number | null; studyStage: string | null; weakestSubject: string | null };
    learningState: 'stable' | 'rising' | 'risky' | 'insufficient_data';
  };
  mastery: {
    averageMastery: number | null;
    nodes: Array<{ knowledgeNodeId: string; title: string; subject: string; masteryRate: number | null; status: 'untouched' | 'weak' | 'review' | 'mastered' }>;
  };
  weaknesses: {
    nodeWeaknesses: Array<{ knowledgeNodeId: string; title: string; masteryRate: number; evidence: Array<{ kind: string; id: string }> }>;
    practiceWeaknesses: Array<{ knowledgePointId: string; title: string; accuracyRate: number; evidence: Array<{ kind: string; id: string }> }>;
    speedRisks: Array<{ knowledgePointId: string; title: string; evidence: Array<{ kind: string; id: string }> }>;
  };
  progress: {
    last7d: { current: number | null; baseline: number | null; delta?: number | null; sampleSize: number; status: 'up' | 'down' | 'flat' | 'insufficient_data' };
  };
  reviewStatus: { pendingWrongQuestionCount: number; todayDueCount: number; overdueCount: number };
  recommendedActions: Array<{ actionId: string; actionType: string; title: string; target?: { knowledgeNodeId?: string; knowledgePointId?: string; studyTaskId?: string }; evidence: Array<{ kind: string; id: string }>; status: string }>;
}

/**
 * Client-side representation of the backend StudentContext v1 read model.
 * This is intentionally a read contract mirror; it contains no write fields
 * or client-generated identity and is consumed through a StudentHome adapter.
 */
export type StudentContextTrendStatus = 'sufficient' | 'insufficient_data';

export interface StudentContextTrend<T> {
  window: string;
  baseline: T | null;
  sampleSize: number;
  status: StudentContextTrendStatus;
  value: T | null;
}

export interface StudentContextNode {
  knowledgeNodeId: string;
  subject: string;
  chapter: string;
  title: string;
  mastery: number;
  accuracy: number | null;
  attempts: number;
  wrongCount: number;
  status: string;
  updatedAt: string | null;
}

export interface StudentContext {
  version: 'student-context-v1';
  userId: string;
  asOf: string;
  freshness: { asOf: string; status: StudentContextTrendStatus; sources: Array<{ source: string; observedAt: string | null; status: 'available' | 'unavailable' }> };
  profile: { userId: string; name: string | null; role: string | null; targetSchool: string | null; weakestSubject: string | null; diagnosis: string | null };
  exam: { examYear: number | null; targetScore: number | null; currentScore: number | null; remainingDays: number | null; studyStage: string | null };
  mastery: {
    source: 'user_knowledge_mastery' | 'empty';
    weakNodes: StudentContextNode[];
    weakPoints: Array<{ knowledgePointId: string; subject: string; chapter: string; title: string; attempts: number; wrongCount: number; accuracy: number | null; latestAt: string | null }>;
    improvingPoints: StudentContextNode[];
    masteredPoints: StudentContextNode[];
    lastUpdatedAt: string | null;
  };
  practice: {
    source: 'practice_record' | 'empty';
    recentAccuracy: StudentContextTrend<number>;
    recentVolume: StudentContextTrend<number>;
    subjectDistribution: { status: StudentContextTrendStatus; items: Array<{ subject: string; count: number; share: number }> };
    totalCount: number;
    latestSubmittedAt: string | null;
  };
  review: {
    source: 'review_schedule' | 'empty';
    dueCount: number;
    overdueCount: number;
    reviewedCount: number;
    resolvedCount: number;
    highRiskQuestions: Array<{ questionId: string; knowledgePointId: string | null; wrongCount: number; overdue: boolean; nextReviewAt: string | null; stability: string | null }>;
    nextReviewAt: string | null;
  };
  plan: {
    source: 'study_plan' | 'empty';
    planId: string | null;
    todayTasks: Array<{ studyTaskId: string; actionId: string | null; title: string; status: string; scheduledDate: string; completed: boolean; completedAt: string | null; knowledgePointId: string | null; knowledgeNodeId: string | null; minutes: number; questionCount: number }>;
    completion: { completedCount: number; totalCount: number; rate: StudentContextTrend<number> };
  };
  momentum: {
    studyStreak: number;
    recentSessions: Array<{ learningSessionId: string; actionId: string | null; type: string; startedAt: string; lastActiveAt: string; completed: boolean }>;
    activityTrend: StudentContextTrend<number>;
  };
  recommendationEvidence: Array<{ source: string; timestamp: string | null; knowledgeNodeId?: string; knowledgePointId?: string; actionId?: string; studyTaskId?: string; referenceId?: string }>;
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
  insights: {
    learningState: 'stable' | 'rising' | 'risky';
    stateReason: string;
    weakPoints: Array<{
      knowledgePointId: string;
      subject: string;
      chapter: string;
      title: string;
      wrongCount: number;
      accuracyRate: number;
      weaknessScore: number;
      topReason: string | null;
      suggestion: string;
    }>;
    speedRisks: Array<{
      knowledgePointId: string;
      subject: string;
      chapter: string;
      title: string;
      wrongCount: number;
      accuracyRate: number;
      weaknessScore: number;
      topReason: string | null;
      suggestion: string;
    }>;
    mistakeReasons: Array<{ reason: string; count: number }>;
    focusHints: string[];
  };
}

// ---- Practice ----
export interface PracticeSetExamAlignmentItem {
  questionId: string;
  primaryNode: { knowledgeNodeId: string; name: string; subject: string } | null;
  stars: number;
  recent3Frequency: number | null;
  recent5Frequency: number | null;
  allTimeEvidence: number | null;
  frequencyConfidence: string | null;
  trendDirection: string | null;
  lastSeenYear: number | null;
  mastery: number | null;
  attempts: number | null;
  /** 永远以“估算”语义呈现；公式在 evidence.gainFormula。 */
  predictedGainEstimate: number | null;
  examHits: Array<{ year: number; subject: string; questionNo: number }>;
  evidence: {
    frequencySource: { table: string; nodeId: string | null };
    masterySource: { table: string; nodeId: string | null };
    gainFormula: string;
  };
}

export interface PracticeSetExamAlignment {
  summary: { coveredNodeCount: number; coveredYears: number[]; highFrequencyCount: number };
  items: PracticeSetExamAlignmentItem[];
}

export interface PracticeSet {
  id: string;
  userId: string;
  title: string;
  stage: string;
  focus: string;
  reason: string;
  /** Canonical recommendation identity; kept separate from legacy Point IDs. */
  knowledgeNodeIds?: string[];
  knowledgePointIds: string[];
  questionCount: number;
  estimatedMinutes: number;
  questions: Question[];
  /** LE-V10 F1：真题对齐投影；仅在 mode=exam_aligned 且数据可用时出现。 */
  examAlignment?: PracticeSetExamAlignment | null;
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

export type WrongQuestionMasteryStatus = '未掌握' | '复习中' | '已掌握';

export interface WrongQuestionFilter {
  subject?: string;
  chapter?: string;
  knowledgePointId?: string;
  mistakeReason?: string;
  minWrongCount?: number;
  masteryStatus?: WrongQuestionMasteryStatus;
  reviewedWithinDays?: number;
  importance?: number;
}

// ---- Wrong Questions ----
export interface WrongQuestion {
  questionId: string;
  stem: string;
  answer?: string;
  analysis?: string;
  knowledgePointId: string;
  /** Explicit Point → Node mapping for mastery joins; may contain multiple nodes. */
  knowledgeNodeIds?: string[];
  knowledgePointTitle: string;
  subject: string;
  chapter: string;
  wrongCount: number;
  latestMistakeReason: string | null;
  latestSubmittedAt: string;
  reviewStatus: 'pending' | 'reviewed';
  reviewedAt?: string | null;
  masteryStatus: WrongQuestionMasteryStatus;
  masteryCriteria?: {
    stability: string;
    consecutiveCorrect: number;
    variantCorrectCount: number;
  };
  importance?: number;
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
  masteryStats: Array<{ status: WrongQuestionMasteryStatus; count: number }>;
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
  hintLayers: Array<{
    level: 1 | 2 | 3 | 4;
    title: string;
    content: string;
  }>;
  similarQuestions: Array<{
    id: string;
    stem: string;
    difficulty: string;
    source: string;
  }>;
  evidenceSummary?: {
    whyImportant: string;
    nextStepHint: string;
    cards: Array<{
      title: string;
      value: string;
      note: string;
      tone: 'info' | 'positive' | 'warning' | 'neutral';
    }>;
  } | null;
  nextActions: string[];
  source: string;
}

export type ContextualCoachRequest =
  | { contextType: 'question'; questionId: string; selectedAnswer?: string; message?: string }
  | { contextType: 'wrong_question'; questionId: string; message?: string }
  | { contextType: 'knowledge_node'; knowledgeNodeId: string; message?: string }
  | { contextType: 'assessment'; assessmentId?: string; message?: string };

export interface ContextualCoachResponse {
  contextType: ContextualCoachRequest['contextType'];
  contextId: string | null;
  summary: string;
  replySteps: string[];
  misconceptionTips: string[];
  reviewCards: Array<{ id: string; type: 'concept' | 'rule' | 'confusion'; title: string; content: string; nextAction: string }>;
  nextActions: string[];
  source: string;
  assembledAt: string;
  fallbackReason?: string;
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
