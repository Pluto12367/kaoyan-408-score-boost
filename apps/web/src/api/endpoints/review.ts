import { API_BASE_URL, fetchWithAuth } from '../client';

export interface ReviewSchedule {
  questionId: string;
  userId: string;
  selfReportedReason: string;
  redoCorrect: boolean;
  timeSpentSec: number;
  consecutiveCorrect: number;
  stability: 'learning' | 'review' | 'mastered';
  nextReviewAt: string;
  reviewCount: number;
  lastReviewedAt: string;
}

export interface DueReviewItem extends ReviewSchedule {
  stem: string;
  knowledgePointTitle: string;
  subject: string;
}

export interface DueReviewsResponse {
  userId: string;
  dueCount: number;
  items: DueReviewItem[];
  nextAction: string;
}

export interface WrongQuestionDetail {
  questionId: string;
  stem: string;
  answer?: string;
  analysis?: string;
  knowledgePointTitle: string;
  subject: string;
  chapter: string;
  attemptHistory: Array<{
    date: string;
    selectedAnswer?: string;
    correct: boolean;
    mistakeReason: string | null;
    timeSpentSec: number;
  }>;
  reviewSchedule: {
    stability: string;
    consecutiveCorrect: number;
    nextReviewAt: string;
    reviewCount: number;
    selfReportedReason: string;
  } | null;
  similarQuestions: Array<{ id: string; stem: string; difficulty: string; source: string }>;
  recommendation: string;
}

export async function reportWrongReason(questionId: string, input: {
  selfReportedReason: string;
  redoCorrect: boolean;
  timeSpentSec: number;
}): Promise<ReviewSchedule & { nextReviewInDays: number; message: string }> {
  const response = await fetchWithAuth(`${API_BASE_URL}/wrong-questions/${questionId}/reason`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Report wrong reason failed with ${response.status}`);
  return response.json();
}

export async function fetchDueReviews(): Promise<DueReviewsResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/review/due`);
  if (!response.ok) throw new Error(`Due reviews fetch failed with ${response.status}`);
  return response.json();
}

export async function fetchWrongQuestionDetail(questionId: string): Promise<WrongQuestionDetail> {
  const response = await fetchWithAuth(`${API_BASE_URL}/wrong-questions/${questionId}/detail`);
  if (!response.ok) throw new Error(`Wrong question detail failed with ${response.status}`);
  return response.json();
}
