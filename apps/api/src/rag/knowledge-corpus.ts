/**
 * Knowledge Corpus Builder (Pure Functions).
 *
 * This module transforms raw database entities into a search-optimized
 * representation: KnowledgeDocument + KnowledgeChunk.
 *
 * Chunks are the unit of embedding and retrieval. Each chunk carries:
 * - knowledgeNodeId: The atomic knowledge node identity.
 * - content: The searchable text (node overview / relations / question analysis).
 * - metadata: subject, nodeType, title, chapterPath, kind.
 *
 * Note: KnowledgeNode.isCurrent is not a field; only Question has isCurrent.
 * This builder assumes all provided nodes are active.
 */

export const SUBJECT_NAMES: Record<string, string> = {
  DS: '数据结构',
  CO: '计算机组成原理',
  OS: '操作系统',
  CN: '计算机网络',
};

export type KnowledgeChunkKind = 'node_overview' | 'node_relations' | 'question_analysis';

export interface KnowledgeChunk {
  chunkId: string;
  knowledgeNodeId: string;
  subject: string;
  nodeType: string;
  title: string;
  chapterPath: readonly string[];
  kind: KnowledgeChunkKind;
  content: string;
  questionId?: string;
}

export interface KnowledgeDocument {
  documentId: string;
  knowledgeNodeId: string;
  subject: string;
  nodeType: string;
  title: string;
  chapterPath: readonly string[];
  importance: number;
  difficulty: number;
}

export interface KnowledgeNodeCorpusInput {
  id: string;
  subject: string;
  nodeType: string;
  name: string;
  importance: number;
  difficulty: number;
  chapterPath: readonly string[];
}

export interface KnowledgeRelationCorpusInput {
  fromId: string;
  toId: string;
  type: string;
}

export interface KnowledgeQuestionCorpusInput {
  id: string;
  stem: string;
  analysis: string;
  knowledgeNodeIds: readonly string[];
}

export interface KnowledgeCorpus {
  documents: readonly KnowledgeDocument[];
  chunks: readonly KnowledgeChunk[];
}

/**
 * Build a knowledge corpus from database entities.
 */
export function buildKnowledgeCorpus(
  nodes: readonly KnowledgeNodeCorpusInput[],
  relations: readonly KnowledgeRelationCorpusInput[],
  questions: readonly KnowledgeQuestionCorpusInput[],
): KnowledgeCorpus {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const relationMap = new Map<string, KnowledgeRelationCorpusInput[]>();

  // Index relations bidirectionally for lookup
  for (const rel of relations) {
    const out = relationMap.get(rel.fromId) ?? [];
    out.push(rel);
    relationMap.set(rel.fromId, out);
    const into = relationMap.get(rel.toId) ?? [];
    into.push({ ...rel, fromId: rel.toId, toId: rel.fromId });
    relationMap.set(rel.toId, into);
  }

  const documents: KnowledgeDocument[] = [];
  const chunks: KnowledgeChunk[] = [];

  for (const node of nodes) {
    const documentId = `node:${node.id}`;
    const chapterPath = node.chapterPath;

    documents.push({
      documentId,
      knowledgeNodeId: node.id,
      subject: node.subject,
      nodeType: node.nodeType,
      title: node.name,
      chapterPath,
      importance: node.importance,
      difficulty: node.difficulty,
    });

    // Node overview chunk
    const overviewChunk = buildNodeOverviewChunk(node, documentId);
    chunks.push(overviewChunk);

    // Node relations chunk (if has relations)
    const rels = relationMap.get(node.id);
    if (rels && rels.length > 0) {
      const relationsChunk = buildNodeRelationsChunk(node, rels, nodeMap, documentId);
      chunks.push(relationsChunk);
    }
  }

  // Question analysis chunks
  for (const q of questions) {
    // Skip questions without meaningful analysis
    if (!q.analysis || !q.analysis.trim()) continue;

    // Each question creates one chunk per linked node
    // To avoid duplicate embeddings, we limit to first node
    const primaryNodeId = q.knowledgeNodeIds[0];
    if (!primaryNodeId) continue;

    const node = nodeMap.get(primaryNodeId);
    if (!node) continue;

    const analysisContent = buildQuestionAnalysisContent(q);
    const chunk: KnowledgeChunk = {
      chunkId: `question:${q.id}`,
      knowledgeNodeId: primaryNodeId,
      subject: node.subject,
      nodeType: node.nodeType,
      title: q.stem.slice(0, 60) + (q.stem.length > 60 ? '...' : ''),
      chapterPath: node.chapterPath,
      kind: 'question_analysis',
      content: analysisContent,
      questionId: q.id,
    };
    chunks.push(chunk);
  }

  return { documents, chunks };
}

function buildNodeOverviewChunk(
  node: KnowledgeNodeCorpusInput,
  documentId: string,
): KnowledgeChunk {
  const subjectName = SUBJECT_NAMES[node.subject] || node.subject;
  const parts = [subjectName, ...node.chapterPath, node.name];
  const chapterStr = parts.filter(Boolean).join(' ');

  const content = `${chapterStr} 考点 重要度${node.importance} 难度${node.difficulty} ${node.nodeType}`;

  return {
    chunkId: `${documentId}#overview`,
    knowledgeNodeId: node.id,
    subject: node.subject,
    nodeType: node.nodeType,
    title: node.name,
    chapterPath: node.chapterPath,
    kind: 'node_overview',
    content,
  };
}

function buildNodeRelationsChunk(
  node: KnowledgeNodeCorpusInput,
  relations: readonly KnowledgeRelationCorpusInput[],
  nodeMap: Map<string, KnowledgeNodeCorpusInput>,
  documentId: string,
): KnowledgeChunk {
  const prerequisites: string[] = [];
  const related: string[] = [];

  for (const rel of relations) {
    const target = nodeMap.get(rel.toId);
    if (!target) continue;
    const label = `${target.name}(${target.nodeType})`;
    if (rel.type === 'PREREQUISITE') {
      prerequisites.push(label);
    } else if (rel.type === 'RELATED' || rel.type === 'DEPENDS_ON') {
      related.push(label);
    } else {
      related.push(label);
    }
  }

  const parts: string[] = [];
  if (prerequisites.length > 0) parts.push(`前置: ${prerequisites.join(', ')}`);
  if (related.length > 0) parts.push(`相关: ${related.join(', ')}`);
  const content = parts.join('; ');

  return {
    chunkId: `${documentId}#relations`,
    knowledgeNodeId: node.id,
    subject: node.subject,
    nodeType: node.nodeType,
    title: node.name,
    chapterPath: node.chapterPath,
    kind: 'node_relations',
    content,
  };
}

function buildQuestionAnalysisContent(q: KnowledgeQuestionCorpusInput): string {
  let analysis = q.analysis;
  if (analysis.length > 800) analysis = analysis.slice(0, 800) + '...';
  return `${q.stem}\n解析: ${analysis}`;
}