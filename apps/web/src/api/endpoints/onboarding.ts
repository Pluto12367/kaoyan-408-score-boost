import { API_BASE_URL, fetchWithAuth } from '../client';
import type { Subject } from '@kaoyan408/shared';

export interface OnboardingStatus {
  completed: boolean;
  profile: null | {
    examYear?: number;
    targetScore: number;
    currentScore: number;
    remainingDays: number;
    dailyHours: number;
    weakestSubject: Subject;
    completedAt: string;
  };
  nextStep: 'complete_onboarding' | 'submit_diagnostic' | 'start_training';
}

export interface TodayPlan {
  userId: string;
  phase: string;
  generatedAt: string;
  summary: {
    completedTasks: number;
    totalTasks: number;
    completionRate: number;
    todayAccuracyRate: number;
    streakDays: number;
  };
  priorityTasks: Array<{
    id: string;
    knowledgePointId: string;
    subject: string;
    chapter: string;
    title: string;
    minutes: number;
    questionCount: number;
    mode: string;
    priority: '高' | '中' | '低';
    reason: string;
    nextAction: string;
    completed?: boolean;
  }>;
  reviewDue: number;
  checkpoint: string;
}

export async function fetchOnboardingStatus(): Promise<OnboardingStatus> {
  const response = await fetchWithAuth(`${API_BASE_URL}/onboarding/status`);
  if (!response.ok) throw new Error(`Onboarding status failed with ${response.status}`);
  return response.json() as Promise<OnboardingStatus>;
}

export async function completeOnboarding(input: {
  examYear?: number;
  targetScore: number;
  currentScore: number;
  remainingDays: number;
  dailyHours: number;
  weakestSubject: Subject;
}) {
  const response = await fetchWithAuth(`${API_BASE_URL}/onboarding/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Onboarding completion failed with ${response.status}`);
  return response.json();
}

export async function fetchTodayPlan(): Promise<TodayPlan> {
  const response = await fetchWithAuth(`${API_BASE_URL}/today/plan`);
  if (!response.ok) throw new Error(`Today plan failed with ${response.status}`);
  return response.json() as Promise<TodayPlan>;
}

export async function postponeTask(taskId: string) {
  const response = await fetchWithAuth(`${API_BASE_URL}/tasks/${taskId}/postpone`, { method: 'POST' });
  if (!response.ok) throw new Error(`Task postpone failed with ${response.status}`);
  return response.json() as Promise<{
    taskId: string; postponeCount: number; nextAvailableAt: string; message: string;
  }>;
}
