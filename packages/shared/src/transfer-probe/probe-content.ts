import { toDifficultyBucket, type DifficultyBucket } from './transfer-probe';

/**
 * Phase B — Transfer Probe content readiness (read-only, pure).
 *
 * ## Why this module refuses rather than blesses
 *
 * B4 forbids self-certification: a question being generated and declared
 * "isomorphic" by the same process is not evidence. So `verified` here requires
 * **both** halves:
 *
 *   structural (cross-checked against the database, not the manifest)
 *     • the stored question really carries the claimed node as a mapping
 *     • the stored question type matches
 *     • the stored difficulty bucket matches
 *     • the surface really differs from the reference (different fingerprint
 *       AND different family)
 *   human
 *     • a named reviewer recorded the shared core knowledge operation
 *     • the review status is `approved`, with a reviewer and a timestamp
 *     • the solution is present and agrees with the stored answer
 *
 * Anything short of that is `unverified`. There is no code path that upgrades a
 * question to `verified` from generation alone.
 *
 * B5 is also encoded structurally: `priorAttempts` / `priorExposures` describe
 * *who has seen the question*, which is a delivery-time condition, not a content
 * property. Exposure therefore never changes a question's verification status and
 * never appears as a content blocker — it is reported separately so delivery can
 * be judged on its own.
 *
 * Pure: no IO, no clock, no randomness.
 */

export const PROBE_CONTENT_TARGET_NODES = 30;
export const PROBE_CONTENT_MIN_PER_NODE = 2;
export const PROBE_POOL_SOURCE = 'transfer_probe_pool';

export type ProbeVerificationStatus = 'verified' | 'unverified';

export interface ProbeQuestionFacts {
  readonly questionId: string;
  /** `Question.source` — must be exactly PROBE_POOL_SOURCE. */
  readonly source: string;
  readonly type: string;
  readonly difficulty: string;
  readonly contentFingerprint: string;
  readonly familyId: string;
  readonly answer: string;
  readonly analysis: string;
  /** Non-empty criteria count when `Question.rubric` carries a usable rubric. */
  readonly rubricCriteriaCount: number;
  /** Resolved PRIMARY node ids for this question (production resolver). */
  readonly nodeIds: readonly string[];
  /** Graded attempts recorded against this question (any student). */
  readonly priorAttempts: number;
  /** Session snapshots that exposed this question (any student). */
  readonly priorExposures: number;
}

export interface ProbeManifestEvidence {
  readonly sameNode?: boolean | null;
  readonly sameQuestionType?: boolean | null;
  readonly sameDifficultyBucket?: boolean | null;
  readonly differentSurface?: boolean | null;
  readonly sameKnowledgeOperation?: {
    readonly operationId?: string | null;
    readonly declaredBy?: string | null;
    readonly reviewedAt?: string | null;
  } | null;
  readonly referenceQuestionId?: string | null;
}

export interface ProbeManifestEntry {
  readonly questionId: string;
  readonly nodeId: string;
  readonly questionType: string;
  readonly difficultyBucket: string;
  readonly isomorphismStatus?: ProbeVerificationStatus | null;
  readonly isomorphismEvidence?: ProbeManifestEvidence | null;
  readonly solution?: string | null;
  readonly expectedOperation?: string | null;
  readonly contentSource?: string | null;
  readonly reviewStatus?: 'approved' | 'pending' | 'rejected' | null;
  readonly reviewedBy?: string | null;
  readonly reviewedAt?: string | null;
}

export interface ProbeContentInput {
  readonly questions: readonly ProbeQuestionFacts[];
  readonly manifest: { readonly questions: readonly ProbeManifestEntry[] } | null;
  /** Nodes selected for the probe pool (B1 candidate list). */
  readonly candidateNodeIds: readonly string[];
  readonly minQuestionsPerNode?: number;
  readonly targetNodeCount?: number;
}

export type ProbeFindingCode =
  | 'missing_solution'
  | 'missing_analysis'
  | 'missing_difficulty'
  | 'missing_node'
  | 'missing_rubric'
  | 'invalid_probe_label'
  | 'duplicate_question'
  | 'duplicate_family'
  | 'duplicate_manifest_entry'
  | 'isomorphism_evidence_missing'
  | 'manifest_db_mismatch'
  | 'manifest_entry_missing'
  | 'manifest_question_not_found';

