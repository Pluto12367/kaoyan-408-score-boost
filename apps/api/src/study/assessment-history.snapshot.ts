// AssessmentHistorySnapshot is a read-only fact projection for assessment history.
// It deliberately does NOT model the legacy DTO or any presentation strategy.
// It only aggregates facts needed by a later adapter/query layer.
//
// Fact-source boundaries:
// - items: persisted assessment history rows / assessment history facts
// - summaryFacts: derived from ordered items
// - latestSubmittedAt: derived from items
//
// It must NOT contain:
// - recommendation / nextAction / reason
// - UI copy or DTO-specific formatting
// - database access / repository access

export interface AssessmentHistoryItemSnapshot {
  id: string;
  sessionId?: string | null;
  paperId?: string | null;
  title: string;
  submittedAt: string;
  score: number;
  totalScore: number;
  accuracyRate: number;
  elapsedSec: number;
  unansweredCount: number;
  weakPointTitle: string;
  reviewSuggestion: string;
}

export interface AssessmentHistorySummarySnapshot {
  attemptCount: number;
  bestScore: number;
  latestAccuracyRate: number;
  improvementText: string;
}

export interface AssessmentHistorySnapshot {
  source: 'assessment_history_facts';
  userId: string;
  asOf: string;
  items: AssessmentHistoryItemSnapshot[];
  summaryFacts: AssessmentHistorySummarySnapshot;
  latestSubmittedAt: string | null;
}

export interface BuildAssessmentHistorySnapshotInput {
  userId: string;
  asOf: Date | string;
  items?: AssessmentHistoryItemSnapshot[];
  summaryFacts?: AssessmentHistorySummarySnapshot;
  latestSubmittedAt?: string | null;
}

export function buildAssessmentHistorySnapshot(input: BuildAssessmentHistorySnapshotInput): AssessmentHistorySnapshot {
  const items = [...(input.items ?? [])].sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
  return {
    source: 'assessment_history_facts',
    userId: input.userId,
    asOf: toIso(input.asOf),
    items,
    summaryFacts: input.summaryFacts ?? emptySummaryFacts(items),
    latestSubmittedAt: input.latestSubmittedAt ?? items[0]?.submittedAt ?? null,
  };
}

function emptySummaryFacts(items: AssessmentHistoryItemSnapshot[]): AssessmentHistorySummarySnapshot {
  return {
    attemptCount: items.length,
    bestScore: items.length ? Math.max(...items.map((item) => item.score)) : 0,
    latestAccuracyRate: items[0]?.accuracyRate ?? 0,
    improvementText: !items.length
      ? '还没有测评记录，先完成一套模拟卷建立基线。'
      : !items[1]
        ? '已建立第一次测评基线，下一次可重点观察正确率和用时变化。'
        : items[0].score > items[1].score
          ? `较上次提升 ${items[0].score - items[1].score} 分，继续巩固本次薄弱点。`
          : items[0].score === items[1].score
            ? '与上次持平，建议通过限时训练和错题复盘提高稳定性。'
            : `较上次下降 ${items[1].score - items[0].score} 分，先复盘本次错题再进入新题训练。`,
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
