/**
 * V6.3 Effectiveness Assembly — pure functions that turn raw DB rows into
 * the inputs consumed by the V6/V6.1/V6.2 derivation layer.
 *
 * This module holds NO framework, database, or clock dependencies: the
 * EffectivenessService reads bounded row sets from Prisma and hands them
 * here. Same rows → same output, so the whole read model stays rebuildable
 * and unit-testable without Nest or Prisma.
 *
 * Honesty rule (inherited from V6): nodes/interventions without enough
 * evidence are reported as insufficient_data — never fabricated.
 */

import {
  buildOutcomeFromFacts,
  checkEvidenceGate,
  type EvidenceGateResult,
  type PipelineOutcome,
  type RawPracticeFact,
} from './outcome-pipeline.js';
import { classifyStudent, type StudentProfile } from './learning-effectiveness.js';

export interface RawPracticeRecordRow {
  questionId: string;
  knowledgePointId: string;
  correct: boolean;
  submittedAt: Date | string;
}

export interface RawNodeMapRow {
  knowledgePointId: string;
  knowledgeNodeId: string;
  mappingType: string;
}

export interface RawMasterySnapshotRow {
  knowledgeNodeId: string;
  mastery: number;
  snapshotDate: Date | string;
}

export interface MasteryBounds {
  before: number | null;
  after: number | null;
}

export interface NodeOutcomeView {
  knowledgeNodeId: string;
  masteryBefore: number | null;
  masteryAfter: number | null;
  masteryGain: number | null;
  attemptsInWindow: number;
  correctInWindow: number;
  accuracyInWindow: number | null;
  windowDays: number;
  quality: PipelineOutcome['quality'];
  sampleSize: number;
  confidence: 'high' | 'medium' | 'low' | 'insufficient_data';
  evidenceGate: EvidenceGateResult;
}

export const EVIDENCE_GATE: {
  minSampleSize: number;
  minEffectSize: number;
  requiredConfidence: string;
} = {
  minSampleSize: 5,
  minEffectSize: 0.05,
  requiredConfidence: 'medium',
};

/**
 * Resolve knowledgePointId → knowledgeNodeId. Rows tagged PRIMARY win over
 * other mapping types; without a mapping the record cannot participate in
 * node-level outcomes (it is dropped here, not silently re-attributed).
 */
export function resolvePointToNodeMap(rows: readonly RawNodeMapRow[]): Map<string, string> {
  const byPoint = new Map<string, string>();
  for (const row of rows) {
    const existing = byPoint.get(row.knowledgePointId);
    if (!existing || (row.mappingType === 'PRIMARY' && existing !== row.knowledgeNodeId)) {
      if (!existing || row.mappingType === 'PRIMARY') byPoint.set(row.knowledgePointId, row.knowledgeNodeId);
    }
  }
  return byPoint;
}

export function toPracticeFacts(
  rows: readonly RawPracticeRecordRow[],
  nodeByPoint: ReadonlyMap<string, string>,
): RawPracticeFact[] {
  const facts: RawPracticeFact[] = [];
  for (const row of rows) {
    const knowledgeNodeId = nodeByPoint.get(row.knowledgePointId) ?? null;
    if (!knowledgeNodeId) continue;
    facts.push({
      questionId: row.questionId,
      knowledgeNodeId,
      correct: row.correct,
      submittedAt: typeof row.submittedAt === 'string' ? row.submittedAt : row.submittedAt.toISOString(),
    });
  }
  return facts;
}

/**
 * Pick before/after mastery per node from daily snapshots:
 *   before = latest snapshot strictly before windowStart (else null)
 *   after  = latest snapshot at/before windowEnd (else null)
 * Nodes without an "after" snapshot have no measurable state and are omitted.
 */
export function pickMasteryBounds(
  snapshots: readonly RawMasterySnapshotRow[],
  nodeIds: readonly string[],
  windowStartMs: number,
  windowEndMs: number,
): Map<string, MasteryBounds> {
  const byNode = new Map<string, MasteryBounds>();
  for (const nodeId of nodeIds) {
    let before: number | null = null;
    let beforeMs = -Infinity;
    let after: number | null = null;
    let afterMs = -Infinity;
    for (const snapshot of snapshots) {
      if (snapshot.knowledgeNodeId !== nodeId) continue;
      const at = typeof snapshot.snapshotDate === 'string'
        ? new Date(snapshot.snapshotDate).getTime()
        : snapshot.snapshotDate.getTime();
      if (Number.isNaN(at)) continue;
      if (at < windowStartMs && at >= beforeMs) {
        beforeMs = at;
        before = snapshot.mastery;
      }
      if (at <= windowEndMs && at >= afterMs) {
        afterMs = at;
        after = snapshot.mastery;
      }
    }
    if (after != null) byNode.set(nodeId, { before, after });
  }
  return byNode;
}

