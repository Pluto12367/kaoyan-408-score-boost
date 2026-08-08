export type BridgeConfidence = 'HIGH' | 'MEDIUM';
export type BridgeSource = 'AUTO' | 'MANUAL';
export type BridgeMatchMethod = 'EXACT_NAME' | 'NORMALIZED_NAME' | 'CONTEXT_MATCH' | 'MANUAL';
export type BridgeStatus = 'ACTIVE' | 'PENDING_REVIEW' | 'REJECTED' | 'INACTIVE';

export interface BridgeKnowledgePoint {
  id: string;
  subject: string;
  chapter: string;
  title: string;
}

export interface BridgeKnowledgeNode {
  id: string;
  subject: string;
  nodeType: string;
  name: string;
  chapterName: string | null;
  sectionName: string | null;
}

export interface BridgeAlias {
  subject: string;
  from: string;
  to: string;
  note?: string;
}

export interface BridgeCandidate {
  knowledgeNodeId: string;
  similarity: number;
}

export interface BridgeDecision {
  knowledgePointId: string;
  knowledgePointName: string;
  subject: string;
  chapter: string;
  section: string | null;
  candidateNodes: BridgeCandidate[];
  selectedNodeIds: string[];
  confidence: BridgeConfidence | null;
  matchMethod: BridgeMatchMethod | null;
  status: BridgeStatus | null;
  reasons: string[];
}

type ContextStatus = 'MATCH' | 'NEUTRAL' | 'CONFLICT';

function fullWidthToHalf(char: string): string {
  const code = char.charCodeAt(0);
  if (code >= 0xff01 && code <= 0xff5e) {
    return String.fromCharCode(code - 0xfee0);
  }
  if (code === 0x3000) {
    return ' ';
  }
  return char;
}

/**
 * Deterministic textual normalization only. No synonym or semantic replacement.
 * Handles: trim, case fold, full-width -> half-width, whitespace collapse,
 * CJK punctuation, bracket forms, and common connector characters.
 */
export function normalizeKnowledgeName(name: string): string {
  let value = String(name ?? '').trim();
  value = [...value].map(fullWidthToHalf).join('');
  value = value.toLowerCase();
  value = value.replace(/[\u2018\u2019]/g, "'");
  value = value.replace(/[\u201C\u201D]/g, '"');
  value = value.replace(/[，、]/g, ',');
  value = value.replace(/[。]/g, '.');
  value = value.replace(/[；]/g, ';');
  value = value.replace(/[：]/g, ':');
  value = value.replace(/[！]/g, '!');
  value = value.replace(/[？]/g, '?');
  value = value.replace(/[\u2013\u2014\u2212_-]/g, '-');
  value = value.replace(/[·•]/g, '-');
  value = value.replace(/\s+/g, ' ');
  return value.trim();
}

function contextStatus(kp: BridgeKnowledgePoint, node: BridgeKnowledgeNode): ContextStatus {
  const kpChapter = (kp.chapter ?? '').trim();
  const nodeChapter = (node.chapterName ?? '').trim();
  if (!kpChapter || !nodeChapter) {
    return 'NEUTRAL';
  }
  return normalizeKnowledgeName(kpChapter) === normalizeKnowledgeName(nodeChapter) ? 'MATCH' : 'CONFLICT';
}

function normalizedNameEqual(kp: BridgeKnowledgePoint, node: BridgeKnowledgeNode): boolean {
  return normalizeKnowledgeName(kp.title) === normalizeKnowledgeName(node.name);
}

function isPlausible(kp: BridgeKnowledgePoint, node: BridgeKnowledgeNode): boolean {
  if (kp.subject !== node.subject) {
    return false;
  }
  if (normalizedNameEqual(kp, node)) {
    return true;
  }
  const kpChapter = (kp.chapter ?? '').trim();
  const nodeChapter = (node.chapterName ?? '').trim();
  return (
    kpChapter !== ''
    && nodeChapter !== ''
    && normalizeKnowledgeName(kpChapter) === normalizeKnowledgeName(nodeChapter)
  );
}

function buildCandidates(kp: BridgeKnowledgePoint, nodes: readonly BridgeKnowledgeNode[]): BridgeCandidate[] {
  return nodes
    .filter((node) => isPlausible(kp, node))
    .map((node) => ({
      knowledgeNodeId: node.id,
      similarity: normalizedNameEqual(kp, node) ? 1 : 0,
    }))
    .sort(
      (left, right) =>
        right.similarity - left.similarity || left.knowledgeNodeId.localeCompare(right.knowledgeNodeId),
    );
}

