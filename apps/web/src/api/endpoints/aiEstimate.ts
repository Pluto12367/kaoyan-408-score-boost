// V14 ②（D-A 批准 2026-09-27）— AI 大题估分 client。
// 设计 docs/v14-flagship-detailed-design.md §2.5。失败显式抛错——无静默兜底（§4）。

import { API_BASE_URL, fetchWithAuth } from '../client';

export interface AiEstimateCriterion {
  readonly id: string;
  readonly description: string;
  readonly points: number;
  readonly matched: boolean;
  readonly reason: string;
}

export interface AiEstimateResult {
  readonly questionId: string;
  readonly rubricVersion: number;
  readonly rubricHash: string;
  readonly suggestedScore: number;
  readonly maxScore: number;
  readonly criteria: readonly AiEstimateCriterion[];
  readonly confidence: 'medium';
  readonly limitations: string;
  readonly basis: 'ai_rubric_match';
  readonly model: string;
}

export async function requestAiEstimate(questionId: string, answerText: string): Promise<AiEstimateResult> {
  const response = await fetchWithAuth(`${API_BASE_URL}/questions/${questionId}/ai-estimate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answerText }),
  });
  if (!response.ok) {
    let message = `AI 估分失败（${response.status}）`;
    try {
      const payload = await response.json() as { message?: string | string[] };
      if (typeof payload.message === 'string') message = payload.message;
      if (Array.isArray(payload.message)) message = payload.message.join('；');
    } catch { /* keep status-based fallback */ }
    throw new Error(message);
  }
  return response.json() as Promise<AiEstimateResult>;
}
