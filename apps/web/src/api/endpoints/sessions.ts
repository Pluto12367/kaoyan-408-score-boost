import { API_BASE_URL, fetchWithAuth } from '../client';

export interface SessionAnswer {
  selectedAnswer: string;
  timeSpentSec: number;
  selfScore?: number;
  maxScore?: number;
}

export interface SessionView {
  id: string;
  type: 'practice_set' | 'stage_assessment' | 'paper';
  resourceId?: string;
  questionIds: string[];
  answers: Record<string, SessionAnswer>;
  markedQuestions: string[];
  currentIndex: number;
  totalQuestions: number;
  answeredCount: number;
  startedAt: string;
  lastActiveAt: string;
  totalActiveMs: number;
  completed: boolean;
  progressRate: number;
}

export interface ActiveSessionsResponse {
  sessions: SessionView[];
  count: number;
}

export interface SessionSubmitResult {
  sessionId: string;
  completed: true;
  totalQuestions: number;
  correctCount: number;
  accuracyRate: number;
  totalActiveMs: number;
  records: Array<{ questionId: string; correct: boolean; mistakeReason: string | null; gradingMode?: string; selfScore?: number; maxScore?: number }>;
}

export async function startPracticeSession(input: {
  type: 'practice_set' | 'stage_assessment' | 'paper';
  questionIds: string[];
  resourceId?: string;
}): Promise<SessionView> {
  const response = await fetchWithAuth(`${API_BASE_URL}/sessions/practice/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Session start failed with ${response.status}`);
  return response.json() as Promise<SessionView>;
}

export async function savePracticeProgress(sessionId: string, input: {
  answers?: Record<string, SessionAnswer>;
  currentIndex?: number;
  markedQuestions?: string[];
  idleSince?: number;
}): Promise<SessionView> {
  const response = await fetchWithAuth(`${API_BASE_URL}/sessions/practice/${sessionId}/save`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Session save failed with ${response.status}`);
  return response.json() as Promise<SessionView>;
}

export async function getPracticeSession(sessionId: string): Promise<SessionView> {
  const response = await fetchWithAuth(`${API_BASE_URL}/sessions/practice/${sessionId}`);
  if (!response.ok) throw new Error(`Session fetch failed with ${response.status}`);
  return response.json() as Promise<SessionView>;
}

export async function listActiveSessions(): Promise<ActiveSessionsResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/sessions/active`);
  if (!response.ok) throw new Error(`Active sessions fetch failed with ${response.status}`);
  return response.json() as Promise<ActiveSessionsResponse>;
}

export async function submitPracticeSession(sessionId: string, input: {
  answers: Array<{ questionId: string; selectedAnswer: string; timeSpentSec: number; selfScore?: number; maxScore?: number }>;
}): Promise<SessionSubmitResult> {
  const response = await fetchWithAuth(`${API_BASE_URL}/sessions/practice/${sessionId}/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Session submit failed with ${response.status}`);
  return response.json() as Promise<SessionSubmitResult>;
}
