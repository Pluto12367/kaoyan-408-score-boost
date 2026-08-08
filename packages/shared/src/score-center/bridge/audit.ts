import type {
  BridgeCandidate,
  BridgeDecision,
} from './matcher';

export interface LiveQuestionLike {
  id: string;
  knowledgePointIds: string[];
  directTagNodeIds?: string[];
}

export interface BridgeAuditSummary {
  knowledgePointTotal: number;
  activeKnowledgePoints: number;
  pendingKnowledgePoints: number;
  unmatchedKnowledgePoints: number;
  activeCoverage: number;
  liveQuestionTotal: number;
  resolvableQuestions: number;
  questionResolvableCoverage: number;
}

export interface BridgeAuditEntry {
  knowledgePointId: string;
  knowledgePointName: string;
  subject: string;
  chapter: string;
  section: string | null;
  decision: BridgeDecision;
  candidateNodes: BridgeCandidate[];
  selectedNodes: string[];
  reasons: string[];
  affectedQuestionCount: number;
}

export interface BridgeAuditReport {
  generatedAt: string;
  summary: BridgeAuditSummary;
  active: BridgeAuditEntry[];
  pendingReview: BridgeAuditEntry[];
  unmatched: BridgeAuditEntry[];
  conflicts: BridgeAuditEntry[];
  oneToMany: BridgeAuditEntry[];
  lowCandidates: Array<BridgeAuditEntry & { similarity: number }>;
}

/**
 * Resolvable coverage over questions. A question is resolvable when it has at
 * least one valid direct tag (active node) OR at least one active atomic node
 * supplied via `activeNodesByQuestion` (derived from ACTIVE bridge decisions).
 * `activeNodeIds` optionally restricts which node ids count as valid.
 */
export function computeResolvableCoverage(
  questions: readonly LiveQuestionLike[],
  activeNodesByQuestion?: ReadonlyMap<string, ReadonlySet<string>>,
  activeNodeIds?: ReadonlySet<string>,
): { total: number; resolvable: number; coverage: number } {
  const total = questions.length;
  let resolvable = 0;
  for (const question of questions) {
    const hasActiveTag = (question.directTagNodeIds ?? []).some(
      (nodeId) => !activeNodeIds || activeNodeIds.has(nodeId),
    );
    const hasActiveFallback = (activeNodesByQuestion?.get(question.id)?.size ?? 0) > 0;
    if (hasActiveTag || hasActiveFallback) {
      resolvable += 1;
    }
  }
  return { total, resolvable, coverage: total === 0 ? 0 : resolvable / total };
}

function byAffectedDesc(
  left: BridgeAuditEntry,
  right: BridgeAuditEntry,
): number {
  return (
    right.affectedQuestionCount - left.affectedQuestionCount
    || left.knowledgePointId.localeCompare(right.knowledgePointId)
  );
}

export function buildBridgeAudit(
  decisions: readonly BridgeDecision[],
  questions: readonly LiveQuestionLike[],
  options: { activeNodeIds?: ReadonlySet<string>; generatedAt?: string } = {},
): BridgeAuditReport {
  const activeNodeIds = options.activeNodeIds;
  const decisionByKnowledgePoint = new Map<string, BridgeDecision>();
  for (const decision of decisions) {
    if (!decisionByKnowledgePoint.has(decision.knowledgePointId)) {
      decisionByKnowledgePoint.set(decision.knowledgePointId, decision);
    }
  }

  const activeNodesByQuestion = new Map<string, Set<string>>();
  const questionIdsByKnowledgePoint = new Map<string, Set<string>>();
  for (const question of questions) {
    const resolvedNodes = new Set<string>();
    for (const knowledgePointId of question.knowledgePointIds) {
      const questionIds = questionIdsByKnowledgePoint.get(knowledgePointId) ?? new Set<string>();
      questionIds.add(question.id);
      questionIdsByKnowledgePoint.set(knowledgePointId, questionIds);

      const decision = decisionByKnowledgePoint.get(knowledgePointId);
      if (decision?.status === 'ACTIVE') {
        for (const nodeId of decision.selectedNodeIds) {
          if (!activeNodeIds || activeNodeIds.has(nodeId)) {
            resolvedNodes.add(nodeId);
          }
        }
      }
    }
    if (resolvedNodes.size > 0) {
      activeNodesByQuestion.set(question.id, resolvedNodes);
    }
  }

  const coverage = computeResolvableCoverage(questions, activeNodesByQuestion, activeNodeIds);
  const activeCount = decisions.filter((decision) => decision.status === 'ACTIVE').length;
  const pendingCount = decisions.filter((decision) => decision.status === 'PENDING_REVIEW').length;
  const unmatchedCount = decisions.filter(
    (decision) => decision.status == null || decision.confidence === null,
  ).length;

  const summary: BridgeAuditSummary = {
    knowledgePointTotal: decisions.length,
    activeKnowledgePoints: activeCount,
    pendingKnowledgePoints: pendingCount,
    unmatchedKnowledgePoints: unmatchedCount,
    activeCoverage: decisions.length === 0 ? 0 : activeCount / decisions.length,
    liveQuestionTotal: coverage.total,
    resolvableQuestions: coverage.resolvable,
    questionResolvableCoverage: coverage.coverage,
  };

  const entries: BridgeAuditEntry[] = decisions.map((decision) => ({
    knowledgePointId: decision.knowledgePointId,
    knowledgePointName: decision.knowledgePointName,
    subject: decision.subject,
    chapter: decision.chapter,
    section: decision.section,
    decision,
    candidateNodes: decision.candidateNodes,
    selectedNodes: decision.selectedNodeIds,
    reasons: decision.reasons,
    affectedQuestionCount: questionIdsByKnowledgePoint.get(decision.knowledgePointId)?.size ?? 0,
  }));

  const active = entries.filter((entry) => entry.decision.status === 'ACTIVE').sort(byAffectedDesc);
  const pendingReview = entries
    .filter((entry) => entry.decision.status === 'PENDING_REVIEW')
    .sort(byAffectedDesc);
  const unmatched = entries
    .filter((entry) => entry.decision.status == null || entry.decision.confidence === null)
    .sort(byAffectedDesc);
  const conflicts = entries
    .filter((entry) => entry.decision.reasons.includes('CONTEXT_CONFLICT'))
    .sort(byAffectedDesc);
  const oneToMany = entries
    .filter(
      (entry) =>
        entry.decision.selectedNodeIds.length > 1 || entry.decision.candidateNodes.length > 1,
    )
    .sort(byAffectedDesc);
  const lowCandidates = unmatched
    .map((entry) => ({
      ...entry,
      similarity: entry.candidateNodes.reduce((max, candidate) => Math.max(max, candidate.similarity), 0),
    }))
    .sort(byAffectedDesc);

  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    summary,
    active,
    pendingReview,
    unmatched,
    conflicts,
    oneToMany,
    lowCandidates,
  };
}
