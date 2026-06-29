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
    report,
    plan,
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
