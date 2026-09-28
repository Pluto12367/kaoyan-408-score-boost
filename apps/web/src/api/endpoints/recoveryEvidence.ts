// V14 ①（D-V 批准 2026-09-27）— 提分账本 client。失败显式抛错（无静默兜底）。

import { API_BASE_URL, fetchWithAuth } from '../client';

export interface RecoveryClaim {
  kind: 'OBSERVED' | 'PROXY';
  /** null = 未定价失分被追回（只计数不计金额）。 */
  recoveredScore: number | null;
  questionId: string | null;
  nodeId: string | null;
  nodeName: string | null;
  note: string;
}

export interface RecoveryEvidenceResponse {
  userId: string;
  generatedAt: string;
  storeAvailable: boolean;
  reason?: string;
  windowDays: number;
  claims: RecoveryClaim[];
  proxyClaims: RecoveryClaim[];
  summary: {
    observedRecovered: number;
    proxyRecovered: number;
    unpricedRecovered: number;
    recoveredCandidates: number;
    insufficient: boolean;
    minSamples: number;
  };
  footnote: string;
}

export async function fetchRecoveryEvidence(days = 30): Promise<RecoveryEvidenceResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/coach/recovery-evidence?days=${days}`);
  if (!response.ok) throw new Error(`提分账本加载失败（${response.status}）`);
  return response.json() as Promise<RecoveryEvidenceResponse>;
}
