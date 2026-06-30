import {
  buildStudyPlan,
  computeWeaknessReport,
  type KnowledgePoint,
  type PracticeRecord,
  type Question,
  type StudyPlan,
  type UserProfile,
  type UserRole,
  type WeaknessReport,
  type DiagnosticProfile,
  type Subject,
} from '@kaoyan408/shared';
import { knowledgePoints, practiceRecords, questions, student } from './mockData';

export interface DashboardOverview {
  source: 'memory-api' | 'postgres-ready-api' | 'mock';
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

export interface AdminMetrics {
  source: 'memory-api' | 'postgres-ready-api';
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
  generatedAt: string;
}

export interface ReviewQueue {
  source: 'memory-api' | 'postgres-ready-api';
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
  status: 'pending' | 'approved';
  riskLevel: 'low' | 'medium' | 'high';
  createdAt: string;
  reviewerId?: string;
  reviewedAt?: string;
}

export interface SystemConfig {
  source: 'memory-api' | 'postgres-ready-api';
  recommendation: {
    stageAssessmentQuestionLimit: number;
    dailyTargetQuestionCount: number;
    speedRiskMultiplier: number;
  };
  updatedBy: string;
  updatedAt: string;
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

export interface AuthSession {
  token: string;
  user: UserProfile;
}

export interface DiagnosticInput {
  targetScore: number;
  currentScore: number;
  remainingDays: number;
  dailyHours: number;
  weakestSubject: Subject;
}

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

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:3000';

export function createMockOverview(): DashboardOverview {
  const report = computeWeaknessReport({
    knowledgePoints,
    records: practiceRecords,
    targetScore: student.targetScore ?? 110,
  });
  const plan = buildStudyPlan({
    targetScore: student.targetScore ?? 110,
    remainingDays: student.remainingDays ?? 90,
    dailyHours: student.dailyHours ?? 3,
    stage: student.stage ?? '强化',
    knowledgePoints,
    records: practiceRecords,
  });

  return {
    source: 'mock',
    student,
    knowledgePoints,
    questions,
    practiceRecords,
    wrongQuestions: [
      {
        questionId: questions[0].id,
        stem: questions[0].stem,
        answer: questions[0].answer,
        analysis: questions[0].analysis,
        knowledgePointId: 'co-cache',
        knowledgePointTitle: 'Cache 映射与替换',
        subject: '计算机组成原理',
        chapter: '存储系统',
        wrongCount: 2,
        latestMistakeReason: '概念不清',
        latestSubmittedAt: '2026-06-22',
        reviewStatus: 'pending',
        reviewedAt: null,
      },
    ],
    learningCalendar: createMockLearningCalendar(),
    stageAssessment: createMockStageAssessment(),
    report,
    plan,
  };
}

export function createMockAdminMetrics(): AdminMetrics {
  return {
    source: 'memory-api',
    activeStudentCount: 1,
    questionCount: questions.length,
    knowledgePointCount: knowledgePoints.length,
    practiceRecordCount: practiceRecords.length,
    todayPracticeCount: 1,
    todayCompletedTaskCount: 1,
    completedTaskCount: 1,
    accuracyRate: 66.7,
    weakPointCount: 1,
    pendingWrongQuestionCount: 1,
    pendingReviewCount: 0,
    averagePracticeTimeSec: 140,
    retentionDays: 3,
    topWeakPoint: 'Cache 映射与替换',
    generatedAt: new Date().toISOString(),
  };
}

export function createMockReviewQueue(): ReviewQueue {
  return {
    source: 'memory-api',
    pendingCount: 0,
    approvedCount: 0,
    generatedAt: new Date().toISOString(),
    items: [],
  };
}

export function createMockSystemConfig(): SystemConfig {
  return {
    source: 'memory-api',
    recommendation: {
      stageAssessmentQuestionLimit: 6,
      dailyTargetQuestionCount: 30,
      speedRiskMultiplier: 1.4,
    },
    updatedBy: 'system',
    updatedAt: new Date().toISOString(),
  };
}

function createMockStageAssessment(): StageAssessment {
  return {
    id: `stage-${new Date().toISOString().slice(0, 10)}`,
    title: '强化阶段测评',
    userId: student.id,
    description: '根据当前薄弱点生成的小测，用于判断本阶段是否需要继续专项突破。',
    estimatedMinutes: 12,
    focusKnowledgePoints: knowledgePoints.slice(0, 2),
    questions: questions.slice(0, 2),
  };
}

function createMockLearningCalendar(): LearningCalendar {
  const today = new Date().toISOString().slice(0, 10);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${today}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - (6 - index));
    const key = date.toISOString().slice(0, 10);

    return {
      date: key,
      completedTaskCount: index === 6 ? 1 : 0,
      practiceCount: index >= 4 ? 1 : 0,
      isActive: index >= 4,
    };
  });

  return {
    days,
    today: days[days.length - 1],
    streakDays: 3,
  };
}

export async function fetchDashboardOverview(): Promise<DashboardOverview> {
  const response = await fetch(`${API_BASE_URL}/dashboard/overview`);
  if (!response.ok) {
    throw new Error(`API request failed with ${response.status}`);
  }

  return response.json() as Promise<DashboardOverview>;
}

