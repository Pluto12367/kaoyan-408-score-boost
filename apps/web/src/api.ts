import {
  buildStudyPlan,
  computeWeaknessReport,
  type KnowledgePoint,
  type PracticeRecord,
  type Question,
  type StudyPlan,
  type UserProfile,
  type WeaknessReport,
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
      },
    ],
    learningCalendar: createMockLearningCalendar(),
    stageAssessment: createMockStageAssessment(),
    report,
    plan,
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
  }>;
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
