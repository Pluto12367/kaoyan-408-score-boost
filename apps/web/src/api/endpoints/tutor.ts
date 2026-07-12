import { API_BASE_URL } from '../client';
import type { TutorReply, AiFollowUp } from '../types';

export async function requestTutorReply(input: {
  userId: string; questionId: string; selectedAnswer?: string; prompt?: string;
}): Promise<TutorReply> {
  const response = await fetch(`${API_BASE_URL}/ai/tutor-reply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`AI tutor reply request failed with ${response.status}`);
  return response.json() as Promise<TutorReply>;
}

export async function requestAiFollowUp(input: {
  userId: string; questionId: string; message: string;
}): Promise<AiFollowUp> {
  const response = await fetch(`${API_BASE_URL}/ai/follow-up`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`AI follow-up request failed with ${response.status}`);
  return response.json() as Promise<AiFollowUp>;
}
