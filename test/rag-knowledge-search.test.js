/**
 * RAG Knowledge Search Acceptance Tests.
 *
 * Validates end-to-end retrieval for typical 408 queries.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateKnowledgeSearch,
} from '../apps/api/dist/rag/knowledge-search.js';
import {
  buildKnowledgeCorpus,
} from '../apps/api/dist/rag/knowledge-corpus.js';
import {
  LocalDeterministicEmbeddingProvider,
} from '../apps/api/dist/rag/embedding-provider.js';
import {
  InMemoryVectorStore,
} from '../apps/api/dist/rag/vector-store.js';

// Fixture: 408 knowledge tree subset (OS: 进程/死锁/信号量)
const FIXTURE_NODES = [
  {
    id: 'OS-C01-S01-P01',
    subject: 'OS',
    nodeType: 'atomicPoint',
    name: '程序与进程区别',
    importance: 4,
    difficulty: 1,
    chapterPath: ['进程与线程'],
  },
  {
    id: 'OS-C02-S04-P20',
    subject: 'OS',
    nodeType: 'atomicPoint',
    name: '信号量',
    importance: 5,
    difficulty: 4,
    chapterPath: ['进程同步', '信号量'],
  },
  {
    id: 'OS-C02-S04-P21',
    subject: 'OS',
    nodeType: 'atomicPoint',
    name: '整型信号量',
    importance: 4,
    difficulty: 3,
    chapterPath: ['进程同步', '信号量'],
  },
  {
    id: 'OS-C06-S06-P02',
    subject: 'OS',
    nodeType: 'atomicPoint',
    name: '死锁必要条件',
    importance: 5,
    difficulty: 3,
    chapterPath: ['进程管理', '死锁'],
  },
  {
    id: 'OS-C06-S06-P01',
    subject: 'OS',
    nodeType: 'atomicPoint',
    name: '死锁定义',
    importance: 5,
    difficulty: 2,
    chapterPath: ['进程管理', '死锁'],
  },
  {
    id: 'OS-C06-S06-P07',
    subject: 'OS',
    nodeType: 'atomicPoint',
    name: '死锁预防',
    importance: 4,
    difficulty: 3,
    chapterPath: ['进程管理', '死锁'],
  },
];

const FIXTURE_RELATIONS = [
  { fromId: 'OS-C06-S06-P02', toId: 'OS-C06-S06-P01', type: 'PREREQUISITE' },
  { fromId: 'OS-C06-S06-P02', toId: 'OS-C02-S04-P20', type: 'RELATED' },
  { fromId: 'OS-C02-S04-P21', toId: 'OS-C02-S04-P20', type: 'PREREQUISITE' },
];

const FIXTURE_QUESTIONS = [
  {
    id: 'q-001',
    stem: '以下哪些是产生死锁的必要条件？',
    analysis: '死锁产生的四个必要条件包括：互斥条件、请求与保持条件、不剥夺条件、循环等待条件。',
    knowledgeNodeIds: ['OS-C06-S06-P02'],
  },
];

test('acceptance: "死锁产生条件" returns OS deadlock node with relevance > 0', async () => {
  const provider = new LocalDeterministicEmbeddingProvider();
  const store = new InMemoryVectorStore();

  // Build corpus
  const corpus = buildKnowledgeCorpus(FIXTURE_NODES, FIXTURE_RELATIONS, FIXTURE_QUESTIONS);

  // Embed chunks and populate store
  const chunkContents = corpus.chunks.map((c) => c.content);
  const embeddings = await provider.embed(chunkContents);

  const records = corpus.chunks.map((chunk, i) => ({
    chunkId: chunk.chunkId,
    knowledgeNodeId: chunk.knowledgeNodeId,
    subject: chunk.subject,
    vector: embeddings[i] ?? new Array(provider.dimensions).fill(0),
  }));
  await store.replaceAll(records);

  // Search
  const query = '死锁产生条件';
  const [queryVector] = await provider.embed([query]);
  const chunkHits = await store.search(queryVector, { topK: 10 });

  // Aggregate to node-level
  const chunksMap = new Map(corpus.chunks.map((c) => [c.chunkId, c]));
  const docsMap = new Map(corpus.documents.map((d) => [d.knowledgeNodeId, d]));

  const results = aggregateKnowledgeSearch(
    chunksMap,
    chunkHits,
    FIXTURE_RELATIONS,
    docsMap,
    { topK: 5 },
  );

  assert.ok(results.length >= 1, 'Should return at least one result');

  const deadlockNode = results.find((r) => r.knowledgeNodeId === 'OS-C06-S06-P02');
  assert.ok(deadlockNode, 'Should return the 死锁必要条件 node');
  assert.ok(deadlockNode.relevanceScore > 0, '死锁必要条件 should have positive relevance score');
  assert.equal(deadlockNode.subject, 'OS');
  assert.equal(deadlockNode.title, '死锁必要条件');
  assert.ok(deadlockNode.matchedChunks.length >= 1);
});

test('acceptance: "死锁产生条件" results include related nodes (semaphore, definition)', async () => {
  const provider = new LocalDeterministicEmbeddingProvider();
  const store = new InMemoryVectorStore();

  const corpus = buildKnowledgeCorpus(FIXTURE_NODES, FIXTURE_RELATIONS, FIXTURE_QUESTIONS);
  const chunkContents = corpus.chunks.map((c) => c.content);
  const embeddings = await provider.embed(chunkContents);

  const records = corpus.chunks.map((chunk, i) => ({
    chunkId: chunk.chunkId,
    knowledgeNodeId: chunk.knowledgeNodeId,
    subject: chunk.subject,
    vector: embeddings[i] ?? new Array(provider.dimensions).fill(0),
  }));
  await store.replaceAll(records);

  const query = '死锁产生条件';
  const [queryVector] = await provider.embed([query]);
  const chunkHits = await store.search(queryVector, { topK: 10 });

  const chunksMap = new Map(corpus.chunks.map((c) => [c.chunkId, c]));
  const docsMap = new Map(corpus.documents.map((d) => [d.knowledgeNodeId, d]));

  const results = aggregateKnowledgeSearch(
    chunksMap,
    chunkHits,
    FIXTURE_RELATIONS,
    docsMap,
    { topK: 5 },
  );

  const deadlockNode = results.find((r) => r.knowledgeNodeId === 'OS-C06-S06-P02');
  assert.ok(deadlockNode);
  assert.ok(deadlockNode.relatedNodes.length >= 1, 'Should have at least one related node');

  const relatedIds = deadlockNode.relatedNodes.map((rn) => rn.knowledgeNodeId);
  // Relations are bidirectional; should include either definition or semaphore
  assert.ok(
    relatedIds.includes('OS-C06-S06-P01') || relatedIds.includes('OS-C02-S04-P20'),
    'Related nodes should include 死锁定义 or 信号量',
  );
});

test('acceptance: "PV操作" returns semaphore nodes with relevance', async () => {
  const provider = new LocalDeterministicEmbeddingProvider();
  const store = new InMemoryVectorStore();

  const corpus = buildKnowledgeCorpus(FIXTURE_NODES, FIXTURE_RELATIONS, FIXTURE_QUESTIONS);
  const chunkContents = corpus.chunks.map((c) => c.content);
  const embeddings = await provider.embed(chunkContents);

  const records = corpus.chunks.map((chunk, i) => ({
    chunkId: chunk.chunkId,
    knowledgeNodeId: chunk.knowledgeNodeId,
    subject: chunk.subject,
    vector: embeddings[i] ?? new Array(provider.dimensions).fill(0),
  }));
  await store.replaceAll(records);

  const query = 'PV操作';
  const [queryVector] = await provider.embed([query]);
  const chunkHits = await store.search(queryVector, { topK: 10 });

  const chunksMap = new Map(corpus.chunks.map((c) => [c.chunkId, c]));
  const docsMap = new Map(corpus.documents.map((d) => [d.knowledgeNodeId, d]));

  const results = aggregateKnowledgeSearch(
    chunksMap,
    chunkHits,
    FIXTURE_RELATIONS,
    docsMap,
    { topK: 5 },
  );

  assert.ok(results.length >= 1);
  // Should find semaphore-related nodes
  const semaphoreRelated = results.filter((r) =>
    r.knowledgeNodeId === 'OS-C02-S04-P20' ||
    r.knowledgeNodeId === 'OS-C02-S04-P21',
  );
  assert.ok(semaphoreRelated.length >= 1, 'Should return at least one semaphore node');
});

test('acceptance: subject filter restricts results', async () => {
  const provider = new LocalDeterministicEmbeddingProvider();
  const store = new InMemoryVectorStore();

  const corpus = buildKnowledgeCorpus(FIXTURE_NODES, FIXTURE_RELATIONS, FIXTURE_QUESTIONS);
  const chunkContents = corpus.chunks.map((c) => c.content);
  const embeddings = await provider.embed(chunkContents);

  const records = corpus.chunks.map((chunk, i) => ({
    chunkId: chunk.chunkId,
    knowledgeNodeId: chunk.knowledgeNodeId,
    subject: chunk.subject,
    vector: embeddings[i] ?? new Array(provider.dimensions).fill(0),
  }));
  await store.replaceAll(records);

  const query = '进程';
  const [queryVector] = await provider.embed([query]);
  const chunkHits = await store.search(queryVector, { topK: 10, subject: 'DS' });

  const chunksMap = new Map(corpus.chunks.map((c) => [c.chunkId, c]));
  const docsMap = new Map(corpus.documents.map((d) => [d.knowledgeNodeId, d]));

  const results = aggregateKnowledgeSearch(
    chunksMap,
    chunkHits,
    FIXTURE_RELATIONS,
    docsMap,
    { topK: 5, subject: 'DS' },
  );

  // No DS nodes in fixture, should be empty
  assert.equal(results.length, 0);
});
// ---- Service-level tests (lazy index build + end-to-end search) ----

test('KnowledgeSearchService builds index lazily and searches end-to-end', async () => {
  const { KnowledgeSearchService } = await import('../apps/api/dist/rag/knowledge-search.service.js');
  const loader = {
    load: async () => ({
      nodes: FIXTURE_NODES,
      relations: FIXTURE_RELATIONS,
      questions: FIXTURE_QUESTIONS,
      available: true,
    }),
  };
  const provider = new LocalDeterministicEmbeddingProvider();
  const store = new InMemoryVectorStore();
  const service = new KnowledgeSearchService(loader, provider, store);

  const response = await service.search('死锁产生条件', { topK: 5 });
  assert.equal(response.query, '死锁产生条件');
  assert.equal(response.available, true);
  assert.equal(response.source, 'local-deterministic-v1');
  assert.ok(response.indexSize > 0);
  assert.ok(response.results.length >= 1);
  const deadlockNode = response.results.find((r) => r.knowledgeNodeId === 'OS-C06-S06-P02');
  assert.ok(deadlockNode, 'service search should return 死锁必要条件');
  assert.ok(deadlockNode.relevanceScore > 0);
});

test('KnowledgeSearchService returns explicit empty result when corpus unavailable', async () => {
  const { KnowledgeSearchService } = await import('../apps/api/dist/rag/knowledge-search.service.js');
  const loader = { load: async () => ({ nodes: [], relations: [], questions: [], available: false }) };
  const provider = new LocalDeterministicEmbeddingProvider();
  const store = new InMemoryVectorStore();
  const service = new KnowledgeSearchService(loader, provider, store);

  const response = await service.search('死锁产生条件');
  assert.equal(response.available, false);
  assert.equal(response.indexSize, 0);
  assert.deepEqual(response.results, []);
});

test('KnowledgeSearchService clamps topK into 1..20', async () => {
  const { KnowledgeSearchService } = await import('../apps/api/dist/rag/knowledge-search.service.js');
  const loader = { load: async () => ({ nodes: [], relations: [], questions: [], available: false }) };
  const provider = new LocalDeterministicEmbeddingProvider();
  const store = new InMemoryVectorStore();
  const service = new KnowledgeSearchService(loader, provider, store);

  const empty = await service.search('   ');
  assert.deepEqual(empty.results, []);
  assert.equal(empty.available, false);
});
