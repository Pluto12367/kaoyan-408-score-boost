import { API_BASE_URL, fetchWithAuth } from '../client';
import type { Subject } from '@kaoyan408/shared';
import type { ScoreCenterPlan } from './score-center';

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
    questionIds?: string[];
    subject: string;
    chapter: string;
    title: string;
    minutes: number;
    questionCount: number;
    mode: string;
    priority: '高' | '中' | '低';
    reason: string;
    reasonCodes?: string[] | null;
    nextAction: string;
    scheduledDate: string;
    status: 'pending' | 'in_progress' | 'postponed' | 'completed';
    postponeCount: number;
    startedAt?: string;
    nextAvailableAt?: string;
    completed?: boolean;
    progress?: {
      completedQuestionCount: number;
      correctCount: number;
      minutesSpent: number;
      reachedTarget: boolean;
    };
  }>;
  weekProgress: Array<{
    date: string;
    taskCount: number;
    completedTasks: number;
    totalMinutes: number;
    focusTitle?: string;
    focusCompleted?: boolean;
  }>;
  reviewDue: number;
  checkpoint: string;
  scoreCenter?: ScoreCenterPlan | null;
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
    taskId: string; postponeCount: number; nextAvailableAt: string; rescheduledDate?: string; message: string;
  }>;
}

export async function startTask(taskId: string) {
  const response = await fetchWithAuth(`${API_BASE_URL}/tasks/${taskId}/start`, { method: 'POST' });
  if (!response.ok) throw new Error(`Task start failed with ${response.status}`);
  return response.json() as Promise<{
    taskId: string;
    status: 'in_progress';
    startedAt: string;
    message: string;
  }>;
}

export async function rescheduleTask(taskId: string, scheduledDate: string) {
  const response = await fetchWithAuth(`${API_BASE_URL}/tasks/${taskId}/reschedule`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scheduledDate }),
  });
  if (!response.ok) throw new Error(`Task reschedule failed with ${response.status}`);
  return response.json() as Promise<{ taskId: string; scheduledDate: string; message: string }>;
}

export async function rebalanceTasks(mode: 'reduce' | 'priority_only') {
  const response = await fetchWithAuth(`${API_BASE_URL}/tasks/rebalance`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  if (!response.ok) throw new Error(`Task rebalance failed with ${response.status}`);
  return response.json() as Promise<{
    userId: string;
    mode: 'reduce' | 'priority_only';
    adjustedTaskCount: number;
    postponedCount: number;
    message: string;
  }>;
}
