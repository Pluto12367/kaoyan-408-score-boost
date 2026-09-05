/**
 * Knowledge Search Aggregation (Pure Functions).
 *
 * This module aggregates chunk-level search results into node-level summaries,
 * including related nodes enrichment from the relation index.
 */

import type { KnowledgeChunk, KnowledgeDocument, KnowledgeRelationCorpusInput } from './knowledge-corpus';

export interface KnowledgeSearchHit {
  knowledgeNodeId: string;
  subject: string;
  nodeType: string;
  title: string;
  chapterPath: readonly string[];
  relevanceScore: number;
  matchedChunks: readonly {
    chunkId: string;
    kind: string;
    content: string;
    questionId?: string;
  }[];
  relatedNodes: readonly {
    knowledgeNodeId: string;
    title: string;
    relationType: string;
  }[];
}

export interface KnowledgeSearchOptions {
  topK: number;
  subject?: string;
}

/**
 * Aggregate chunk-level hits into node-level summaries.
 *
 * - Groups hits by knowledgeNodeId, keeping the highest score.
 * - Enriches with related nodes from the relation index.
 * - Limits matchedChunks to top 2 per node.
 */
export function aggregateKnowledgeSearch(
  chunks: Map<string, KnowledgeChunk>,
  hits: readonly { chunkId: string; knowledgeNodeId: string; subject: string; score: number }[],
  relations: readonly KnowledgeRelationCorpusInput[],
  documents: Map<string, KnowledgeDocument>,
  options: KnowledgeSearchOptions,
): KnowledgeSearchHit[] {
  const nodeMap = new Map<string, KnowledgeDocument>(documents.entries());
  const relationByNode = new Map<string, KnowledgeRelationCorpusInput[]>();

  for (const rel of relations) {
    const out = relationByNode.get(rel.fromId) ?? [];
    out.push(rel);
    relationByNode.set(rel.fromId, out);
  }

  const byNodeId = new Map<string, { score: number; chunkIds: string[] }>();

  for (const hit of hits) {
    const existing = byNodeId.get(hit.knowledgeNodeId);
    if (!existing) {
      byNodeId.set(hit.knowledgeNodeId, { score: hit.score, chunkIds: [hit.chunkId] });
    } else if (hit.score > existing.score) {
      existing.score = hit.score;
      existing.chunkIds.push(hit.chunkId);
    } else {
      existing.chunkIds.push(hit.chunkId);
    }
  }

  const results: KnowledgeSearchHit[] = [];

  for (const [nodeId, { score, chunkIds }] of byNodeId) {
    if (options.subject) {
      const node = nodeMap.get(nodeId);
      if (node?.subject !== options.subject) continue;
    }

    const node = nodeMap.get(nodeId);
    if (!node) continue;

    const matchedChunks = chunkIds.slice(0, 2).map((cid) => {
      const chunk = chunks.get(cid);
      if (!chunk) {
        return { chunkId: cid, kind: 'unknown', content: '' };
      }
      return {
        chunkId: cid,
        kind: chunk.kind,
        content: chunk.content,
        questionId: chunk.questionId,
      };
    });

    // Related nodes: max 5, resolve titles
    const rels = relationByNode.get(nodeId) ?? [];
    const relatedNodes = rels.slice(0, 5).map((rel) => {
      const target = nodeMap.get(rel.toId);
      return {
        knowledgeNodeId: rel.toId,
        title: target?.title ?? rel.toId,
        relationType: rel.type,
      };
    });

    results.push({
      knowledgeNodeId: nodeId,
      subject: node.subject,
      nodeType: node.nodeType,
      title: node.title,
      chapterPath: node.chapterPath,
      relevanceScore: score,
      matchedChunks,
      relatedNodes,
    });
  }

  return results.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, options.topK);
}