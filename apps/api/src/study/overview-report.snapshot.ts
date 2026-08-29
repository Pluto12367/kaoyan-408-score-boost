// OverviewReportSnapshot is a read-only facts contract for the overview report.
// It deliberately does NOT model the legacy DTO or any presentation strategy.
// It only aggregates the facts needed by later selector/adapter layers.
//
// Fact-source boundaries:
// - goalFacts: student goal facts (target/current/stage/days)
// - practiceFacts: practice record facts used for weakness analysis
// - knowledgePointFacts: catalog facts used for display and grouping
// - masteryFacts: mastery summary + node facts used for weakness analysis
//
// It must NOT contain:
// - nextAction / reason
// - UI copy or DTO-specific formatting
// - selector results such as weakPoints or speedRisks
// - database access / repository access / service access

export interface OverviewGoalFacts {
  targetScore: number | null;
  currentScore: number | null;
  remainingDays: number | null;
  studyStage: string | null;
  weakestSubject: string | null;
}

export interface OverviewPracticeFact {
  id: string;
  questionId: string;
  knowledgePointId: string;
  submittedAt: string;
  correct: boolean;
  timeSpentSec: number;
  expectedTimeSec: number;
  mistakeReason: string | null;
}

export interface OverviewPracticeFacts {
  totalCount: number;
  correctCount: number;
  accuracyRate: number;
  averageTimeSpentSec: number;
  records: OverviewPracticeFact[];
}

export interface OverviewKnowledgePointFact {
  id: string;
  subject: string;
  chapter: string;
  title: string;
  importance: number;
  frequency: number;
  prerequisites: string[];
}

export interface OverviewMasteryNodeFact {
  knowledgeNodeId: string;
  masteryRate: number;
  attempts: number;
  correctCount: number;
  wrongCount: number;
  status: 'untouched' | 'weak' | 'review' | 'mastered';
  updatedAt: string | null;
}

export interface OverviewMasteryFacts {
  source: 'user_knowledge_mastery' | 'empty' | 'node_mastery';
  nodeCount: number;
  practicedNodeCount: number;
  averageMastery: number;
  weakCount: number;
  reviewCount: number;
  masteredCount: number;
  lastUpdatedAt: string | null;
  nodes: OverviewMasteryNodeFact[];
}

export interface OverviewReportSnapshot {
  source: 'overview_report_facts';
  userId: string;
  asOf: string;
  goalFacts: OverviewGoalFacts;
  practiceFacts: OverviewPracticeFacts;
  knowledgePointFacts: OverviewKnowledgePointFact[];
  masteryFacts: OverviewMasteryFacts;
}

export interface BuildOverviewReportSnapshotInput {
  userId: string;
  asOf: Date | string;
  goalFacts?: OverviewGoalFacts;
  practiceFacts?: OverviewPracticeFacts;
  knowledgePointFacts?: OverviewKnowledgePointFact[];
  masteryFacts?: OverviewMasteryFacts;
}

export function buildOverviewReportSnapshot(input: BuildOverviewReportSnapshotInput): OverviewReportSnapshot {
  return {
    source: 'overview_report_facts',
    userId: input.userId,
    asOf: toIso(input.asOf),
    goalFacts: input.goalFacts ?? emptyGoalFacts(),
    practiceFacts: input.practiceFacts ?? emptyPracticeFacts(),
    knowledgePointFacts: input.knowledgePointFacts ?? [],
    masteryFacts: input.masteryFacts ?? emptyMasteryFacts(),
  };
}

function emptyGoalFacts(): OverviewGoalFacts {
  return {
    targetScore: null,
    currentScore: null,
    remainingDays: null,
    studyStage: null,
    weakestSubject: null,
  };
}

function emptyPracticeFacts(): OverviewPracticeFacts {
  return {
    totalCount: 0,
    correctCount: 0,
    accuracyRate: 0,
    averageTimeSpentSec: 0,
    records: [],
  };
}

function emptyMasteryFacts(): OverviewMasteryFacts {
  return {
    source: 'empty',
    nodeCount: 0,
    practicedNodeCount: 0,
    averageMastery: 0,
    weakCount: 0,
    reviewCount: 0,
    masteredCount: 0,
    lastUpdatedAt: null,
    nodes: [],
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