function confidenceFor(sampleSize: number, windowDays: number): NodeOutcomeView['confidence'] {
  if (sampleSize >= 5 && windowDays >= 3) return 'high';
  if (sampleSize >= 3) return 'medium';
  if (sampleSize >= 1) return 'low';
  return 'insufficient_data';
}

/**
 * Derive per-node outcomes with evidence gates. Only nodes that have both
 * window attempts and an "after" mastery snapshot are evaluated.
 */
export function deriveNodeOutcomes(params: {
  facts: readonly RawPracticeFact[];
  bounds: ReadonlyMap<string, MasteryBounds>;
  windowStart: string;
  windowEnd: string;
}): NodeOutcomeView[] {
  const windowStartMs = new Date(params.windowStart).getTime();
  const windowEndMs = new Date(params.windowEnd).getTime();
  const windowDays = Math.max(0, Math.round((windowEndMs - windowStartMs) / 86_400_000));
  const nodeIds = [...new Set(
    params.facts
      .map((fact) => fact.knowledgeNodeId)
      .filter((id): id is string => id != null),
  )];

  const views: NodeOutcomeView[] = [];
  for (const knowledgeNodeId of nodeIds) {
    const bound = params.bounds.get(knowledgeNodeId);
    if (!bound || bound.after == null) continue;
    const outcome = buildOutcomeFromFacts({
      facts: params.facts,
      masteryBefore: bound.before,
      masteryAfter: bound.after,
      windowStart: params.windowStart,
      windowEnd: params.windowEnd,
      knowledgeNodeId,
    });
    const confidence = confidenceFor(outcome.attemptsInWindow, windowDays);
    const evidenceGate = checkEvidenceGate(
      outcome.attemptsInWindow,
      outcome.masteryGain,
      confidence,
      outcome.quality,
      { ...EVIDENCE_GATE, dataQualityOk: outcome.quality === 'ok' },
    );
    views.push({
      knowledgeNodeId: outcome.knowledgeNodeId,
      masteryBefore: outcome.masteryBefore,
      masteryAfter: outcome.masteryAfter,
      masteryGain: outcome.masteryGain,
      attemptsInWindow: outcome.attemptsInWindow,
      correctInWindow: outcome.correctInWindow,
      accuracyInWindow: outcome.accuracyInWindow,
      windowDays: outcome.windowDays,
      quality: outcome.quality,
      sampleSize: outcome.attemptsInWindow,
      confidence,
      evidenceGate,
    });
  }
  return views.sort((a, b) => b.attemptsInWindow - a.attemptsInWindow);
}

// ---- Profile inputs (classifyStudent feeding) ----

export interface StudentContextProfileFacts {
  overdueCount: number;
  studyStreak: number;
  openTaskCount: number;
  examDaysRemaining: number | null;
}

export interface ProfileInput {
  avgMastery: number;
  recentAccuracy: number;
  studyStreak: number;
  overdueCount: number;
  openTaskCount: number;
  examDaysRemaining: number;
}

export const EXAM_DAYS_UNKNOWN = 999;

/**
 * Map StudentContext facts + direct aggregates into classifyStudent input.
 * Missing exam date reads as "far"; the caller decides whether the student
 * has any learning data at all (no-data students never reach here).
 */
export function toProfileInput(
  facts: StudentContextProfileFacts,
  aggregates: { avgMastery: number | null; recentAccuracy: number | null },
): ProfileInput {
  return {
    avgMastery: aggregates.avgMastery ?? 0,
    recentAccuracy: aggregates.recentAccuracy ?? 0.5,
    studyStreak: facts.studyStreak,
    overdueCount: facts.overdueCount,
    openTaskCount: facts.openTaskCount,
    examDaysRemaining: facts.examDaysRemaining ?? EXAM_DAYS_UNKNOWN,
  };
}

export function classifyProfile(input: ProfileInput): { profile: StudentProfile; inputs: ProfileInput } {
  return { profile: classifyStudent(input), inputs: input };
}
