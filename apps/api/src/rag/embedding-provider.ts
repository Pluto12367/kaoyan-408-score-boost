/**
 * Embedding Provider Abstraction for RAG.
 *
 * This module provides a unified embedding interface with two implementations:
 * - LocalDeterministicEmbeddingProvider: Deterministic, no external dependency.
 * - OpenAICompatibleEmbeddingProvider: OpenAI-compatible HTTP API.
 *
 * The provider is selected at runtime via EMBEDDING_API_KEY environment variable.
 * When no key is configured, the local provider is used, ensuring RAG works
 * even without external services (content indexed from the knowledge tree and
 * question bank remains retrievable via lexical hashing).
 *
 * Deterministic embedding is based on character n-gram hashing:
 * - Unigrams + bigrams are extracted from normalized text.
 * - Each n-gram is hashed to a fixed-dimension vector slot via FNV-1a.
 * - Vectors are L2-normalized for cosine similarity.
 *
 * This approach provides baseline retrieval without external APIs while
 * maintaining explicit source indication in search results.
 */

export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  embed(texts: readonly string[]): Promise<number[][]>;
}

export class EmbeddingError extends Error {
  readonly kind: 'timeout' | 'rate_limited' | 'http' | 'network' | 'invalid_response';
  readonly status?: number;
  constructor(kind: EmbeddingError['kind'], message: string, status?: number) {
    super(message);
    this.name = 'EmbeddingError';
    this.kind = kind;
    this.status = status;
  }
}

/**
 * Environment-based provider factory.
 */
export function createEmbeddingProvider(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): EmbeddingProvider {
  if (env.EMBEDDING_API_KEY?.trim()) {
    const baseUrl = (env.EMBEDDING_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
    const model = env.EMBEDDING_MODEL ?? 'text-embedding-3-small';
    const timeoutMs = Number(env.EMBEDDING_TIMEOUT_MS ?? 30000);
    return new OpenAICompatibleEmbeddingProvider({
      apiKey: env.EMBEDDING_API_KEY.trim(),
      baseUrl,
      model,
      timeoutMs,
      fetchImpl,
    });
  }
  return new LocalDeterministicEmbeddingProvider();
}

/**
 * Local deterministic embedding based on character n-gram hashing.
 */
export class LocalDeterministicEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'local-deterministic-v1';
  readonly dimensions = 512;

  async embed(texts: readonly string[]): Promise<number[][]> {
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): number[] {
    const normalized = normalizeText(text);
    if (!normalized) {
      return new Array(this.dimensions).fill(0);
    }
    const tokens = extractNgrams(normalized);
    const vector = new Array(this.dimensions).fill(0);
    for (const token of tokens) {
      const hash = fnv1a32(token);
      const slot = hash % this.dimensions;
      vector[slot] += 1.0;
    }
    return l2Normalize(vector);
  }
}

/**
 * OpenAI-compatible embedding provider.
 */
export interface OpenAICompatibleEmbeddingOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  fetchImpl: typeof fetch;
  batchSize?: number;
}

export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;
  readonly dimensions = 1536; // Default for text-embedding-3-small; may vary by model
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly batchSize: number;

  constructor(options: OpenAICompatibleEmbeddingOptions) {
    if (!options.apiKey) {
      throw new Error('Embedding API key is required');
    }
    this.name = `openai-compatible:${options.model}`;
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs;
    this.fetchImpl = options.fetchImpl;
    this.batchSize = options.batchSize ?? 64;
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (texts.length <= this.batchSize) {
      return this.embedBatch(texts);
    }
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const batchResults = await this.embedBatch(batch);
      // Defensive: a misbehaving provider may return more vectors than
      // requested; keep result count aligned with the batch.
      results.push(...batchResults.slice(0, batch.length));
    }
    return results;
  }

  private async embedBatch(batch: readonly string[]): Promise<number[][]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: batch,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 429) {
          throw new EmbeddingError('rate_limited', 'Embedding request was rate limited (429)', response.status);
        }
        throw new EmbeddingError('http', `Embedding request failed with ${response.status}`, response.status);
      }
      const payload = (await response.json()) as {
        data?: Array<{ embedding?: number[]; index?: number }>;
        model?: string;
        error?: { message?: string };
      };
      if (payload.error?.message) {
        throw new EmbeddingError('invalid_response', payload.error.message);
      }
      if (!Array.isArray(payload.data)) {
        throw new EmbeddingError('invalid_response', 'Invalid response: missing data array');
      }
      const results = new Array(batch.length).fill(null).map(() => new Array(0).fill(0));
      for (const item of payload.data) {
        if (!Array.isArray(item.embedding) || typeof item.index !== 'number') continue;
        results[item.index] = item.embedding;
      }
      for (let i = 0; i < results.length; i++) {
        if (!Array.isArray(results[i]) || results[i].length === 0) {
          throw new EmbeddingError('invalid_response', `Invalid embedding at index ${i}`);
        }
      }
      return results;
    } catch (error) {
      if (error instanceof EmbeddingError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new EmbeddingError('timeout', `Embedding request timed out after ${this.timeoutMs}ms`);
      }
      throw new EmbeddingError('network', error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timer);
    }
  }
}

// ----- Text normalization -----

const CHINESE_CHAR_REGEX = /[\u4e00-\u9fa5]/;
const WORD_REGEX = /[a-zA-Z0-9]+/g;
const IGNORE_REGEX = /[\s\x00-\x1f\x7f-\x9f\xad\u2000-\u2fff\u3000-\u303f\uff00-\uffef]+/g;

function normalizeText(text: string): string {
  if (!text) return '';
  let result = text.toLowerCase();
  result = result.replace(IGNORE_REGEX, ' ');
  result = result.trim();
  return result;
}

function extractNgrams(text: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (CHINESE_CHAR_REGEX.test(c)) {
      // Chinese character as unigram
      tokens.push(c);
      // Bigram with previous character if exists
      if (i > 0 && CHINESE_CHAR_REGEX.test(text[i - 1])) {
        tokens.push(text.slice(i - 1, i + 1));
      }
      i++;
    } else {
      // Non-Chinese: extract words
      const match = text.slice(i).match(WORD_REGEX);
      if (match && match.index !== undefined) {
        const word = match[0];
        tokens.push(word);
        // Bigram with previous token if available and not whitespace
        if (tokens.length > 1 && tokens[tokens.length - 1] === word) {
          const prev = tokens[tokens.length - 2];
          if (!/\s/.test(prev) && !/\s/.test(word)) {
            tokens.push(prev + word);
          }
        }
        i += match.index + word.length;
      } else {
        i++;
      }
    }
  }
  return tokens;
}

// ----- Hashing -----

function fnv1a32(str: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    hash ^= c;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// ----- Vector normalization -----

function l2Normalize(vector: number[]): number[] {
  let sum = 0;
  for (const v of vector) sum += v * v;
  const norm = Math.sqrt(sum);
  if (norm === 0) return vector.map(() => 0);
  return vector.map((v) => v / norm);
}