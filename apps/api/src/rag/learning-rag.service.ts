/**
 * Learning RAG V2 Service (Phase AI-8).
 *
 * Orchestrates the V2 pipeline over the V1 vector search:
 * rewrite → vector+hybrid fusion → graph expansion → difficulty awareness.
 * The V1 endpoint and service contract remain untouched; V2 is additive.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { KnowledgeSearchService } from './knowledge-search.service';
import {
  applyDifficultyAwareness,
  expandWithGraph,
  hybridScore,
  rewriteQuery,
  type GraphRelation,
  type MasteryEntry,
} from './learning-rag';

export interface LearningSearchOptions {
  subject?: string;
  topK?: number;
  /** StudentContext mastery entries; enables difficulty awareness when provided. */
  studentMastery?: readonly MasteryEntry[];
}

export interface LearningSearchResultNode {
  knowledgeNodeId: string;
  subject: string;
  nodeType: string;
  title: string;
  chapterPath: readonly string[];
  source: 'seed' | 'graph_expansion';
  relevanceScore: number;
  keywordScore?: number;
  adjustment?: 'mastered_down' | 'weak_basic_up' | 'none';
  reachedFrom?: string;
  relationType?: string;
  relatedNodes: readonly { knowledgeNodeId: string; title: string; relationType: string }[];
}

export interface LearningSearchResponse {
  query: string;
  rewrittenQuery: { original: string; expanded: string; addedTerms: readonly string[] };
  source: string;
  indexSize: number;
  available: boolean;
  results: readonly LearningSearchResultNode[];
  pipeline: {
    rewriteApplied: boolean;
    hybridApplied: boolean;
    expansionCount: number;
    difficultyApplied: boolean;
  };
}

@Injectable()
export class LearningRagService {
  private readonly logger = new Logger(LearningRagService.name);

  constructor(
    private readonly knowledgeSearch: KnowledgeSearchService,
    // Retriever-grade logging hook (AI-12); optional to keep the service standalone.
    @Optional() private readonly onSearch?: (event: { query: string; resultCount: number; durationMs: number; expansions: number }) => void,
  ) {}

  async search(query: string, options?: LearningSearchOptions): Promise<LearningSearchResponse> {
    const startedAt = Date.now();
    const topK = Math.max(1, Math.min(10, options?.topK ?? 5));
    const rewrite = rewriteQuery(query ?? '');
    if (!rewrite.original) {
      return {
        query: '',
        rewrittenQuery: { original: '', expanded: '', addedTerms: [] },
        source: this.knowledgeSearch ? 'learning-rag-v2' : 'learning-rag-v2',
        indexSize: 0,
        available: false,
        results: [],
        pipeline: { rewriteApplied: false, hybridApplied: false, expansionCount: 0, difficultyApplied: false },
      };
    }

    // Step 1: vector retrieval on the expanded query, over-fetch for re-ranking.
    const v1 = await this.knowledgeSearch.search(rewrite.expanded, {
      topK: topK * 2,
      ...(options?.subject ? { subject: options.subject } : {}),
    });

    // Step 2: hybrid fusion (original query drives keyword scoring).
    const fused = v1.results.map((result) => {
      const score = hybridScore(rewrite.original, {
        vectorScore: result.relevanceScore,
        title: result.title,
        chapterPath: result.chapterPath,
        contents: result.matchedChunks.map((chunk) => chunk.content),
      });
      return { result, score };
    }).sort((left, right) => right.score.finalScore - left.score.finalScore);
    const seeds = fused.slice(0, topK);

    // Step 3: graph expansion (1-hop, bounded, deduped).
    let expansions: ReturnType<typeof expandWithGraph> = [];
    const graph = await this.knowledgeSearch.getGraphSnapshot();
    if (graph) {
      expansions = expandWithGraph(
        seeds.map(({ result, score }) => ({
          knowledgeNodeId: result.knowledgeNodeId,
          subject: result.subject,
          title: result.title,
          score: score.finalScore,
        })),
        graph.relations,
        graph.nodes,
      );
    }

    // Step 4: difficulty awareness on seeds (expansions already at half score).
    const masteryByNode = new Map<string, number>(
      (options?.studentMastery ?? []).map((entry) => [entry.knowledgeNodeId, entry.mastery]),
    );
    const difficultyApplied = masteryByNode.size > 0 && Boolean(graph);
    const difficultyByNode = new Map<string, number>(
      graph ? [...graph.nodes.entries()].filter(([, meta]) => meta.difficulty != null).map(([id, meta]) => [id, meta.difficulty!]) : [],
    );
    const adjusted = applyDifficultyAwareness(
      seeds.map(({ result, score }) => ({ knowledgeNodeId: result.knowledgeNodeId, score: score.finalScore })),
      masteryByNode,
      difficultyByNode,
    );

    const resultNodes: LearningSearchResultNode[] = [
      ...seeds.map(({ result, score }) => {
        const adjustment = adjusted.get(result.knowledgeNodeId);
        return {
          knowledgeNodeId: result.knowledgeNodeId,
          subject: result.subject,
          nodeType: result.nodeType,
          title: result.title,
          chapterPath: result.chapterPath,
          source: 'seed' as const,
          relevanceScore: adjustment?.adjustedScore ?? score.finalScore,
          keywordScore: score.keywordScore,
          adjustment: adjustment?.adjustment ?? 'none',
          relatedNodes: result.relatedNodes,
        };
      }),
      ...expansions.map((expansion) => ({
        knowledgeNodeId: expansion.knowledgeNodeId,
        subject: expansion.subject,
        nodeType: 'unknown',
        title: expansion.title,
        chapterPath: [] as string[],
        source: 'graph_expansion' as const,
        relevanceScore: expansion.score,
        reachedFrom: expansion.reachedFrom,
        relationType: expansion.relationType,
        relatedNodes: [],
      })),
    ];

    const response: LearningSearchResponse = {
      query: rewrite.original,
      rewrittenQuery: { original: rewrite.original, expanded: rewrite.expanded, addedTerms: rewrite.addedTerms },
      source: `learning-rag-v2/${v1.source}`,
      indexSize: v1.indexSize,
      available: v1.available,
      results: resultNodes,
      pipeline: {
        rewriteApplied: rewrite.appliedRules.length > 0,
        hybridApplied: true,
        expansionCount: expansions.length,
        difficultyApplied,
      },
    };
    this.onSearch?.({
      query: rewrite.original,
      resultCount: resultNodes.length,
      durationMs: Date.now() - startedAt,
      expansions: expansions.length,
    });
    return response;
  }
}