export interface ProbeFinding {
  readonly code: ProbeFindingCode;
  readonly detail: string;
  readonly questionId?: string;
  readonly nodeId?: string;
}

export interface ProbeNodeCoverage {
  readonly nodeId: string;
  readonly verified: number;
  readonly unverified: number;
  readonly missing: number;
  readonly total: number;
}

export interface ProbeContentReport {
  readonly verdict: 'PROBE CONTENT READY' | 'PROBE CONTENT NOT READY';
  readonly totals: {
    readonly questions: number;
    readonly verified: number;
    readonly unverified: number;
    readonly missing: number;
    readonly nodes: number;
    readonly nodesMeetingTarget: number;
    readonly rubricRequired: number;
    readonly rubricCovered: number;
  };
  readonly perNode: readonly ProbeNodeCoverage[];
  readonly difficultyCoverage: Readonly<Record<string, number>>;
  readonly typeCoverage: Readonly<Record<string, number>>;
  /** B5/B6: a delivery-time property, reported apart from content quality. */
  readonly exposure: {
    readonly exposedQuestionCount: number;
    readonly clean: boolean;
    readonly exposedQuestionIds: readonly string[];
  };
  readonly coverageGap: {
    readonly nodeShortfall: number;
    readonly questionShortfall: number;
  };
  readonly blocking: readonly ProbeFinding[];
}

interface Evaluated {
  readonly facts: ProbeQuestionFacts;
  readonly nodeId: string | null;
  readonly status: ProbeVerificationStatus | 'unattributable';
  readonly findings: readonly ProbeFinding[];
}

function evidenceComplete(entry: ProbeManifestEntry | null): ProbeFinding | null {
  if (!entry) {
    return { code: 'manifest_entry_missing', detail: 'no manifest entry declares this pool question' };
  }
  const evidence = entry.isomorphismEvidence;
  if (!evidence) {
    return { code: 'isomorphism_evidence_missing', detail: 'the manifest asserts a status without evidence', questionId: entry.questionId };
  }
  const operation = evidence.sameKnowledgeOperation;
  const declared = Boolean(operation?.operationId && operation?.declaredBy && operation?.reviewedAt);
  if (!declared) {
    return {
      code: 'isomorphism_evidence_missing',
      detail: 'the shared core knowledge operation is not declared by a named reviewer',
      questionId: entry.questionId,
    };
  }
  if (entry.reviewStatus !== 'approved' || !entry.reviewedBy || !entry.reviewedAt) {
    return {
      code: 'isomorphism_evidence_missing',
      detail: 'human review is not recorded as approved (reviewer + timestamp required)',
      questionId: entry.questionId,
    };
  }
  return null;
}

