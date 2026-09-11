import { API_BASE_URL, fetchWithAuth } from '../client';

/**
 * S1 Score Anchor — Score Ledger client.
 *
 * The ledger keeps prediction / assessment / outcome as THREE separate kinds
 * of evidence; this client never merges them and always carries provenance
 * through to the UI. Static demo mode callers must check isStaticDemoMode()
 * before invoking (same discipline as every endpoint module).
 */

export interface ScorePredictionView {
  id: string;
  kind: 'prediction';
  modelVersion: string;
  predictedScore: number;
  predictedMinScore: number | null;
  predictedMaxScore: number | null;
  normalizedTotalScale: number;
  generatedAt: string;
}

export interface ScoreAssessmentView {
  id: string;
  kind: 'assessment';
  source: string;
  semantic: string;
  originType: string;
  rawScore: number;
  rawTotalScale: number;
  normalizedScore: number | null;
  normalizedTotalScale: number;
  examDate: string | null;
  title: string | null;
  gradingMethod: string | null;
  corrected: boolean;
  correctionCount: number;
}

export interface ScoreOutcomeView {
  id: string;
  kind: 'outcome';
  source: string;
  semantic: string;
  examType: string;
  rawScore: number;
  rawTotalScale: number;
  normalizedScore: number | null;
  normalizedTotalScale: number;
  occurredAt: string;
  verificationStatus: string;
  corrected: boolean;
  correctionCount: number;
}

export interface ScoreEvidenceBundle {
  userId: string;
  generatedAt: string;
  storeAvailable: boolean;
  reason?: string;
  examDate: string | null;
  predictions: ScorePredictionView[];
  assessments: ScoreAssessmentView[];
  outcomes: ScoreOutcomeView[];
  anchors: {
    verifiedOutcome?: ScoreOutcomeView | null;
    latestAssessment?: ScoreAssessmentView | null;
    latestPrediction?: ScorePredictionView | null;
  };
  calibrationEvidence: {
    status: 'not_started' | 'insufficient_evidence' | 'preliminary' | 'gate_passed';
    strata: Array<{ source: string; layer: string; n: number; gatePass: boolean }>;
    pairedCount: number;
    pendingVerification: number;
    exclusions: Array<{ key: string; reason: string }>;
  };
}

export async function fetchScoreEvidence(): Promise<ScoreEvidenceBundle> {
  const response = await fetchWithAuth(`${API_BASE_URL}/coach/score-evidence`);
  if (!response.ok) {
    throw new Error(`加载成绩锚点失败（${response.status}）`);
  }
  return (await response.json()) as ScoreEvidenceBundle;
}

export interface RecordScorePredictionInput {
  predictionKey: string;
  modelVersion: string;
  predictedScore: number;
  predictedMinScore?: number;
  predictedMaxScore?: number;
  generatedFor?: string;
  inputsSnapshot?: Record<string, unknown>;
}

/** Best-effort persistence of a locally computed prediction; duplicates read back. */
export async function recordScorePrediction(input: RecordScorePredictionInput): Promise<void> {
  const response = await fetchWithAuth(`${API_BASE_URL}/coach/score-evidence/predictions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`记录预测分失败（${response.status}）`);
  }
}
