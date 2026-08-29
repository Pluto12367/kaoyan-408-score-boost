// OverviewReportSelector is a pure selection strategy over OverviewReportSnapshot facts.
// It does NOT query the database, access repositories, generate DTOs or UI copy, or
// mutate the snapshot. It only turns facts into a deterministic selection result.
//
// ID-space discipline (two knowledge ID spaces coexist in this codebase):
// - weakPointSelection / speedRiskSelection operate in the legacy knowledgePointId space
//   (practice records and catalog facts).
// - masteryWeakCandidates operate in the knowledgeNodeId space (UserKnowledgeMastery).
// The two lists are kept separate and every candidate carries an explicit idType so
// downstream adapters can never mix the spaces.
import type {
  OverviewMasteryFacts,
  OverviewPracticeFact,
  OverviewReportSnapshot,
} from './overview-report.snapshot';

export const DEFAULT_OVERVIEW_WEAK_POINT_LIMIT = 5;
const MIN_WEAK_POINT_LIMIT = 1;
const MAX_WEAK_POINT_LIMIT = 10;
// Mirrors legacy isSlowAnswer() in packages/shared learning.ts.
const SLOW_ANSWER_FACTOR = 1.45;
// Mirrors legacy importance/frequency defaults used by computeMasteryReport() for
// records whose knowledge point is missing from the catalog.
const DEFAULT_IMPORTANCE = 3;
const DEFAULT_FREQUENCY = 3;

export interface OverviewReportSelectorOptions {
  // weakPointLimit caps weakPointSelection candidates (clamped 1..10), mirroring legacy top-5.
  weakPointLimit?: number;
}

export interface OverviewWeakPointCandidate {
  idType: 'knowledgePointId';
  knowledgePointId: string;
  rank: number;
  weaknessScore: number;
  wrongCount: number;
  attempts: number;
  accuracyRate: number;
  slowCount: number;
  topReason: string | null;
  evidenceRecordIds: string[];
}

export interface OverviewSpeedRiskCandidate {
  idType: 'knowledgePointId';
  knowledgePointId: string;
  rank: number;
  slowCount: number;
  attempts: number;
  evidenceRecordIds: string[];
}

export interface OverviewMasteryWeakCandidate {
  idType: 'knowledgeNodeId';
  knowledgeNodeId: string;
  rank: number;
  weaknessScore: number;
  masteryRate: number;
  attempts: number;
  wrongCount: number;
}

export interface OverviewMistakePatternEntry {
  reason: string;
  count: number;
  share: number;
}

export interface OverviewMistakePatternSummary {
  totalRecordCount: number;
  totalWrongCount: number;
  reasons: OverviewMistakePatternEntry[];
}

export interface OverviewSelectionMeta {
  algorithmVersion: 'overview-selector-v1';
  masterySource: OverviewMasteryFacts['source'];
  weakPointLimit: number;
  practiceRecordCount: number;
}

export interface OverviewReportSelection {
  userId: string;
  asOf: string;
  weakPointSelection: {
    source: 'practice_facts';
    idType: 'knowledgePointId';
    candidates: OverviewWeakPointCandidate[];
  };
  speedRiskSelection: {
    source: 'practice_facts';
    idType: 'knowledgePointId';
    candidates: OverviewSpeedRiskCandidate[];
  };
  masteryWeakCandidates: OverviewMasteryWeakCandidate[];
  mistakePatternSummary: OverviewMistakePatternSummary;
  meta: OverviewSelectionMeta;
}

interface PointAggregate {
  knowledgePointId: string;
  records: OverviewPracticeFact[];
  wrongCount: number;
  slowCount: number;
}

