/**
 * RAG Vector Store Tests.
 *
 * Tests the in-memory vector store with cosine similarity search.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryVectorStore } from '../apps/api/dist/rag/vector-store.js';

test('vector store starts empty', async () => {
  const store = new InMemoryVectorStore();
  assert.equal(store.size, 0);
});

test('vector store replaces all records correctly', async () => {
  const store = new InMemoryVectorStore();
  await store.replaceAll([
    { chunkId: 'c1', knowledgeNodeId: 'n1', subject: 'DS', vector: [1, 0] },
    { chunkId: 'c2', knowledgeNodeId: 'n2', subject: 'CO', vector: [0, 1] },
  ]);
  assert.equal(store.size, 2);
});

test('vector store returns exact match as top hit', async () => {
  const store = new InMemoryVectorStore();
  await store.replaceAll([
    { chunkId: 'c1', knowledgeNodeId: 'n1', subject: 'OS', vector: [1, 0] },
    { chunkId: 'c2', knowledgeNodeId: 'n2', subject: 'OS', vector: [0, 1] },
  ]);
  const hits = await store.search([1, 0], { topK: 1 });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].chunkId, 'c1');
  assert.ok(hits[0].score > 0.99);
});

test('vector store orders by descending similarity', async () => {
  const store = new InMemoryVectorStore();
  await store.replaceAll([
    { chunkId: 'c1', knowledgeNodeId: 'n1', subject: 'OS', vector: [1, 0, 0] },
    { chunkId: 'c2', knowledgeNodeId: 'n2', subject: 'OS', vector: [0.8, 0.6, 0] },
    { chunkId: 'c3', knowledgeNodeId: 'n3', subject: 'OS', vector: [0, 0, 1] },
  ]);
  const hits = await store.search([1, 0, 0], { topK: 3 });
  assert.equal(hits.length, 3);
  assert.equal(hits[0].chunkId, 'c1');
  assert.equal(hits[1].chunkId, 'c2');
  assert.ok(hits[0].score > hits[1].score);
  assert.ok(hits[1].score > hits[2].score);
});

test('vector store filters by subject', async () => {
  const store = new InMemoryVectorStore();
  await store.replaceAll([
    { chunkId: 'c1', knowledgeNodeId: 'n1', subject: 'OS', vector: [1, 0] },
    { chunkId: 'c2', knowledgeNodeId: 'n2', subject: 'DS', vector: [1, 0] },
    { chunkId: 'c3', knowledgeNodeId: 'n3', subject: 'OS', vector: [0, 1] },
  ]);
  const hits = await store.search([1, 0], { topK: 10, subject: 'OS' });
  assert.equal(hits.length, 2);
  assert.equal(hits[0].chunkId, 'c1');
  assert.equal(hits[1].chunkId, 'c3');
});

test('vector store handles zero vectors gracefully', async () => {
  const store = new InMemoryVectorStore();
  await store.replaceAll([
    { chunkId: 'c1', knowledgeNodeId: 'n1', subject: 'DS', vector: [0, 0] },
    { chunkId: 'c2', knowledgeNodeId: 'n2', subject: 'DS', vector: [1, 0] },
  ]);
  const hits = await store.search([1, 0], { topK: 2 });
  assert.equal(hits.length, 2);
  // zero vector should have score 0
  const zeroHit = hits.find((h) => h.chunkId === 'c1');
  assert.ok(zeroHit);
  assert.ok(Math.abs(zeroHit.score) < 1e-10);
});

test('vector store topK respects upper bound', async () => {
  const store = new InMemoryVectorStore();
  await store.replaceAll([
    { chunkId: 'c1', knowledgeNodeId: 'n1', subject: 'OS', vector: [0.9, 0.1] },
    { chunkId: 'c2', knowledgeNodeId: 'n2', subject: 'OS', vector: [0.8, 0.2] },
    { chunkId: 'c3', knowledgeNodeId: 'n3', subject: 'OS', vector: [0.7, 0.3] },
    { chunkId: 'c4', knowledgeNodeId: 'n4', subject: 'OS', vector: [0.6, 0.4] },
    { chunkId: 'c5', knowledgeNodeId: 'n5', subject: 'OS', vector: [0.5, 0.5] },
  ]);
  const hits = await store.search([1, 0], { topK: 2 });
  assert.equal(hits.length, 2);
  assert.ok(hits[0].score >= hits[1].score);
});