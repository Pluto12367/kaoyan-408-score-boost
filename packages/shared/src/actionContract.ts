import type { RecommendationAction } from './score-center/types';

/**
 * The smallest target vocabulary currently needed by recommendation outputs.
 * Each target type owns a distinct ID value space; callers must not collapse
 * these into an untyped `id` field.
 */
export type RecommendationActionTargetType =
  | 'KNOWLEDGE_NODE'
  | 'KNOWLEDGE_POINT'
  | 'QUESTION'
  | 'STUDY_TASK';

export type RecommendationActionEvidenceRef = {
  kind: string;
  id: string;
  idType?: 'knowledgeNodeId' | 'knowledgePointId' | 'questionId' | 'assessmentId' | 'studyTaskId' | 'reviewAttemptId';
};

/**
 * An action instance is deliberately separate from its target identity.
 * This is a contract only: persistence and outcome attribution belong to
 * Phase 3.2.
 */
export type RecommendationActionIdentity = {
  actionId: string;
  actionType: RecommendationAction;
  targetType: RecommendationActionTargetType;
  targetId: string;
  reason: string;
  evidenceRefs: RecommendationActionEvidenceRef[];
  sourceRecommendationId?: string;
};

const ACTION_TYPES = new Set<RecommendationAction>([
  'LEARN',
  'REVIEW',
  'PRACTICE',
  'WRONG_QUESTION',
  'MOCK',
]);

const TARGET_TYPES = new Set<RecommendationActionTargetType>([
  'KNOWLEDGE_NODE',
  'KNOWLEDGE_POINT',
  'QUESTION',
  'STUDY_TASK',
]);

const EVIDENCE_ID_TYPES = new Set<NonNullable<RecommendationActionEvidenceRef['idType']>>([
  'knowledgeNodeId',
  'knowledgePointId',
  'questionId',
  'assessmentId',
  'studyTaskId',
  'reviewAttemptId',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isEvidenceRef(value: unknown): value is RecommendationActionEvidenceRef {
  if (!isRecord(value) || !isNonEmptyString(value.kind) || !isNonEmptyString(value.id)) return false;
  return value.idType === undefined || EVIDENCE_ID_TYPES.has(value.idType as NonNullable<RecommendationActionEvidenceRef['idType']>);
}

/** Runtime boundary for API/adapter input before it becomes canonical. */
export function isRecommendationActionIdentity(value: unknown): value is RecommendationActionIdentity {
  if (!isRecord(value)
    || !isNonEmptyString(value.actionId)
    || !ACTION_TYPES.has(value.actionType as RecommendationAction)
    || !TARGET_TYPES.has(value.targetType as RecommendationActionTargetType)
    || !isNonEmptyString(value.targetId)
    || value.actionId === value.targetId
    || !isNonEmptyString(value.reason)
    || !Array.isArray(value.evidenceRefs)
    || value.evidenceRefs.length === 0
    || !value.evidenceRefs.every(isEvidenceRef)) return false;

  return value.sourceRecommendationId === undefined || isNonEmptyString(value.sourceRecommendationId);
}