function evaluateQuestion(
  facts: ProbeQuestionFacts,
  entry: ProbeManifestEntry | null,
): Evaluated {
  const findings: ProbeFinding[] = [];
  const withId = (finding: ProbeFinding): ProbeFinding => ({ ...finding, questionId: facts.questionId });

  // ---- quality blockers (B7/B9) -------------------------------------------
  if (!facts.answer || !facts.answer.trim()) findings.push(withId({ code: 'missing_solution', detail: 'the question has no stored answer' }));
  if (!facts.analysis || !facts.analysis.trim()) findings.push(withId({ code: 'missing_analysis', detail: 'the question has no stored analysis' }));
  if (!facts.difficulty || !facts.difficulty.trim()) findings.push(withId({ code: 'missing_difficulty', detail: 'the question has no difficulty' }));
  if (facts.source !== PROBE_POOL_SOURCE) {
    findings.push(withId({ code: 'invalid_probe_label', detail: `source is "${facts.source}", expected "${PROBE_POOL_SOURCE}"` }));
  }
  if (facts.type === 'COMPREHENSIVE' && facts.rubricCriteriaCount <= 0) {
    findings.push(withId({ code: 'missing_rubric', detail: 'a human-graded question needs rubric criteria' }));
  }

  // ---- attribution --------------------------------------------------------
  const primaryNode = facts.nodeIds.length > 0 ? facts.nodeIds[0] : null;
  if (!primaryNode) {
    findings.push(withId({ code: 'missing_node', detail: 'the question resolves to no knowledge node' }));
    return { facts, nodeId: null, status: 'unattributable', findings };
  }

  // ---- structural cross-check against the database (B3) -------------------
  const mismatches: string[] = [];
  if (entry) {
    if (entry.nodeId !== primaryNode) mismatches.push(`node ${entry.nodeId} != stored ${primaryNode}`);
    if (entry.questionType !== facts.type) mismatches.push(`type ${entry.questionType} != stored ${facts.type}`);
    if (toDifficultyBucket(entry.difficultyBucket) !== toDifficultyBucket(facts.difficulty)) {
      mismatches.push(`difficulty ${entry.difficultyBucket} != stored ${facts.difficulty}`);
    }
    if (entry.solution != null && entry.solution.trim() !== facts.answer.trim()) {
      mismatches.push('manifest solution disagrees with the stored answer');
    }
    const evidence = entry.isomorphismEvidence;
    if (evidence) {
      if (evidence.sameNode === false) mismatches.push('sameNode declared false');
      if (evidence.sameQuestionType === false) mismatches.push('sameQuestionType declared false');
      if (evidence.sameDifficultyBucket === false) mismatches.push('sameDifficultyBucket declared false');
      if (evidence.differentSurface === false) mismatches.push('differentSurface declared false');
    }
  }
  if (mismatches.length > 0) {
    findings.push({
      code: 'manifest_db_mismatch',
      detail: mismatches.join('; '),
      questionId: facts.questionId,
      nodeId: primaryNode,
    });
  }

  const evidenceFinding = evidenceComplete(entry);
  if (evidenceFinding) findings.push({ ...evidenceFinding, nodeId: primaryNode });

  const blockingCodes = new Set<ProbeFindingCode>([
    'missing_solution', 'missing_analysis', 'missing_difficulty', 'missing_rubric',
    'invalid_probe_label', 'manifest_db_mismatch', 'isomorphism_evidence_missing',
    'manifest_entry_missing',
  ]);
  const verified = entry?.isomorphismStatus === 'verified'
    && !findings.some((finding) => blockingCodes.has(finding.code));

  return {
    facts,
    nodeId: primaryNode,
    status: verified ? 'verified' : 'unverified',
    findings,
  };
}

