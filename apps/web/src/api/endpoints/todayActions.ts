// V14 ③（D-T-1/2 批准 2026-09-27）— 「今天做什么」client。
// 设计 docs/v14-flagship-detailed-design.md §3。失败显式抛错，无静默兜底。

import { API_BASE_URL, fetchWithAuth } from '../client';

export interface TodayAction {
  id: string;
  kind: 'prescription_step' | 'review_due' | 'memory_due' | 'wrong_due';
  priority: number;
  title: string;
  reason: string;
  launch: { type: 'practice_set' | 'due_review' | 'memory_cards' | 'wrong_book'; nodeId?: string; questionSubtype?: string; questionCount?: number };
  evidenceNodeId: string | null;
}

export interface TodayActionsResponse {
  actions: TodayAction[];
  nothingReason: string | null;
  storeAvailable?: boolean;
  reasonUnavailable?: string;
}

export async function fetchTodayActions(limit = 3): Promise<TodayActionsResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/coach/today-actions?limit=${limit}`);
  if (!response.ok) throw new Error(`今日动作加载失败（${response.status}）`);
  return response.json() as Promise<TodayActionsResponse>;
}
