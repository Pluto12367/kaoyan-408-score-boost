// V14-②+ — memory-card admin management endpoints (design doc
// docs/v14-memory-card-admin-design.md). Admin-only; every mutation carries
// RULE-10 provenance (reviewedBy + rightsConfirmed). Failures throw — no
// silent fallback.

import { API_BASE_URL, fetchWithAuth } from '../client';

export interface AdminMemoryCard {
  id: string;
  knowledgeNodeId: string;
  nodeName: string | null;
  cardType: string;
  front: string;
  back: string;
  reviewedBy: string | null;
  rightsConfirmed: boolean;
  isActive: boolean;
  reviewCount: number;
  createdAt: string;
}

export interface AdminMemoryCardList {
  storeAvailable: boolean;
  total: number;
  cards: AdminMemoryCard[];
}

export async function fetchAdminMemoryCards(input: { nodeId?: string; includeRetired?: boolean } = {}): Promise<AdminMemoryCardList> {
  const params = new URLSearchParams();
  if (input.nodeId) params.set('nodeId', input.nodeId);
  if (input.includeRetired) params.set('includeRetired', 'true');
  const query = params.toString() ? `?${params.toString()}` : '';
  const response = await fetchWithAuth(`${API_BASE_URL}/admin/memory-cards${query}`);
  if (!response.ok) throw new Error(`记忆卡目录加载失败（${response.status}）`);
  return response.json();
}

export async function createAdminMemoryCard(input: {
  knowledgeNodeId: string;
  cardType: 'CONCLUSION' | 'FORMULA';
  front: string;
  back: string;
  reviewedBy: string;
  rightsConfirmed: boolean;
}): Promise<{ id: string }> {
  const response = await fetchWithAuth(`${API_BASE_URL}/admin/memory-cards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`新建卡片失败（${response.status}）`);
  return response.json();
}

export async function editAdminMemoryCard(
  cardId: string,
  input: { editKind: 'light' | 'rewrite'; front?: string; back?: string; cardType?: string; reviewedBy: string; rightsConfirmed: boolean },
): Promise<{ mode: string; retiredId?: string; newId?: string }> {
  const response = await fetchWithAuth(`${API_BASE_URL}/admin/memory-cards/${cardId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`编辑卡片失败（${response.status}）`);
  return response.json();
}

export async function retireAdminMemoryCard(cardId: string): Promise<{ id: string; isActive: false }> {
  const response = await fetchWithAuth(`${API_BASE_URL}/admin/memory-cards/${cardId}/retire`, {
    method: 'PATCH',
  });
  if (!response.ok) throw new Error(`停用卡片失败（${response.status}）`);
  return response.json();
}