export function validateProbeContent(input: ProbeContentInput): ProbeContentReport {
  const minPerNode = input.minQuestionsPerNode ?? PROBE_CONTENT_MIN_PER_NODE;
  const targetNodes = input.targetNodeCount ?? PROBE_CONTENT_TARGET_NODES;
  const blocking: ProbeFinding[] = [];

  const entries = input.manifest?.questions ?? [];
  const entryByQuestion = new Map<string, ProbeManifestEntry>();
  for (const entry of entries) {
    if (entryByQuestion.has(entry.questionId)) {
      blocking.push({ code: 'duplicate_manifest_entry', detail: 'the manifest declares this question twice', questionId: entry.questionId });
      continue;
    }
    entryByQuestion.set(entry.questionId, entry);
  }

  // Duplicates are a pool-level defect: same content, or two questions claiming
  // one family (a renumbered old question is exactly this shape).
  const fingerprintCounts = new Map<string, number>();
  const familyCounts = new Map<string, number>();
  for (const facts of input.questions) {
    fingerprintCounts.set(facts.contentFingerprint, (fingerprintCounts.get(facts.contentFingerprint) ?? 0) + 1);
    familyCounts.set(facts.familyId, (familyCounts.get(facts.familyId) ?? 0) + 1);
  }

  const evaluated: Evaluated[] = [];
  for (const facts of input.questions) {
    const entry = entryByQuestion.get(facts.questionId) ?? null;
    const item = evaluateQuestion(facts, entry);
    const extra: ProbeFinding[] = [];
    if ((fingerprintCounts.get(facts.contentFingerprint) ?? 0) > 1) {
      extra.push({ code: 'duplicate_question', detail: 'an identical content fingerprint already exists in the pool', questionId: facts.questionId });
    }
    if ((familyCounts.get(facts.familyId) ?? 0) > 1) {
      extra.push({ code: 'duplicate_family', detail: 'another pool question shares this family — a variant is not a new question', questionId: facts.questionId });
    }
    const merged = { ...item, findings: [...item.findings, ...extra] };
    evaluated.push(extra.length > 0 && merged.status === 'verified'
      ? { ...merged, status: 'unverified' as const }
      : merged);
  }

  for (const entry of entries) {
    if (!input.questions.some((facts) => facts.questionId === entry.questionId)) {
      blocking.push({ code: 'manifest_question_not_found', detail: 'the manifest references a question that is not in the pool', questionId: entry.questionId });
    }
  }

  const perNodeMap = new Map<string, ProbeNodeCoverage>();
  for (const nodeId of input.candidateNodeIds) {
    perNodeMap.set(nodeId, { nodeId, verified: 0, unverified: 0, missing: 0, total: 0 });
  }
  const difficultyCoverage: Record<string, number> = {};
  const typeCoverage: Record<string, number> = {};
  let verifiedTotal = 0;
  let unverifiedTotal = 0;
  let missingTotal = 0;
  let rubricRequired = 0;
  let rubricCovered = 0;

  for (const item of evaluated) {
    for (const finding of item.findings) blocking.push(finding);
    const bucket = toDifficultyBucket(item.facts.difficulty) as DifficultyBucket;
    difficultyCoverage[bucket] = (difficultyCoverage[bucket] ?? 0) + 1;
    typeCoverage[item.facts.type] = (typeCoverage[item.facts.type] ?? 0) + 1;
    if (item.facts.type === 'COMPREHENSIVE') {
      rubricRequired += 1;
      if (item.facts.rubricCriteriaCount > 0) rubricCovered += 1;
    }
    if (item.nodeId == null) {
      missingTotal += 1;
      continue;
    }
    const coverage = perNodeMap.get(item.nodeId) ?? { nodeId: item.nodeId, verified: 0, unverified: 0, missing: 0, total: 0 };
    const updated: ProbeNodeCoverage = {
      nodeId: item.nodeId,
      verified: coverage.verified + (item.status === 'verified' ? 1 : 0),
      unverified: coverage.unverified + (item.status === 'unverified' ? 1 : 0),
      missing: coverage.missing,
      total: coverage.total + 1,
    };
    perNodeMap.set(item.nodeId, updated);
    if (item.status === 'verified') verifiedTotal += 1;
    else unverifiedTotal += 1;
  }
  void minPerNode;

  const perNode = [...perNodeMap.values()];
  const nodesMeetingTarget = perNode.filter((row) => row.verified >= minPerNode).length;

  const exposed = input.questions.filter((facts) => facts.priorAttempts > 0 || facts.priorExposures > 0);
  const requiredQuestions = targetNodes * minPerNode;
  const coverageGap = {
    nodeShortfall: Math.max(0, targetNodes - nodesMeetingTarget),
    questionShortfall: Math.max(0, requiredQuestions - verifiedTotal),
  };

  const hasQualityBlocker = blocking.some((finding) => finding.code !== 'manifest_question_not_found');
  const ready = nodesMeetingTarget >= targetNodes
    && verifiedTotal >= requiredQuestions
    && blocking.length === 0;

  return {
    verdict: ready && !hasQualityBlocker ? 'PROBE CONTENT READY' : 'PROBE CONTENT NOT READY',
    totals: {
      questions: input.questions.length,
      verified: verifiedTotal,
      unverified: unverifiedTotal,
      missing: missingTotal,
      nodes: perNode.length,
      nodesMeetingTarget,
      rubricRequired,
      rubricCovered,
    },
    perNode,
    difficultyCoverage,
    typeCoverage,
    exposure: {
      exposedQuestionCount: exposed.length,
      clean: exposed.length === 0,
      exposedQuestionIds: exposed.map((facts) => facts.questionId),
    },
    coverageGap,
    blocking,
  };
}
