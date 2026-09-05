/**
 * AI Evaluation — Retrieval accuracy suite (Phase AI-11).
 *
 * Fixed evaluation set over a realistic 408 knowledge-tree fixture:
 * - retrieval accuracy: top-3 must contain the expected node
 * - irrelevant rejection: off-domain queries must not score high
 *
 * Uses the V2 pipeline (rewrite + hybrid + graph) with the deterministic
 * local embedding provider — fully reproducible.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildKnowledgeCorpus } from '../apps/api/dist/rag/knowledge-corpus.js';
import { LocalDeterministicEmbeddingProvider } from '../apps/api/dist/rag/embedding-provider.js';
import { InMemoryVectorStore } from '../apps/api/dist/rag/vector-store.js';
import { aggregateKnowledgeSearch } from '../apps/api/dist/rag/knowledge-search.js';
import { rewriteQuery } from '../apps/api/dist/rag/learning-rag.js';

const NODES = [
  { id: 'DS-C02-S02-P01', subject: 'DS', nodeType: 'atomicPoint', name: '链表插入删除', importance: 5, difficulty: 3, chapterPath: ['线性表', '链表'] },
  { id: 'DS-C04-S01-P02', subject: 'DS', nodeType: 'atomicPoint', name: '二叉树遍历', importance: 5, difficulty: 3, chapterPath: ['树与二叉树'] },
  { id: 'DS-C06-S03-P01', subject: 'DS', nodeType: 'atomicPoint', name: '快速排序', importance: 5, difficulty: 4, chapterPath: ['排序'] },
  { id: 'CO-C05-S02-P03', subject: 'CO', nodeType: 'atomicPoint', name: '指令流水线', importance: 5, difficulty: 4, chapterPath: ['中央处理器'] },
  { id: 'CO-C07-S01-P01', subject: 'CO', nodeType: 'atomicPoint', name: '中断处理', importance: 4, difficulty: 3, chapterPath: ['输入输出系统'] },
  { id: 'OS-C02-S04-P20', subject: 'OS', nodeType: 'atomicPoint', name: '信号量', importance: 5, difficulty: 4, chapterPath: ['进程同步', '信号量'] },
  { id: 'OS-C02-S05-P08', subject: 'OS', nodeType: 'atomicPoint', name: '同步PV综合设计', importance: 5, difficulty: 5, chapterPath: ['进程同步', '经典问题'] },
  { id: 'OS-C06-S06-P02', subject: 'OS', nodeType: 'atomicPoint', name: '死锁必要条件', importance: 5, difficulty: 3, chapterPath: ['进程管理', '死锁'] },
  { id: 'OS-C09-S02-P01', subject: 'OS', nodeType: 'atomicPoint', name: '页面置换算法', importance: 5, difficulty: 3, chapterPath: ['内存管理', '虚拟内存'] },
  { id: 'CN-TCP-S02-P01', subject: 'CN', nodeType: 'atomicPoint', name: 'TCP拥塞控制', importance: 5, difficulty: 4, chapterPath: ['传输层'] },
  { id: 'CN-TCP-S01-P01', subject: 'CN', nodeType: 'atomicPoint', name: 'TCP三次握手', importance: 5, difficulty: 2, chapterPath: ['传输层'] },
  { id: 'CN-IP-S01-P02', subject: 'CN', nodeType: 'atomicPoint', name: 'IP地址分类', importance: 4, difficulty: 2, chapterPath: ['网络层'] },
];

const RELATIONS = [
  { fromId: 'OS-C06-S06-P02', toId: 'OS-C02-S04-P20', type: 'RELATED' },
  { fromId: 'OS-C02-S05-P08', toId: 'OS-C02-S04-P20', type: 'PREREQUISITE' },
  { fromId: 'CN-TCP-S02-P01', toId: 'CN-TCP-S01-P01', type: 'RELATED' },
];

/** [query, expected knowledgeNodeId] — 12 cases across all four subjects. */
const RETRIEVAL_CASES = [
  ['死锁产生条件', 'OS-C06-S06-P02'],
  ['死锁的四个必要条件是什么', 'OS-C06-S06-P02'],
  ['PV不会', 'OS-C02-S04-P20'],
  ['信号量机制怎么用', 'OS-C02-S04-P20'],
  ['页面置换算法有哪些', 'OS-C09-S02-P01'],
  ['快速排序的时间复杂度', 'DS-C06-S03-P01'],
  ['二叉树怎么遍历', 'DS-C04-S01-P02'],
  ['链表的插入操作', 'DS-C02-S02-P01'],
  ['指令流水线冒险', 'CO-C05-S02-P03'],
  ['中断处理过程', 'CO-C07-S01-P01'],
  ['TCP拥塞控制的慢启动', 'CN-TCP-S02-P01'],
  ['三次握手的过程', 'CN-TCP-S01-P01'],
];

