/**
 * V6 Learning Outcome & Intervention & Attribution — pure derivation layer.
 *
 * Three concerns, one module (they are tightly coupled conceptually):
 *
 * 1. LearningOutcome — measurable change in student state after an intervention
 * 2. LearningIntervention — unified identity for any AI/system-driven action
 * 3. OutcomeAttribution — evidence-based association (NOT causation)
 *
 * All derivations are READ-ONLY from Source Facts. No new tables. No new
 * fact source. Rebuildable from the same inputs at any time.
 *
 * Principle: correlation != causation. When evidence is insufficient,
 * report insufficient_data — never fabricate a precise effect size.
 */

// ---- Intervention Model ----

export type InterventionType =
  | 'recommendation'
  | 'coach_prompt'
  | 'review_task'
  | 'practice_task'
  | 'study_plan_task'
  | 'exam_simulation';

export interface LearningIntervention {
  /** Reuses existing studyTaskId / recommendationActionId — no new ID system. */
  interventionId: string;
  type: InterventionType;
  /** Which student action this intervention targets. */
  targetKnowledgeNodeId: string | null;
  targetSubject: string | null;
  /** When the intervention was delivered to the student. */
  deliveredAt: string;
  /** Expected outcome direction (from the adaptive layer that generated it). */
  expectedOutcome: string;
  /** Which adaptive component generated this intervention. */
  source: 'recommendation_engine' | 'proactive_coach' | 'daily_planner' | 'exam_simulator' | 'tutor';
}

export function buildIntervention(params: {
  interventionId: string;
  type: InterventionType;
  targetKnowledgeNodeId?: string | null;
  targetSubject?: string | null;
  deliveredAt: string;
  expectedOutcome: string;
  source: LearningIntervention['source'];
}): LearningIntervention {
  return {
    interventionId: params.interventionId,
    type: params.type,
    targetKnowledgeNodeId: params.targetKnowledgeNodeId ?? null,
    targetSubject: params.targetSubject ?? null,
    deliveredAt: params.deliveredAt,
    expectedOutcome: params.expectedOutcome,
    source: params.source,
  };
}

// ---- Outcome Model ----

export interface OutcomeSnapshot {
  mastery: number | null;
  accuracy: number | null;
  reviewSuccessRate: number | null;
  taskCompletionRate: number | null;
  practiceEfficiency: number | null;
  examScorePercent: number | null;
}

export interface LearningOutcome {
  userId: string;
  knowledgeNodeId: string | null;
  interventionId: string;
  before: OutcomeSnapshot;
  after: OutcomeSnapshot;
  /** Time window between before-snapshot and after-snapshot. */
  windowDays: number;
  sampleSize: number;
  confidence: 'high' | 'medium' | 'low' | 'insufficient_data';
  timestamp: string;
  deltas: {
    masteryGain: number | null;
    accuracyGain: number | null;
    retentionDelta: number | null;
    reviewSuccessDelta: number | null;
    completionDelta: number | null;
    practiceEfficiencyDelta: number | null;
    examScoreDelta: number | null;
  };
}

const MIN_SAMPLE_SIZE = 2;

function delta(before: number | null, after: number | null): number | null {
  if (before == null || after == null) return null;
  return Math.round((after - before) * 10000) / 10000;
}

function confidenceFor(sampleSize: number, windowDays: number): LearningOutcome['confidence'] {
  if (sampleSize < MIN_SAMPLE_SIZE) return 'insufficient_data';
  if (sampleSize >= 5 && windowDays >= 3) return 'high';
  if (sampleSize >= 3) return 'medium';
  return 'low';
}

export function deriveLearningOutcome(params: {
  userId: string;
  intervention: LearningIntervention;
  before: OutcomeSnapshot;
  after: OutcomeSnapshot;
  windowStart: string;
  windowEnd: string;
  sampleSize: number;
}): LearningOutcome {
  const windowDays = Math.max(0, Math.round(
    (new Date(params.windowEnd).getTime() - new Date(params.windowStart).getTime()) / 86_400_000,
  ));
  return {
    userId: params.userId,
    knowledgeNodeId: params.intervention.targetKnowledgeNodeId,
    interventionId: params.intervention.interventionId,
    before: params.before,
    after: params.after,
    windowDays,
    sampleSize: params.sampleSize,
    confidence: confidenceFor(params.sampleSize, windowDays),
    timestamp: params.windowEnd,
    deltas: {
      masteryGain: delta(params.before.mastery, params.after.mastery),
      accuracyGain: delta(params.before.accuracy, params.after.accuracy),
      retentionDelta: delta(params.before.reviewSuccessRate, params.after.reviewSuccessRate),
      reviewSuccessDelta: delta(params.before.reviewSuccessRate, params.after.reviewSuccessRate),
      completionDelta: delta(params.before.taskCompletionRate, params.after.taskCompletionRate),
      practiceEfficiencyDelta: delta(params.before.practiceEfficiency, params.after.practiceEfficiency),
      examScoreDelta: delta(params.before.examScorePercent, params.after.examScorePercent),
    },
  };
}