export async function fetchAdminMetrics(): Promise<AdminMetrics> {
  const response = await fetch(`${API_BASE_URL}/admin/metrics`);
  if (!response.ok) {
    throw new Error(`Admin metrics request failed with ${response.status}`);
  }

  return response.json() as Promise<AdminMetrics>;
}

export async function fetchReviewQueue(): Promise<ReviewQueue> {
  const response = await fetch(`${API_BASE_URL}/admin/review-queue`);
  if (!response.ok) {
    throw new Error(`Review queue request failed with ${response.status}`);
  }

  return response.json() as Promise<ReviewQueue>;
}

export async function approveReviewItem(input: {
  reviewItemId: string;
  reviewerId: string;
}): Promise<ReviewItem> {
  const response = await fetch(`${API_BASE_URL}/admin/review-queue/${input.reviewItemId}/approve`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ reviewerId: input.reviewerId }),
  });

  if (!response.ok) {
    throw new Error(`Review approval failed with ${response.status}`);
  }

  return response.json() as Promise<ReviewItem>;
}

export async function fetchSystemConfig(): Promise<SystemConfig> {
  const response = await fetch(`${API_BASE_URL}/admin/system-config`);
  if (!response.ok) {
    throw new Error(`System config request failed with ${response.status}`);
  }

  return response.json() as Promise<SystemConfig>;
}

export async function updateSystemConfig(input: Partial<SystemConfig>): Promise<SystemConfig> {
  const response = await fetch(`${API_BASE_URL}/admin/system-config`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`System config update failed with ${response.status}`);
  }

  return response.json() as Promise<SystemConfig>;
}

export async function submitPracticeAnswer(input: {
  userId: string;
  questionId: string;
  knowledgePointId: string;
  selectedAnswer: string;
  timeSpentSec: number;
}) {
  const response = await fetch(`${API_BASE_URL}/practice-records`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`Practice submission failed with ${response.status}`);
  }

  return response.json() as Promise<{
    id: string;
    correct: boolean;
    mistakeReason: string | null;
  }>;
}

export async function completeStudyTask(input: {
  userId: string;
  taskId: string;
}) {
  const response = await fetch(`${API_BASE_URL}/study-tasks/${input.taskId}/complete`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ userId: input.userId }),
  });

  if (!response.ok) {
    throw new Error(`Study task completion failed with ${response.status}`);
  }

  return response.json() as Promise<{
    id: string;
    completed: boolean;
    feedback: {
      message: string;
      nextAction: string;
    };
  }>;
}

export async function reviewWrongQuestion(input: {
  userId: string;
  questionId: string;
}): Promise<WrongQuestion> {
  const response = await fetch(`${API_BASE_URL}/wrong-questions/${input.questionId}/review`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ userId: input.userId }),
  });

  if (!response.ok) {
    throw new Error(`Wrong question review failed with ${response.status}`);
  }

  return response.json() as Promise<WrongQuestion>;
}

export async function fetchStageAssessment(userId: string): Promise<StageAssessment> {
  const response = await fetch(`${API_BASE_URL}/assessments/stage?userId=${encodeURIComponent(userId)}`);
  if (!response.ok) {
    throw new Error(`Stage assessment request failed with ${response.status}`);
  }

  return response.json() as Promise<StageAssessment>;
}

export async function submitStageAssessment(input: {
  userId: string;
  answers: Array<{
    questionId: string;
    selectedAnswer: string;
    timeSpentSec: number;
  }>;
}): Promise<StageAssessmentResult> {
  const response = await fetch(`${API_BASE_URL}/assessments/stage/submit`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`Stage assessment submission failed with ${response.status}`);
  }

  return response.json() as Promise<StageAssessmentResult>;
}

export async function requestTutorReply(input: {
  userId: string;
  questionId: string;
  selectedAnswer?: string;
  prompt?: string;
}): Promise<TutorReply> {
  const response = await fetch(`${API_BASE_URL}/ai/tutor-reply`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`AI tutor reply request failed with ${response.status}`);
  }

  return response.json() as Promise<TutorReply>;
}

export async function createTeacherQuestion(input: CreateTeacherQuestionInput): Promise<Question> {
  const response = await fetch(`${API_BASE_URL}/questions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`Teacher question creation failed with ${response.status}`);
  }

  return response.json() as Promise<Question>;
}

export async function createKnowledgePoint(input: CreateKnowledgePointInput): Promise<KnowledgePoint> {
  const response = await fetch(`${API_BASE_URL}/knowledge-points`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`Knowledge point creation failed with ${response.status}`);
  }

  return response.json() as Promise<KnowledgePoint>;
}

export async function generatePaper(input: GeneratePaperInput): Promise<GeneratedPaper> {
  const response = await fetch(`${API_BASE_URL}/papers/generate`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`Paper generation failed with ${response.status}`);
  }

  return response.json() as Promise<GeneratedPaper>;
}

export async function loginAsRole(role: UserRole): Promise<AuthSession> {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ role }),
  });

  if (!response.ok) {
    throw new Error(`Login failed with ${response.status}`);
  }

  return response.json() as Promise<AuthSession>;
}

export async function submitDiagnosticProfile(input: DiagnosticInput): Promise<DiagnosticProfile> {
  const response = await fetch(`${API_BASE_URL}/diagnostics/profile`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    throw new Error(`Diagnostic profile submission failed with ${response.status}`);
  }

  return response.json() as Promise<DiagnosticProfile>;
}
