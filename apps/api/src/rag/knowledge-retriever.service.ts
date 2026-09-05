/**
 * Knowledge Retriever for Contextual Coach (Phase AI-2).
 *
 * Thin, failure-isolated wrapper around KnowledgeSearchService that produces
 * a bounded knowledge context for prompt assembly:
 * - Max 3 retrieved nodes, max 3 related nodes per result (token control).
 * - Never throws: retrieval failures degrade to an explicit unavailable
 *   context so the coach response path stays intact.
 *
 * The coach prompt receives this as optional `knowledgeContext`; when absent
 * (no retriever wired or no usable query) prompt shape is unchanged.
 */

import { Injectable, Logger } from '@nestjs/common';
import { KnowledgeSearchService } from './knowledge-search.service';

export interface RetrievedKnowledgeNodeContext {
  knowledgeNodeId: string;
  subject: string;
  nodeType: string;
  title: string;
  chapterPath: readonly string[];
  relevanceScore: number;
  relatedNodes: readonly {
    knowledgeNodeId: string;
    title: string;
    relationType: string;
  }[];
}

export interface RetrievedKnowledgeContext {
  source: string;
  query: string;
  available: boolean;
  results: readonly RetrievedKnowledgeNodeContext[];
  reason?: string;
}

export const MAX_RETRIEVED_NODES = 3;
export const MAX_RELATED_PER_NODE = 3;
const SCORE_PRECISION = 1000;

@Injectable()
export class KnowledgeRetriever {
  private readonly logger = new Logger(KnowledgeRetriever.name);

  constructor(private readonly search: KnowledgeSearchService) {}

  async retrieve(
    query: string,
    options?: { subject?: string },
  ): Promise<RetrievedKnowledgeContext | null> {
    const trimmed = query?.trim();
    if (!trimmed) return null;
    try {
      const response = await this.search.search(trimmed, {
        topK: MAX_RETRIEVED_NODES,
        ...(options?.subject ? { subject: options.subject } : {}),
      });
      const results = response.results.slice(0, MAX_RETRIEVED_NODES).map((result) => ({
        knowledgeNodeId: result.knowledgeNodeId,
        subject: result.subject,
        nodeType: result.nodeType,
        title: result.title,
        chapterPath: result.chapterPath,
        relevanceScore: Math.round(result.relevanceScore * SCORE_PRECISION) / SCORE_PRECISION,
        relatedNodes: result.relatedNodes
          .slice(0, MAX_RELATED_PER_NODE)
          .map((node) => ({
            knowledgeNodeId: node.knowledgeNodeId,
            title: node.title,
            relationType: node.relationType,
          })),
      }));
      return {
        source: response.source,
        query: trimmed,
        available: response.available,
        results,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Knowledge retrieval failed: ${message}`);
      return {
        source: 'unavailable',
        query: trimmed,
        available: false,
        results: [],
        reason: 'retrieval_error',
      };
    }
  }
}