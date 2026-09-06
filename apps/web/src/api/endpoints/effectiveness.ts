import { API_BASE_URL, fetchWithAuth } from '../client';

/**
 * V6.3 effectiveness read model (apps/api/src/effectiveness) — production
 * consumption. All views are derived per request from existing tables;
 * anything without enough evidence reports insufficient_data.
 */

export interface EvidenceGateResult {
  passed: boolean;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
  reason: string;
}

export interface EffectivenessOutcome {
  knowledgeNodeId: string;
  masteryBefore: number | null;
  masteryAfter: number | null;
  masteryGain: number | null;
  attemptsInWindow: number;
  correctInWindow: number;
  accuracyInWindow: number | null;
  windowDays: number;
  quality: 'ok' | 'insufficient_data' | 'single_attempt';
  sampleSize: number;
  confidence: 'high' | 'medium' | 'low' | 'insufficient_data';
  evidenceGate: EvidenceGateResult;
}

export interface EffectivenessProfile {
  hasLearningData: boolean;
  profile: {
    archetype: string;
    masteryLevel: string;
    consistency: string;
    errorPattern: string;
    reviewBehavior: string;
    studyVolume: string;
    examProximity: string;
  } | null;
  inputs: {
    avgMastery: number;
    recentAccuracy: number;
    studyStreak: number;
    overdueCount: number;
    openTaskCount: number;
    examDaysRemaining: number;
  } | null;
  reason?: 'no_learning_data';
}

export interface EffectivenessSummary {
  userId: string;
  generatedAt: string;
  windowDays: number;
  profile: EffectivenessProfile;
  outcomes: {
    hasLearningData: boolean;
    summary: { nodesEvaluated: number; gatePassed: number; gateBlocked: number };
    outcomes: EffectivenessOutcome[];
  };
  interventions: {
    hasSourceFacts: boolean;
    byStatus: Record<string, number>;
  };
}

export async function fetchEffectivenessSummary(windowDays = 30): Promise<EffectivenessSummary> {
  const response = await fetchWithAuth(`${API_BASE_URL}/effectiveness/summary?windowDays=${windowDays}`);
  if (!response.ok) throw new Error(`Effectiveness summary failed with ${response.status}`);
  return response.json() as Promise<EffectivenessSummary>;
}
