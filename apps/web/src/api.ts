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
  report: WeaknessReport;
  plan: StudyPlan;
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
    report,
    plan,
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