export class OverviewReportSelector {
  select(snapshot: OverviewReportSnapshot, options: OverviewReportSelectorOptions = {}): OverviewReportSelection {
    const weakPointLimit = clamp(options.weakPointLimit ?? DEFAULT_OVERVIEW_WEAK_POINT_LIMIT);
    const records = snapshot.practiceFacts.records;
    const aggregates = aggregateByKnowledgePoint(records);
    const catalogById = new Map(snapshot.knowledgePointFacts.map((point) => [point.id, point]));

    const weakCandidates = aggregates
      .filter((aggregate) => aggregate.wrongCount > 0)
      .map((aggregate) => toWeakCandidate(aggregate, catalogById))
      // Legacy ordering: weaknessScore descending, stable tie-break on knowledgePointId.
      .sort((left, right) => right.weaknessScore - left.weaknessScore || left.knowledgePointId.localeCompare(right.knowledgePointId))
      .slice(0, weakPointLimit)
      .map((candidate, index) => ({ ...candidate, rank: index + 1 }));

    const speedCandidates = aggregates
      // Legacy speed risks only include points that were never answered wrong.
      .filter((aggregate) => aggregate.wrongCount === 0 && aggregate.slowCount > 0)
      .map((aggregate) => ({
        idType: 'knowledgePointId' as const,
        knowledgePointId: aggregate.knowledgePointId,
        rank: 0,
        slowCount: aggregate.slowCount,
        attempts: aggregate.records.length,
        evidenceRecordIds: aggregate.records.filter(isSlow).map((record) => record.id),
      }))
      .sort((left, right) => right.slowCount - left.slowCount || left.knowledgePointId.localeCompare(right.knowledgePointId))
      .map((candidate, index) => ({ ...candidate, rank: index + 1 }));

    const masteryWeakCandidates = snapshot.masteryFacts.nodes
      .filter((node) => node.status === 'weak')
      .map((node) => ({
        idType: 'knowledgeNodeId' as const,
        knowledgeNodeId: node.knowledgeNodeId,
        rank: 0,
        weaknessScore: Math.round(Math.max(0, 100 - node.masteryRate)),
        masteryRate: node.masteryRate,
        attempts: node.attempts,
        wrongCount: node.wrongCount,
      }))
      .sort((left, right) => right.weaknessScore - left.weaknessScore || left.knowledgeNodeId.localeCompare(right.knowledgeNodeId))
      .map((candidate, index) => ({ ...candidate, rank: index + 1 }));

    const wrongRecords = records.filter((record) => !record.correct);
    const reasonCounts = new Map<string, number>();
    for (const record of records) {
      if (!record.mistakeReason) continue;
      reasonCounts.set(record.mistakeReason, (reasonCounts.get(record.mistakeReason) ?? 0) + 1);
    }
    const reasons: OverviewMistakePatternEntry[] = [...reasonCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([reason, count]) => ({
        reason,
        count,
        share: records.length ? round1((count / records.length) * 100) : 0,
      }));

    return {
      userId: snapshot.userId,
      asOf: snapshot.asOf,
      weakPointSelection: {
        source: 'practice_facts',
        idType: 'knowledgePointId',
        candidates: weakCandidates,
      },
      speedRiskSelection: {
        source: 'practice_facts',
        idType: 'knowledgePointId',
        candidates: speedCandidates,
      },
      masteryWeakCandidates,
      mistakePatternSummary: {
        totalRecordCount: records.length,
        totalWrongCount: wrongRecords.length,
        reasons,
      },
      meta: {
        algorithmVersion: 'overview-selector-v1',
        masterySource: snapshot.masteryFacts.source,
        weakPointLimit,
        practiceRecordCount: records.length,
      },
    };
  }
}

function aggregateByKnowledgePoint(records: OverviewPracticeFact[]): PointAggregate[] {
  const grouped = new Map<string, OverviewPracticeFact[]>();
  for (const record of records) {
    const bucket = grouped.get(record.knowledgePointId) ?? [];
    bucket.push(record);
    grouped.set(record.knowledgePointId, bucket);
  }
  return [...grouped.entries()].map(([knowledgePointId, bucket]) => ({
    knowledgePointId,
    records: bucket,
    wrongCount: bucket.filter((record) => !record.correct).length,
    slowCount: bucket.filter(isSlow).length,
  }));
}

function toWeakCandidate(
  aggregate: PointAggregate,
  catalogById: Map<string, { importance: number; frequency: number }>,
): OverviewWeakPointCandidate {
  const catalog = catalogById.get(aggregate.knowledgePointId);
  const importance = catalog?.importance ?? DEFAULT_IMPORTANCE;
  const frequency = catalog?.frequency ?? DEFAULT_FREQUENCY;
  const attempts = aggregate.records.length;
  const correctCount = attempts - aggregate.wrongCount;
  // Legacy weaknessScore from computeMasteryReport(): wrongRate*100 + importance*8 + frequency*6.
  const wrongRate = attempts ? aggregate.wrongCount / attempts : 1;
  const weaknessScore = wrongRate * 100 + importance * 8 + frequency * 6;

  const wrongReasonCounts = new Map<string, number>();
  for (const record of aggregate.records) {
    if (record.correct || !record.mistakeReason) continue;
    wrongReasonCounts.set(record.mistakeReason, (wrongReasonCounts.get(record.mistakeReason) ?? 0) + 1);
  }
  const topReason = [...wrongReasonCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? null;

  return {
    idType: 'knowledgePointId',
    knowledgePointId: aggregate.knowledgePointId,
    rank: 0,
    weaknessScore,
    wrongCount: aggregate.wrongCount,
    attempts,
    accuracyRate: attempts ? round1((correctCount / attempts) * 100) : 0,
    slowCount: aggregate.slowCount,
    topReason,
    evidenceRecordIds: aggregate.records.filter((record) => !record.correct).map((record) => record.id),
  };
}

function isSlow(record: OverviewPracticeFact): boolean {
  return record.timeSpentSec > record.expectedTimeSec * SLOW_ANSWER_FACTOR;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number): number {
  return Math.max(MIN_WEAK_POINT_LIMIT, Math.min(MAX_WEAK_POINT_LIMIT, Math.round(value)));
}
