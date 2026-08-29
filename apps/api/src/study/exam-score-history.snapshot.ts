// ExamScoreHistorySnapshot is a read-only facts contract for exam score history.
// It deliberately does NOT model the legacy DTO or any presentation strategy.
// It only aggregates the facts needed by a later projection/query/adapter layer.
//
// Fact-source boundaries:
// - exams: completed paper session facts + practice result facts
// - asOf: read boundary for deterministic snapshots
//
// It must NOT contain:
// - accuracyRate / trend / trendLabel / latestAccuracyRate
// - recommendation / nextAction / reason
// - UI copy or DTO-specific formatting
// - database access / repository access / service access

export interface ExamScoreHistoryExamFact {
  sessionId: string;
  lastActiveAt: string;
  totalQuestions: number;
  correctCount: number;
  totalActiveMs: number;
}

export interface ExamScoreHistorySnapshot {
  source: 'exam_score_history_facts';
  userId: string;
  asOf: string;
  exams: ExamScoreHistoryExamFact[];
}

export interface BuildExamScoreHistorySnapshotInput {
  userId: string;
  asOf: Date | string;
  exams?: ExamScoreHistoryExamFact[];
}

export function buildExamScoreHistorySnapshot(input: BuildExamScoreHistorySnapshotInput): ExamScoreHistorySnapshot {
  return {
    source: 'exam_score_history_facts',
    userId: input.userId,
    asOf: toIso(input.asOf),
    exams: [...(input.exams ?? [])],
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
