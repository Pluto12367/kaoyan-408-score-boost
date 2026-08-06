import { API_BASE_URL, fetchWithAuth } from '../client';
import type { ConfidenceLevel, MistakeReason } from '@kaoyan408/shared';
import type { PracticeSetResult, StageAssessmentResult, DiagnosticInput, DiagnosticProfile } from '../types';

export interface VariantRetestProgress {
  originalQuestionId: string;
  consecutiveCorrect: number;
  stability: string;
  nextReviewInDays: number;
  message: string;
}

export interface PracticeAnswerResult {
  id: string;
  correct: boolean;
  mistakeReason: MistakeReason | null;
  timeSpentSec: number;
  expectedTimeSec: number;
  analysis: string;
  correctAnswer: string;
  knowledgePointTitle: string;
  selectedAnswer?: string;
  confidence?: ConfidenceLevel;
  usedHint?: boolean;
  answerModified?: boolean;
  variantProgress?: VariantRetestProgress;
}

export async function submitPracticeAnswer(input: {
  questionId: string; knowledgePointId: string;
  selectedAnswer: string; timeSpentSec: number;
  confidence?: ConfidenceLevel;
  usedHint?: boolean;
  answerModified?: boolean;
  variantQuestionId?: string;
}): Promise<PracticeAnswerResult> {
  const response = await fetchWithAuth(`${API_BASE_URL}/practice-records`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Practice submission failed with ${response.status}`);
  return response.json() as Promise<PracticeAnswerResult>;
}

export async function submitPracticeSet(input: {
  practiceSetId: string;
  answers: Array<{ questionId: string; selectedAnswer: string; timeSpentSec: number }>;
}): Promise<PracticeSetResult> {
  const response = await fetchWithAuth(`${API_BASE_URL}/practice-sets/${input.practiceSetId}/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answers: input.answers }),
  });
  if (!response.ok) throw new Error(`Practice set submission failed with ${response.status}`);
  return response.json() as Promise<PracticeSetResult>;
}

export async function submitStageAssessment(input: {
  answers: Array<{ questionId: string; selectedAnswer: string; timeSpentSec: number }>;
}): Promise<StageAssessmentResult> {
  const response = await fetchWithAuth(`${API_BASE_URL}/assessments/stage/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Stage assessment submission failed with ${response.status}`);
  return response.json() as Promise<StageAssessmentResult>;
}

export async function submitDiagnosticProfile(input: DiagnosticInput): Promise<DiagnosticProfile> {
  const response = await fetchWithAuth(`${API_BASE_URL}/diagnostics/profile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Diagnostic profile submission failed with ${response.status}`);
  return response.json() as Promise<DiagnosticProfile>;
}

export async function completeStudyTask(input: {
  taskId: string; completedQuestionCount?: number;
  correctCount?: number; minutesSpent?: number; selfRating?: number;
}) {
  const response = await fetchWithAuth(`${API_BASE_URL}/study-tasks/${input.taskId}/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      completedQuestionCount: input.completedQuestionCount,
      correctCount: input.correctCount,
      minutesSpent: input.minutesSpent,
      selfRating: input.selfRating,
    }),
  });
  if (!response.ok) throw new Error(`Study task completion failed with ${response.status}`);
  return response.json();
}
