/**
 * Knowledge Search Service (Nest Service).
 *
 * Orchestrates the RAG pipeline:
 * 1. Load corpus from database (lazy, once per process).
 * 2. Build chunks and embed all content.
 * 3. Index embeddings in the vector store.
 * 4. Search: embed query → vector search → aggregate → enrich.
 *
 * This service is designed for injection into Contextual Coach (AI-2).
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { AiMetricsService } from '../ai-metrics/ai-metrics.service';
import {
  type EmbeddingProvider,
  createEmbeddingProvider,
  type OpenAICompatibleEmbeddingOptions,
} from './embedding-provider';
import {
  buildKnowledgeCorpus,
  type KnowledgeCorpus,
  type KnowledgeChunk,
  type KnowledgeDocument,
} from './knowledge-corpus';
import { KnowledgeCorpusLoader } from './knowledge-corpus.loader';
import {
  aggregateKnowledgeSearch,
  type KnowledgeSearchHit,
} from './knowledge-search';
import { InMemoryVectorStore, type VectorRecord, type VectorStore } from './vector-store';

export interface KnowledgeSearchOptions {
  subject?: string;
  topK?: number;
}

export interface KnowledgeSearchResponse {
  query: string;
  source: string;
  indexSize: number;
  available: boolean;
  results: readonly KnowledgeSearchHit[];
}

/** Default index TTL: 1 hour. Knowledge tree is static content; questions update rarely. */
const DEFAULT_INDEX_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class KnowledgeSearchService {
  private readonly logger = new Logger(KnowledgeSearchService.name);

  private indexPromise: Promise<{
    chunks: Map<string, KnowledgeChunk>;
    documents: Map<string, KnowledgeDocument>;
    relations: readonly { fromId: string; toId: string; type: string }[];
    provider: EmbeddingProvider;
    store: VectorStore;
    available: boolean;
    builtAt: number;
  }> | null = null;

  constructor(
    private readonly corpusLoader: KnowledgeCorpusLoader,
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly vectorStore: VectorStore,
    // Live metrics (AI-12): optional for legacy/test DI compositions.
    @Optional() private readonly metrics?: AiMetricsService,
  ) {}

  async search(query: string, options?: KnowledgeSearchOptions): Promise<KnowledgeSearchResponse> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return {
        query: normalizedQuery,
        source: this.embeddingProvider.name,
        indexSize: 0,
        available: false,
        results: [],
      };
    }

    const startedAt = Date.now();
    const index = await this.ensureIndex();
    const topK = Math.max(1, Math.min(20, options?.topK ?? 5));

    // Embed query
    const [queryVector] = await this.embeddingProvider.embed([normalizedQuery]);

    // Vector search: retrieve more chunks for grouping
    const chunkHits = await this.vectorStore.search(queryVector, {
      topK: topK * 4,
      subject: options?.subject,
    });

    // Aggregate to node-level
    const results = aggregateKnowledgeSearch(
      index.chunks,
      chunkHits,
      index.relations,
      index.documents,
      { topK, subject: options?.subject },
    );

    this.logger.log(JSON.stringify({
      event: 'knowledge_search.completed',
      queryLength: normalizedQuery.length,
      subject: options?.subject ?? null,
      source: index.provider.name,
      available: index.available,
      indexSize: index.store.size,
      resultCount: results.length,
      topScore: results[0]?.relevanceScore ?? null,
      durationMs: Date.now() - startedAt,
    }));
    this.metrics?.recordRagSearch({
      available: index.available,
      resultCount: results.length,
      topScore: results[0]?.relevanceScore ?? null,
      durationMs: Date.now() - startedAt,
    });

    return {
      query: normalizedQuery,
      source: index.provider.name,
      indexSize: index.store.size,
      available: index.available,
      results,
    };
  }

  private async ensureIndex() {
    if (this.indexPromise) {
      const index = await this.indexPromise;
      if (Date.now() - index.builtAt < this.indexTtlMs()) return index;
      // TTL expired: drop and rebuild below.
      this.indexPromise = null;
    }

    this.indexPromise = (async () => {
      const raw = await this.corpusLoader.load();
      const provider = this.embeddingProvider;
      const store = this.vectorStore;

      if (!raw.available) {
        this.logger.warn('Knowledge corpus unavailable: DATABASE_URL not configured. RAG search will return empty results.');
        return {
          chunks: new Map(),
          documents: new Map(),
          relations: [],
          provider,
          store,
          available: false,
          builtAt: Date.now(),
        };
      }

      const corpus = buildKnowledgeCorpus(raw.nodes, raw.relations, raw.questions);

      // Embed all chunks
      const chunkContents = corpus.chunks.map((c) => c.content);
      const embeddings = await provider.embed(chunkContents);

      const records: VectorRecord[] = corpus.chunks.map((chunk, i) => ({
        chunkId: chunk.chunkId,
        knowledgeNodeId: chunk.knowledgeNodeId,
        subject: chunk.subject,
        vector: embeddings[i] ?? new Array(provider.dimensions).fill(0),
      }));

      await store.replaceAll(records);

      const chunksMap = new Map<string, KnowledgeChunk>();
      for (const chunk of corpus.chunks) chunksMap.set(chunk.chunkId, chunk);

      const docsMap = new Map<string, KnowledgeDocument>();
      for (const doc of corpus.documents) docsMap.set(doc.knowledgeNodeId, doc);

      this.logger.log(`Knowledge search index built: ${chunksMap.size} chunks, ${docsMap.size} nodes, provider=${provider.name}`);

      return {
        chunks: chunksMap,
        documents: docsMap,
        relations: raw.relations,
        provider,
        store,
        available: true,
        builtAt: Date.now(),
      };
    })();

    return this.indexPromise;
  }

  /**
   * Read-only graph snapshot for the V2 pipeline (relations + node metadata).
   * Returns null when the corpus is unavailable; builds the index lazily.
   */
  async getGraphSnapshot(): Promise<{
    relations: readonly { fromId: string; toId: string; type: string }[];
    nodes: Map<string, { title: string; subject: string; difficulty?: number }>;
  } | null> {
    const index = await this.ensureIndex();
    if (!index.available) return null;
    const nodes = new Map<string, { title: string; subject: string; difficulty?: number }>();
    for (const [nodeId, doc] of index.documents) {
      nodes.set(nodeId, { title: doc.title, subject: doc.subject, difficulty: doc.difficulty });
    }
    return { relations: index.relations, nodes };
  }

  private indexTtlMs(): number {
    const parsed = Number.parseInt(String(process.env.RAG_INDEX_TTL_MS ?? ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INDEX_TTL_MS;
  }

  /**
   * Reset the index for testing or explicit invalidation.
   * TTL-based rebuild also runs automatically (see DEFAULT_INDEX_TTL_MS).
   */
  async resetIndex(): Promise<void> {
    this.indexPromise = null;
  }
}