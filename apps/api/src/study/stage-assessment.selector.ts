// StageAssessmentSelector is a pure selection strategy over StageAssessmentSnapshot facts.
// It does NOT query the database, access repositories, generate DTOs or UI copy, or
// mutate the snapshot. It only turns facts into a deterministic selection result.
import type {
  StageAssessmentKnowledgePointFact,
  StageAssessmentQuestionFact,
  StageAssessmentSnapshot,
} from './stage-assessment.snapshot';

export const DEFAULT_STAGE_ASSESSMENT_QUESTION_LIMIT = 6;
const MIN_QUESTION_LIMIT = 2;
const MAX_QUESTION_LIMIT = 20;

export interface StageAssessmentSelectorOptions {
  // questionLimit mirrors legacy systemConfig stageAssessmentQuestionLimit (clamped 2..20)
  questionLimit?: number;
}

export interface StageAssessmentSelection {
  userId: string;
  asOf: string;
  // knowledge points driving the selection (weakest first per snapshot facts order)
  focusKnowledgePointIds: string[];
  selectedQuestionIds: string[];
  selectedQuestions: StageAssessmentQuestionFact[];
  // knowledge point facts of the selected questions (selection-derived, not UI copy)
  focusKnowledgePoints: StageAssessmentKnowledgePointFact[];
  fallbackUsed: boolean;
  questionLimit: number;
  totalPoolSize: number;
}

export class StageAssessmentSelector {
  select(snapshot: StageAssessmentSnapshot, options: StageAssessmentSelectorOptions = {}): StageAssessmentSelection {
    const questionLimit = clamp(options.questionLimit ?? DEFAULT_STAGE_ASSESSMENT_QUESTION_LIMIT);
    const pool = snapshot.questionPoolFacts.questions;
    const weakPoints = snapshot.masteryFacts.weakPoints;

    // Priority facts: weak knowledge nodes (already weakest-first from projection facts).
    const focusIds = new Set(weakPoints.map((point) => point.knowledgeNodeId));
    const rankById = new Map(weakPoints.map((point, index) => [point.knowledgeNodeId, index]));

    const focusQuestions = pool.filter((question) =>
      question.knowledgePointIds.some((id) => focusIds.has(id)),
    );
    const fallbackQuestions = pool.filter((question) => !focusQuestions.includes(question));

    // Weak-point-first priority ordering (stable within same rank), then fallback pool order.
    const orderedFocus = [...focusQuestions].sort((left, right) =>
      minRank(left, rankById) - minRank(right, rankById) || pool.indexOf(left) - pool.indexOf(right),
    );
    const selected = [...orderedFocus, ...fallbackQuestions].slice(0, Math.min(questionLimit, pool.length));

    const selectedKpIds = [...new Set(selected.flatMap((question) => question.knowledgePointIds))];
    const knowledgePointsById = new Map(snapshot.questionPoolFacts.knowledgePoints.map((point) => [point.id, point]));
    const focusKnowledgePoints = selectedKpIds
      .map((id) => knowledgePointsById.get(id))
      .filter((point): point is StageAssessmentKnowledgePointFact => Boolean(point));

    return {
      userId: snapshot.userId,
      asOf: snapshot.asOf,
      focusKnowledgePointIds: [...focusIds],
      selectedQuestionIds: selected.map((question) => question.id),
      selectedQuestions: selected,
      focusKnowledgePoints,
      fallbackUsed: selected.some((question) => !focusQuestions.includes(question)),
      questionLimit,
      totalPoolSize: pool.length,
    };
  }
}

function minRank(question: StageAssessmentQuestionFact, rankById: Map<string, number>): number {
  const ranks = question.knowledgePointIds
    .map((id) => rankById.get(id))
    .filter((rank): rank is number => rank !== undefined);
  return ranks.length ? Math.min(...ranks) : Number.MAX_SAFE_INTEGER;
}

function clamp(value: number): number {
  return Math.max(MIN_QUESTION_LIMIT, Math.min(MAX_QUESTION_LIMIT, Math.round(value)));
}
