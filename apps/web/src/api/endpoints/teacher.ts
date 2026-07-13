import { API_BASE_URL, fetchWithAuth, authenticatedFetch } from '../client';
import type { Question, KnowledgePoint, GeneratedPaper, PaperSubmitResult, CreateTeacherQuestionInput, CreateKnowledgePointInput, GeneratePaperInput } from '../types';

export async function fetchQuestions(filters: {
  knowledgePointId?: string; subject?: string; chapter?: string;
} = {}): Promise<Question[]> {
  const params = new URLSearchParams();
  if (filters.knowledgePointId) params.set('knowledgePointId', filters.knowledgePointId);
  if (filters.subject) params.set('subject', filters.subject);
  if (filters.chapter) params.set('chapter', filters.chapter);
  const query = params.toString();
  const response = await fetchWithAuth(`${API_BASE_URL}/questions${query ? `?${query}` : ''}`);
  if (!response.ok) throw new Error(`Question list request failed with ${response.status}`);
  return response.json() as Promise<Question[]>;
}

export async function createTeacherQuestion(input: CreateTeacherQuestionInput): Promise<Question> {
  const response = await authenticatedFetch(`${API_BASE_URL}/questions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Teacher question creation failed with ${response.status}`);
  return response.json() as Promise<Question>;
}

export async function updateTeacherQuestion(questionId: string, input: Partial<CreateTeacherQuestionInput>): Promise<Question> {
  const response = await authenticatedFetch(`${API_BASE_URL}/questions/${questionId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Teacher question update failed with ${response.status}`);
  return response.json() as Promise<Question>;
}

export async function deleteTeacherQuestion(questionId: string): Promise<{ id: string; deleted: boolean }> {
  const response = await authenticatedFetch(`${API_BASE_URL}/questions/${questionId}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(`Teacher question deletion failed with ${response.status}`);
  return response.json() as Promise<{ id: string; deleted: boolean }>;
}

export async function createKnowledgePoint(input: CreateKnowledgePointInput): Promise<KnowledgePoint> {
  const response = await authenticatedFetch(`${API_BASE_URL}/knowledge-points`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Knowledge point creation failed with ${response.status}`);
  return response.json() as Promise<KnowledgePoint>;
}

export async function generatePaper(input: GeneratePaperInput): Promise<GeneratedPaper> {
  const response = await authenticatedFetch(`${API_BASE_URL}/papers/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Paper generation failed with ${response.status}`);
  return response.json() as Promise<GeneratedPaper>;
}

export async function submitPaper(input: {
  paperId: string;
  answers: Array<{ questionId: string; selectedAnswer: string; timeSpentSec: number; selfScore?: number; maxScore?: number }>;
}): Promise<PaperSubmitResult> {
  const response = await fetchWithAuth(`${API_BASE_URL}/papers/${input.paperId}/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answers: input.answers }),
  });
  if (!response.ok) throw new Error(`Paper submission failed with ${response.status}`);
  return response.json() as Promise<PaperSubmitResult>;
}