// ---- Outcome Attribution ----

export type AttributionMethod = 'direct' | 'time_window' | 'knowledge_node' | 'sequence';
export type AttributionStrength = 'strong' | 'moderate' | 'weak' | 'insufficient_data';

export interface OutcomeAttribution {
  interventionId: string;
  outcome: LearningOutcome;
  method: AttributionMethod;
  /** Association strength — NOT causation. */
  association: AttributionStrength;
  /** Time between intervention delivery and outcome measurement (days). */
  lagDays: number;
  /** Caveats that prevent causal claims. */
  confounders: string[];
}

export function attributeOutcome(params: {
  intervention: LearningIntervention;
  outcome: LearningOutcome;
  /** Other interventions in the same time window (confounders). */
  concurrentInterventions: readonly LearningIntervention[];
}): OutcomeAttribution {
  const lagDays = Math.max(0, Math.round(
    (new Date(params.outcome.timestamp).getTime() - new Date(params.intervention.deliveredAt).getTime()) / 86_400_000,
  ));

  const confounders: string[] = [];
  let method: AttributionMethod = 'time_window';
  let strength: AttributionStrength = 'insufficient_data';

  // Confounder: other interventions in the same window
  if (params.concurrentInterventions.length > 1) {
    confounders.push('multiple_interventions_same_window');
  }
  // Confounder: outcome window too short for mastery to meaningfully change
  if (params.outcome.windowDays < 1) {
    confounders.push('outcome_window_under_1_day');
  }
  // Confounder: insufficient sample size
  if (params.outcome.confidence === 'insufficient_data') {
    confounders.push('insufficient_sample_size');
  }

  // Method: knowledge_node match = stronger attribution
  if (params.outcome.knowledgeNodeId && params.intervention.targetKnowledgeNodeId === params.outcome.knowledgeNodeId) {
    method = 'knowledge_node';
    const knowledgeNodeStrength: AttributionStrength = params.outcome.confidence === 'high' ? 'strong' : 'moderate';
    strength = knowledgeNodeStrength;
  } else if (params.outcome.confidence === 'high' && lagDays <= 7) {
    method = 'time_window';
    strength = 'moderate';
  } else if (params.outcome.confidence === 'medium') {
    method = 'time_window';
    strength = 'weak';
  }

  if (confounders.length >= 2 || params.outcome.confidence === 'insufficient_data') {
    strength = 'insufficient_data';
  }

  return {
    interventionId: params.intervention.interventionId,
    outcome: params.outcome,
    method,
    association: strength,
    lagDays,
    confounders,
  };
}

// ---- Effectiveness Report (per intervention type) ----

export interface EffectivenessReport {
  interventionType: InterventionType;
  sampleSize: number;
  avgMasteryGain: number | null;
  avgAccuracyGain: number | null;
  completionRate: number | null;
  strongAssociationCount: number;
  verdict: 'effective' | 'neutral' | 'ineffective' | 'insufficient_data';
}

export function evaluateEffectiveness(
  interventions: readonly LearningIntervention[],
  outcomes: readonly LearningOutcome[],
  attributions: readonly OutcomeAttribution[],
  targetType: InterventionType,
): EffectivenessReport {
  const matching = attributions.filter((attr) =>
    interventions.find((i) => i.interventionId === attr.interventionId)?.type === targetType,
  );
  const sampleSize = matching.length;
  if (sampleSize === 0) {
    return { interventionType: targetType, sampleSize: 0, avgMasteryGain: null, avgAccuracyGain: null, completionRate: null, strongAssociationCount: 0, verdict: 'insufficient_data' };
  }

  const masteryGains = matching.map((m) => m.outcome.deltas.masteryGain).filter((v): v is number => v != null);
  const accuracyGains = matching.map((m) => m.outcome.deltas.accuracyGain).filter((v): v is number => v != null);
  const strongCount = matching.filter((m) => m.association === 'strong').length;
  const avg = (values: number[]) => values.length > 0 ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10000) / 10000 : null;

  const avgMastery = avg(masteryGains);
  const verdict: EffectivenessReport['verdict'] =
    sampleSize < MIN_SAMPLE_SIZE ? 'insufficient_data'
      : avgMastery != null && avgMastery > 0.05 ? 'effective'
        : avgMastery != null && avgMastery < -0.05 ? 'ineffective'
          : 'neutral';

  return {
    interventionType: targetType,
    sampleSize,
    avgMasteryGain: avg(masteryGains),
    avgAccuracyGain: avg(accuracyGains),
    completionRate: null,
    strongAssociationCount: strongCount,
    verdict,
  };
}