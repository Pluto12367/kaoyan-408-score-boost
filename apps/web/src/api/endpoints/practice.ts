import { API_BASE_URL } from '../client';
import type { PracticeSetResult, StageAssessmentResult, DiagnosticInput, DiagnosticProfile } from '../types';

export async function submitPracticeAnswer(input: {
  userId: string; questionId: string; knowledgePointId: string;
  selectedAnswer: string; timeSpentSec: number;
}) {
  const response = await fetch(`${API_BASE_URL}/practice-records`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Practice submission failed with ${response.status}`);
  return response.json() as Promise<{ id: string; correct: boolean; mistakeReason: string | null }>;
}

export async function submitPracticeSet(input: {
  userId: string; practiceSetId: string;
  answers: Array<{ questionId: string; selectedAnswer: string; timeSpentSec: number }>;
}): Promise<PracticeSetResult> {
  const response = await fetch(`${API_BASE_URL}/practice-sets/${input.practiceSetId}/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ userId: input.userId, answers: input.answers }),
  });
  if (!response.ok) throw new Error(`Practice set submission failed with ${response.status}`);
  return response.json() as Promise<PracticeSetResult>;
}

export async function submitStageAssessment(input: {
  userId: string;
  answers: Array<{ questionId: string; selectedAnswer: string; timeSpentSec: number }>;
}): Promise<StageAssessmentResult> {
  const response = await fetch(`${API_BASE_URL}/assessments/stage/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Stage assessment submission failed with ${response.status}`);
  return response.json() as Promise<StageAssessmentResult>;
}

export async function submitDiagnosticProfile(input: DiagnosticInput): Promise<DiagnosticProfile> {
  const response = await fetch(`${API_BASE_URL}/diagnostics/profile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Diagnostic profile submission failed with ${response.status}`);
  return response.json() as Promise<DiagnosticProfile>;
}

export async function completeStudyTask(input: {
  userId: string; taskId: string; completedQuestionCount?: number;
  correctCount?: number; minutesSpent?: number; selfRating?: number;
}) {
  const response = await fetch(`${API_BASE_URL}/study-tasks/${input.taskId}/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      userId: input.userId, completedQuestionCount: input.completedQuestionCount,
      correctCount: input.correctCount, minutesSpent: input.minutesSpent, selfRating: input.selfRating,
    }),
  });
  if (!response.ok) throw new Error(`Study task completion failed with ${response.status}`);
  return response.json();
}