export function matchKnowledgePointToNodes(
  kp: BridgeKnowledgePoint,
  nodes: readonly BridgeKnowledgeNode[],
  aliases: readonly BridgeAlias[],
): BridgeDecision {
  const sameSubject = nodes.filter((node) => node.subject === kp.subject);
  const candidateNodes = buildCandidates(kp, sameSubject);
  const base = {
    knowledgePointId: kp.id,
    knowledgePointName: kp.title,
    subject: kp.subject,
    chapter: kp.chapter,
    section: null,
  };
  const reasons: string[] = ['SAME_SUBJECT'];

  const exact = sameSubject.filter((node) => node.name === kp.title);
  if (exact.length === 1 && contextStatus(kp, exact[0]) !== 'CONFLICT') {
    return {
      ...base,
      candidateNodes,
      selectedNodeIds: [exact[0].id],
      confidence: 'HIGH',
      matchMethod: 'EXACT_NAME',
      status: 'ACTIVE',
      reasons: [...reasons, 'EXACT_NAME_MATCH', 'UNIQUE_CANDIDATE'],
    };
  }

  const normalized = sameSubject.filter((node) => normalizedNameEqual(kp, node));
  if (normalized.length === 1 && contextStatus(kp, normalized[0]) !== 'CONFLICT') {
    return {
      ...base,
      candidateNodes,
      selectedNodeIds: [normalized[0].id],
      confidence: 'HIGH',
      matchMethod: 'NORMALIZED_NAME',
      status: 'ACTIVE',
      reasons: [...reasons, 'NORMALIZED_NAME_MATCH', 'UNIQUE_CANDIDATE'],
    };
  }

  const aliasRows = aliases.filter((alias) => alias.subject === kp.subject && alias.from === kp.title);
  if (aliasRows.length > 0) {
    const targets = [...new Set(aliasRows.map((alias) => alias.to))];
    const resolved = targets
      .map((targetName) =>
        sameSubject.find((node) => normalizeKnowledgeName(node.name) === normalizeKnowledgeName(targetName)),
      )
      .filter((node): node is BridgeKnowledgeNode => Boolean(node));
    const missing = resolved.length !== targets.length;
    const anyConflict = resolved.some((node) => contextStatus(kp, node) === 'CONFLICT');
    if (!missing && !anyConflict) {
      const selectedNodeIds = resolved.map((node) => node.id).sort();
      return {
        ...base,
        candidateNodes,
        selectedNodeIds,
        confidence: 'HIGH',
        matchMethod: 'CONTEXT_MATCH',
        status: 'ACTIVE',
        reasons: [
          ...reasons,
          'EXPLICIT_ALIAS_MATCH',
          'UNIQUE_CANDIDATE',
          ...(selectedNodeIds.length > 1 ? ['DETERMINISTIC_ALIAS_SET'] : []),
        ],
      };
    }
    return {
      ...base,
      candidateNodes,
      selectedNodeIds: [],
      confidence: 'MEDIUM',
      matchMethod: null,
      status: 'PENDING_REVIEW',
      reasons: [
        ...reasons,
        'EXPLICIT_ALIAS_MATCH',
        ...(missing ? ['ALIAS_TARGET_MISSING'] : []),
        ...(anyConflict ? ['CONTEXT_CONFLICT'] : []),
      ],
    };
  }

  if (normalized.length > 1) {
    return {
      ...base,
      candidateNodes,
      selectedNodeIds: [],
      confidence: 'MEDIUM',
      matchMethod: null,
      status: 'PENDING_REVIEW',
      reasons: [...reasons, 'NORMALIZED_NAME_MATCH', 'MULTIPLE_CANDIDATES'],
    };
  }
  if (normalized.length === 1 && contextStatus(kp, normalized[0]) === 'CONFLICT') {
    return {
      ...base,
      candidateNodes,
      selectedNodeIds: [],
      confidence: 'MEDIUM',
      matchMethod: null,
      status: 'PENDING_REVIEW',
      reasons: [...reasons, 'NORMALIZED_NAME_MATCH', 'CONTEXT_CONFLICT'],
    };
  }

  const plausible = sameSubject.filter((node) => isPlausible(kp, node));
  if (plausible.length >= 2) {
    return {
      ...base,
      candidateNodes,
      selectedNodeIds: [],
      confidence: 'MEDIUM',
      matchMethod: null,
      status: 'PENDING_REVIEW',
      reasons: [...reasons, 'BROAD_CONTEXT', 'MULTIPLE_CANDIDATES'],
    };
  }

  return {
    ...base,
    candidateNodes,
    selectedNodeIds: [],
    confidence: null,
    matchMethod: null,
    status: null,
    reasons: [...reasons, 'NO_DETERMINISTIC_EVIDENCE'],
  };
}

export function matchAllKnowledgePoints(
  kps: readonly BridgeKnowledgePoint[],
  nodes: readonly BridgeKnowledgeNode[],
  aliases: readonly BridgeAlias[],
): BridgeDecision[] {
  return kps.map((kp) => matchKnowledgePointToNodes(kp, nodes, aliases));
}
