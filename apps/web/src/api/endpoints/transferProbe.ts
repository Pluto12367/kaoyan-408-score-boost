import { API_BASE_URL, fetchWithAuth } from '../client';

/**
 * S2 Transfer Probe client. The probe card/runner talks only to these two
 * surfaces; the submission itself reuses the existing practice-session
 * submit client (same canonical path as every other attempt).
 */

export interface DueProbeCardView {
  probeId: string;
  taskId: string;
  nodeId: string;
  nodeName: string;
  dueDate: string;
  bucket: string;
  isomorphism: string;
  kind: string;
  reason?: string;
  session: {
    sessionId: string;
    question: {
      id: string;
      stem: string;
      options: string[];
      type: string;
      difficulty: string;
      expectedTimeSec: number;
    };
  } | null;
}

export interface DueProbesResponse {
  userId: string;
  storeAvailable: boolean;
  featureEnabled: boolean;
  cards: DueProbeCardView[];
  deliveredCount: number;
}

export async function fetchDueProbes(): Promise<DueProbesResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/coach/transfer-probes`);
  if (!response.ok) throw new Error(`加载迁移复测失败（${response.status}）`);
  return response.json() as Promise<DueProbesResponse>;
}

export interface TransferProbeEventView {
  probeId: string | null;
  nodeId: string | null;
  questionId: string | null;
  bucket: string | null;
  isomorphism: string | null;
  correct: boolean | null;
  recordedAt: string | null;
}

export interface TransferObservationResponse {
  userId: string;
  storeAvailable?: boolean;
  events: TransferProbeEventView[];
  note?: string;
}

export async function fetchTransferObservation(): Promise<TransferObservationResponse> {
  const response = await fetchWithAuth(`${API_BASE_URL}/coach/transfer-observation`);
  if (!response.ok) throw new Error(`加载复测记录失败（${response.status}）`);
  return response.json() as Promise<TransferObservationResponse>;
}
