/**
 * V6 Effectiveness Platform — Student Segmentation, Experiment Engine,
 * Strategy Optimizer (proposal-only), and Human-in-the-Loop safety.
 *
 * All pure functions. Deterministic. No LLM involvement.
 * Optimizer generates proposals only — never modifies production strategy.
 */

import type { LearningIntervention, LearningOutcome, OutcomeAttribution } from './learning-outcome.js';

// ---- Student Segmentation (V6-11) ----

export type StudentArchetype =
  | 'strong_consistent' | 'strong_slip'
  | 'average' | 'average_idle'
  | 'weak_cram' | 'weak_overdue'
  | 'regressing' | 'balanced'
  | 'overloaded' | 'returning'
  | 'failing';

export interface StudentProfile {
  archetype: StudentArchetype;
  masteryLevel: 'weak' | 'average' | 'strong';
  consistency: 'high' | 'medium' | 'low';
  errorPattern: 'low' | 'moderate' | 'high';
  reviewBehavior: 'current' | 'debt';
  studyVolume: 'low' | 'medium' | 'high';
  examProximity: 'far' | 'near';
}

export function classifyStudent(params: {
  avgMastery: number;
  recentAccuracy: number;
  studyStreak: number;
  overdueCount: number;
  openTaskCount: number;
  examDaysRemaining: number;
}): StudentProfile {
  const masteryLevel = params.avgMastery >= 0.7 ? 'strong' : params.avgMastery >= 0.45 ? 'average' : 'weak';
  const consistency = params.studyStreak >= 7 ? 'high' : params.studyStreak >= 3 ? 'medium' : 'low';
  const errorPattern = params.recentAccuracy >= 0.75 ? 'low' : params.recentAccuracy >= 0.5 ? 'moderate' : 'high';
  const reviewBehavior = params.overdueCount > 2 ? 'debt' : 'current';
  const studyVolume = params.openTaskCount >= 5 ? 'high' : params.openTaskCount >= 2 ? 'medium' : 'low';
  const examProximity = params.examDaysRemaining <= 30 ? 'near' : 'far';

  let archetype: StudentArchetype;
  if (masteryLevel === 'strong' && consistency === 'high' && errorPattern === 'low') archetype = 'strong_consistent';
  else if (masteryLevel === 'strong' && errorPattern !== 'low') archetype = 'strong_slip';
  else if (masteryLevel === 'weak' && consistency === 'low' && reviewBehavior === 'debt') archetype = 'failing';
  else if (masteryLevel === 'weak' && errorPattern === 'high' && consistency === 'medium') archetype = 'weak_cram';
  else if (masteryLevel === 'weak' && reviewBehavior === 'debt') archetype = 'weak_overdue';
  else if (errorPattern === 'high' && consistency === 'low') archetype = 'regressing';
  else if (studyVolume === 'high' && params.overdueCount > 0) archetype = 'overloaded';
  else if (consistency === 'low') archetype = 'returning';
  else if (consistency === 'low' || reviewBehavior === 'debt') archetype = 'average_idle';
  else archetype = 'balanced';

  return { archetype, masteryLevel, consistency, errorPattern, reviewBehavior, studyVolume, examProximity };
}

// ---- Offline Experiment Engine (V6-12) ----

export interface ExperimentArm {
  name: string;
  outcomes: readonly LearningOutcome[];
}

export interface ExperimentResult {
  armA: string;
  armB: string;
  sampleSizeA: number;
  sampleSizeB: number;
  metric: string;
  avgA: number | null;
  avgB: number | null;
  delta: number | null;
  confidence: 'sufficient' | 'insufficient_data';
  verdict: 'A_better' | 'B_better' | 'no_significant_difference' | 'insufficient_data';
}

function avgOutcome(outcomes: readonly LearningOutcome[], metric: keyof LearningOutcome['deltas']): number | null {
  const values = outcomes.map((o) => o.deltas[metric]).filter((v): v is number => v != null);
  if (values.length === 0) return null;
  return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10000) / 10000;
}

export function runExperiment(params: {
  armA: ExperimentArm;
  armB: ExperimentArm;
  metric: keyof LearningOutcome['deltas'];
  minSampleSize?: number;
}): ExperimentResult {
  const min = params.minSampleSize ?? 3;
  if (params.armA.outcomes.length < min || params.armB.outcomes.length < min) {
    return { armA: params.armA.name, armB: params.armB.name, sampleSizeA: params.armA.outcomes.length, sampleSizeB: params.armB.outcomes.length, metric: params.metric, avgA: null, avgB: null, delta: null, confidence: 'insufficient_data', verdict: 'insufficient_data' };
  }
  const avgA = avgOutcome(params.armA.outcomes, params.metric);
  const avgB = avgOutcome(params.armB.outcomes, params.metric);
  const delta = avgA != null && avgB != null ? Math.round((avgB - avgA) * 10000) / 10000 : null;
  const verdict = delta == null ? 'insufficient_data' : Math.abs(delta) < 0.01 ? 'no_significant_difference' : delta > 0 ? 'B_better' : 'A_better';
  return {
    armA: params.armA.name, armB: params.armB.name,
    sampleSizeA: params.armA.outcomes.length, sampleSizeB: params.armB.outcomes.length,
    metric: params.metric, avgA, avgB, delta,
    confidence: 'sufficient',
    verdict,
  };
}

// ---- Strategy Optimizer (V6-14, proposal-only) ----

export interface StrategyProposal {
  parameter: string;
  currentValue: string;
  proposedValue: string;
  evidence: string;
  expectedImpact: string;
  risk: 'low' | 'medium' | 'high';
  requiresApproval: true;
  rollbackPlan: string;
}

export function generateStrategyProposals(
  experiments: readonly ExperimentResult[],
): StrategyProposal[] {
  const proposals: StrategyProposal[] = [];
  for (const exp of experiments) {
    if (exp.verdict === 'B_better' && exp.confidence === 'sufficient') {
      proposals.push({
        parameter: exp.metric,
        currentValue: `arm A (${exp.armA}): ${exp.avgA}`,
        proposedValue: `arm B (${exp.armB}): ${exp.avgB}`,
        evidence: `delta=${exp.delta} over ${exp.sampleSizeA}+${exp.sampleSizeB} samples`,
        expectedImpact: 'improvement in ' + exp.metric,
        risk: Math.abs(exp.delta ?? 0) > 0.1 ? 'medium' : 'low',
        requiresApproval: true,
        rollbackPlan: 'revert to arm A configuration',
      });
    }
  }
  return proposals;
}