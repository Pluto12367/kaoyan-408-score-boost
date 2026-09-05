/**
 * RAG Embedding Tests.
 *
 * Tests the deterministic local embedding provider and the OpenAI-compatible provider.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LocalDeterministicEmbeddingProvider,
  OpenAICompatibleEmbeddingProvider,
  createEmbeddingProvider,
  EmbeddingError,
} from '../apps/api/dist/rag/embedding-provider.js';

test('local embedding produces deterministic results with empty text', async () => {
  const provider = new LocalDeterministicEmbeddingProvider();
  const [vec] = await provider.embed(['']);
  assert.equal(provider.dimensions, vec.length);
  assert.equal(vec.reduce((s, v) => s + v * v, 0), 0); // zero vector
});

test('local embedding produces deterministic results for same text', async () => {
  const provider = new LocalDeterministicEmbeddingProvider();
  const [vec1] = await provider.embed(['死锁产生条件']);
  const [vec2] = await provider.embed(['死锁产生条件']);
  assert.deepStrictEqual(vec1, vec2);
});

test('local embedding produces different vectors for different texts', async () => {
  const provider = new LocalDeterministicEmbeddingProvider();
  const [vec1] = await provider.embed(['死锁产生条件']);
  const [vec2] = await provider.embed(['信号量']);
  assert.notDeepStrictEqual(vec1, vec2);
});

test('local embedding vectors are L2-normalized', async () => {
  const provider = new LocalDeterministicEmbeddingProvider();
  const [vec] = await provider.embed(['操作系统进程同步机制']);
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  assert.ok(Math.abs(norm - 1) < 1e-10, `vector norm=${norm} should be 1`);
});

test('local embedding produces higher similarity for related Chinese texts', async () => {
  const provider = new LocalDeterministicEmbeddingProvider();
  const [vec1, vec2, vec3] = await provider.embed(['死锁产生条件', '死锁的四个必要条件', '信号量']);
  const sim12 = cosine(vec1, vec2);
  const sim13 = cosine(vec1, vec3);
  assert.ok(sim12 > sim13, `"死锁产生条件" vs "死锁的四个必要条件" (sim=${sim12}) should be higher than vs "信号量" (sim=${sim13})`);
});

test('openai-compatible provider throws on missing API key in options', () => {
  assert.throws(
    () => new OpenAICompatibleEmbeddingProvider({ apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'text-embedding-3-small', timeoutMs: 30000, fetchImpl: () => Promise.reject() }),
    /API key is required/,
  );
});

test('createEmbeddingProvider returns local provider when no API key', () => {
  const provider = createEmbeddingProvider({ EMBEDDING_API_KEY: '' });
  assert.equal(provider.name, 'local-deterministic-v1');
});

test('createEmbeddingProvider returns openai-compatible provider when API key set', () => {
  const provider = createEmbeddingProvider({ EMBEDDING_API_KEY: 'sk-test', EMBEDDING_BASE_URL: 'https://api.example.com/v1' });
  assert.ok(provider.name.startsWith('openai-compatible:'));
});

test('openai-compatible provider batches requests correctly', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    return {
      ok: true,
      json: async () => ({
        data: body.input.map((text, index) => ({ embedding: [text.length, index + 1], index })),
        model: 'test-model',
      }),
    };
  };
  const provider = new OpenAICompatibleEmbeddingProvider({
    apiKey: 'sk-test',
    baseUrl: 'https://api.test.com/v1',
    model: 'test-model',
    timeoutMs: 10000,
    fetchImpl,
    batchSize: 2,
  });
  const results = await provider.embed(['text1', 'text22', 'text333']);
  assert.equal(results.length, 3);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.input.length, 2);
  assert.equal(calls[1].body.input.length, 1);
  assert.deepStrictEqual(results[0], [5, 1]);
  assert.deepStrictEqual(results[1], [6, 2]);
  assert.deepStrictEqual(results[2], [7, 1]);
});

test('openai-compatible provider propagates HTTP errors as EmbeddingError', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 429,
  });
  const provider = new OpenAICompatibleEmbeddingProvider({
    apiKey: 'sk-test',
    baseUrl: 'https://api.test.com/v1',
    model: 'test-model',
    timeoutMs: 10000,
    fetchImpl,
  });
  await assert.rejects(async () => provider.embed(['text']), (err) => {
    assert.ok(err instanceof EmbeddingError);
    assert.equal(err.kind, 'rate_limited');
    assert.equal(err.status, 429);
    return true;
  });
});

test('openai-compatible provider propagates timeout errors as EmbeddingError', async () => {
  let abortCalled = false;
  const fetchImpl = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      abortCalled = true;
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      reject(error);
    });
  });
  const provider = new OpenAICompatibleEmbeddingProvider({
    apiKey: 'sk-test',
    baseUrl: 'https://api.test.com/v1',
    model: 'test-model',
    timeoutMs: 50,
    fetchImpl,
  });
  await assert.rejects(async () => provider.embed(['text']), (err) => {
    assert.ok(err instanceof EmbeddingError);
    assert.equal(err.kind, 'timeout');
    return true;
  });
  assert.ok(abortCalled);
});

test('openai-compatible provider parses response correctly', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      data: [
        { embedding: [0.5, -0.3, 0.8], index: 0 },
        { embedding: [0.2, 0.4, -0.1], index: 1 },
      ],
      model: 'text-embedding-3-small',
    }),
  });
  const provider = new OpenAICompatibleEmbeddingProvider({
    apiKey: 'sk-test',
    baseUrl: 'https://api.test.com/v1',
    model: 'text-embedding-3-small',
    timeoutMs: 10000,
    fetchImpl,
  });
  const results = await provider.embed(['a', 'b']);
  assert.equal(results.length, 2);
  assert.deepStrictEqual(results[0], [0.5, -0.3, 0.8]);
  assert.deepStrictEqual(results[1], [0.2, 0.4, -0.1]);
});

function cosine(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length && i < b.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}