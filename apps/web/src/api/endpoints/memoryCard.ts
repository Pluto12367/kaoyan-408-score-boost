// V14-② — memory-card endpoints (task book docs/v14-memory-card-design.md §5).
// Card content cannot be fabricated: failures throw explicitly — no silent
// fallback to demo data (AGENTS.md §4, real-exam precedent).

import { API_BASE_URL, fetchWithAuth } from '../client';

export type CardSelfRatingValue = 'remembered' | 'fuzzy' | 'forgot';

export interface MemoryCardQueueItem {
  cardId: string;
  knowledgeNodeId: string;
  cardType: string;
  front: string;
  back: string;
  phase: 'due' | 'new';
  retention: number | null;
  nodeName: string | null;
  subject: string | null;
}

export interface MemoryCardSession {
  userId: string;
  storeAvailable: boolean;
  examContext: {
    basis: string;
    daysToExam: number;
    isFallback: boolean;
    label: string;
  };
  queue: MemoryCardQueueItem[];
  summary: {
    dueCount: number;
    newCount: number;
    returned: number;
    sessionCap: number;
    newCardCap: number;
  };
}

export interface MemoryCardReviewResult {
  replayed: boolean;
  applied: {
    quality: number;
    stabilityBefore: number | null;
    stabilityAfter: number | null;
    densityFactor: number;
    densityBasis: string;
    intervalDays: number;
    nextReviewAt: string | null;
  };
  state: {
    stabilityDays: number | null;
    nextReviewAt: string | null;
    retention: number | null;
    reviewCount: number;
  };
}

export async function fetchMemoryCardSession(limit?: number): Promise<MemoryCardSession> {
  const query = limit ? `?limit=${limit}` : '';
  const response = await fetchWithAuth(`${API_BASE_URL}/memory-cards/session${query}`);
  if (!response.ok) throw new Error(`记忆卡队列加载失败（${response.status}）`);
  return response.json();
}

export async function reviewMemoryCard(
  cardId: string,
  input: { rating: CardSelfRatingValue; idempotencyKey: string },
): Promise<MemoryCardReviewResult> {
  const response = await fetchWithAuth(`${API_BASE_URL}/memory-cards/${cardId}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`记忆卡自评提交失败（${response.status}）`);
  return response.json();
}
