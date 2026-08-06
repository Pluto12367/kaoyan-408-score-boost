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
  inferredReason?: string;
  note?: string;
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

export interface WrongQuestionDetailLayerItem {
  questionId: string;
  stem: string;
  difficulty: string;
  source: string;
  type?: string;
  knowledgePointId?: string;
  knowledgePointTitle?: string;
}

export interface WrongQuestionDetail {
  questionId: string;
  stem: string;
  answer?: string;
  analysis?: string;
  knowledgePointTitle: string;
  subject: string;
  chapter: string;
  masteryStatus: '未掌握' | '复习中' | '已掌握';
  masteryCriteria: {
    stability: string;
    consecutiveCorrect: number;
    variantCorrectCount: number;
  };
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
    inferredReason?: string;
  } | null;
  note: string;
  reviewHistory: Array<{
    redoCorrect: boolean;
    timeSpentSec: number;
    reportedReason?: string;
    inferredReason?: string;
    nextIntervalDays: number;
    reviewedAt: string;
  }>;
  similarQuestions: Array<{ id: string; stem: string; difficulty: string; source: string }>;
  reviewLayers: {
    original: WrongQuestionDetailLayerItem | null;
    variants: WrongQuestionDetailLayerItem[];
    confusingConcepts: WrongQuestionDetailLayerItem[];
    comprehensive: WrongQuestionDetailLayerItem[];
  };
  recommendation: string;
}

export async function reportWrongReason(questionId: string, input: {
  selfReportedReason: string;
  redoCorrect: boolean;
  timeSpentSec: number;
  isReview?: boolean;
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

export async function saveWrongQuestionNote(questionId: string, note: string) {
  const response = await fetchWithAuth(`${API_BASE_URL}/wrong-questions/${questionId}/note`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ note }),
  });
  if (!response.ok) throw new Error(`Wrong question note save failed with ${response.status}`);
  return response.json() as Promise<{ questionId: string; note: string; updatedAt: string }>;
}
