/**
 * Vector Store Abstraction for RAG.
 *
 * This module provides an in-memory vector store with cosine similarity search.
 * It is designed to be replaceable with pgvector when Schema changes are allowed.
 *
 * Key design decisions:
 * - Vectors are assumed to be L2-normalized; cosine similarity = dot product.
 * - Subject-level filtering is supported at search time.
 * - The in-memory implementation uses brute force; suitable for <10K chunks.
 */

export interface VectorRecord {
  chunkId: string;
  knowledgeNodeId: string;
  subject: string;
  vector: number[];
}

export interface VectorSearchHit {
  chunkId: string;
  knowledgeNodeId: string;
  subject: string;
  score: number;
}

export interface VectorSearchOptions {
  topK: number;
  subject?: string;
}

export interface VectorStore {
  readonly name: string;
  readonly size: number;
  replaceAll(records: readonly VectorRecord[]): Promise<void>;
  search(vector: number[], options: VectorSearchOptions): Promise<VectorSearchHit[]>;
}

/**
 * In-memory vector store with brute-force cosine similarity.
 */
export class InMemoryVectorStore implements VectorStore {
  readonly name = 'in-memory-v1';
  private records: Map<string, { record: VectorRecord; norm: number }> = new Map();

  get size(): number {
    return this.records.size;
  }

  async replaceAll(records: readonly VectorRecord[]): Promise<void> {
    const newMap = new Map<string, { record: VectorRecord; norm: number }>();
    for (const rec of records) {
      const norm = Math.sqrt(rec.vector.reduce((s, v) => s + v * v, 0));
      newMap.set(rec.chunkId, { record: rec, norm: norm === 0 ? 1 : norm });
    }
    this.records = newMap;
  }

  async search(vector: number[], options: VectorSearchOptions): Promise<VectorSearchHit[]> {
    const queryNorm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0)) || 1;
    const hits: { chunkId: string; knowledgeNodeId: string; subject: string; score: number }[] = [];
    const targetK = Math.min(options.topK, this.records.size);
    const minHeap: number[] = []; // stores negative scores for min-heap behavior

    for (const [chunkId, { record, norm }] of this.records.entries()) {
      if (options.subject && record.subject !== options.subject) continue;

      // Cosine similarity = dot(product) / (normA * normB)
      let dot = 0;
      const recVec = record.vector;
      for (let i = 0; i < vector.length && i < recVec.length; i++) {
        dot += vector[i] * recVec[i];
      }
      const score = dot / (queryNorm * norm);

      if (hits.length < targetK) {
        hits.push({ chunkId, knowledgeNodeId: record.knowledgeNodeId, subject: record.subject, score });
        if (hits.length === targetK) {
          // Convert to heap
          hits.sort((a, b) => a.score - b.score);
        }
      } else if (score > hits[0].score) {
        hits[0] = { chunkId, knowledgeNodeId: record.knowledgeNodeId, subject: record.subject, score };
        // Re-heapify
        hits.sort((a, b) => a.score - b.score);
      }
    }
    return hits.sort((a, b) => b.score - a.score);
  }
}