const IRRELEVANT_QUERIES = ['今天天气怎么样', '晚饭吃什么好', '股票行情如何'];

async function buildEvalIndex() {
  const provider = new LocalDeterministicEmbeddingProvider();
  const store = new InMemoryVectorStore();
  const corpus = buildKnowledgeCorpus(NODES, RELATIONS, []);
  const embeddings = await provider.embed(corpus.chunks.map((chunk) => chunk.content));
  await store.replaceAll(corpus.chunks.map((chunk, index) => ({
    chunkId: chunk.chunkId,
    knowledgeNodeId: chunk.knowledgeNodeId,
    subject: chunk.subject,
    vector: embeddings[index] ?? new Array(provider.dimensions).fill(0),
  })));
  return { provider, store, corpus };
}

test('retrieval accuracy: 12/12 fixed queries hit expected node in top-3', async () => {
  const { provider, store, corpus } = await buildEvalIndex();
  const chunksMap = new Map(corpus.chunks.map((chunk) => [chunk.chunkId, chunk]));
  const docsMap = new Map(corpus.documents.map((doc) => [doc.knowledgeNodeId, doc]));

  const misses = [];
  for (const [query, expectedId] of RETRIEVAL_CASES) {
    const rewrite = rewriteQuery(query);
    const [vector] = await provider.embed([rewrite.expanded]);
    const hits = await store.search(vector, { topK: 12 });
    const results = aggregateKnowledgeSearch(chunksMap, hits, RELATIONS, docsMap, { topK: 3 });
    const hit = results.slice(0, 3).some((result) => result.knowledgeNodeId === expectedId);
    if (!hit) {
      misses.push({ query, expectedId, got: results.slice(0, 3).map((result) => result.knowledgeNodeId) });
    }
  }
  assert.deepEqual(misses, []);
});

test('irrelevant rejection: off-domain queries score below 0.25 relevance', async () => {
  const { provider, store, corpus } = await buildEvalIndex();
  const chunksMap = new Map(corpus.chunks.map((chunk) => [chunk.chunkId, chunk]));
  const docsMap = new Map(corpus.documents.map((doc) => [doc.knowledgeNodeId, doc]));

  for (const query of IRRELEVANT_QUERIES) {
    const [vector] = await provider.embed([query]);
    const hits = await store.search(vector, { topK: 5 });
    const results = aggregateKnowledgeSearch(chunksMap, hits, RELATIONS, docsMap, { topK: 1 });
    const topScore = results[0]?.relevanceScore ?? 0;
    assert.ok(
      topScore < 0.25,
      `irrelevant query "${query}" top score ${topScore} should be < 0.25`,
    );
  }
});

test('relevance ordering: closer paraphrase ranks above unrelated node', async () => {
  const { provider, store, corpus } = await buildEvalIndex();
  const chunksMap = new Map(corpus.chunks.map((chunk) => [chunk.chunkId, chunk]));
  const docsMap = new Map(corpus.documents.map((doc) => [doc.knowledgeNodeId, doc]));
  const [vector] = await provider.embed(['死锁必要条件']);
  const hits = await store.search(vector, { topK: 12 });
  const results = aggregateKnowledgeSearch(chunksMap, hits, RELATIONS, docsMap, { topK: 5 });
  const deadlockRank = results.findIndex((result) => result.knowledgeNodeId === 'OS-C06-S06-P02');
  const ipRank = results.findIndex((result) => result.knowledgeNodeId === 'CN-IP-S01-P02');
  assert.ok(deadlockRank >= 0);
  if (ipRank >= 0) assert.ok(deadlockRank < ipRank);
});