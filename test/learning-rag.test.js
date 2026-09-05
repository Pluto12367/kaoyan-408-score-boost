/**
 * Learning RAG V2 Tests (Phase AI-8).
 *
 * Covers the four V2 capabilities as pure functions and the orchestrated
 * service, plus the V2 HTTP route contract. V1 behavior must remain
 * untouched (regression files keep passing unchanged).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  rewriteQuery,
  keywordOverlap,
  hybridScore,
  expandWithGraph,
  applyDifficultyAwareness,
} from '../apps/api/dist/rag/learning-rag.js';
import { LearningRagService } from '../apps/api/dist/rag/learning-rag.service.js';

// ---- 1. Query rewrite ----

test('rewrite: "PV不会" expands to PV/信号量/同步 terms', () => {
  const rewrite = rewriteQuery('PV不会');
  assert.equal(rewrite.original, 'PV不会');
  assert.ok(rewrite.expanded.includes('PV不会'));
  assert.ok(rewrite.addedTerms.includes('PV操作'));
  assert.ok(rewrite.addedTerms.includes('信号量'));
  // Colloquial hit recorded for intent; generic words stay out of retrieval
  assert.ok(!rewrite.addedTerms.includes('概念'));
  assert.ok(rewrite.appliedRules.length >= 2);
});

test('rewrite: "死锁产生条件" keeps original and adds deadlock family terms', () => {
  const rewrite = rewriteQuery('死锁产生条件');
  assert.ok(rewrite.addedTerms.includes('死锁必要条件'));
  assert.ok(rewrite.expanded.startsWith('死锁产生条件'));
});

test('rewrite: plain technical query without rules stays unchanged', () => {
  const rewrite = rewriteQuery('TCP 拥塞控制');
  // TCP rule applies, but no colloquial rules
  assert.ok(rewrite.addedTerms.includes('三次握手'));
  assert.ok(!rewrite.addedTerms.includes('概念'));
});

test('rewrite: empty query is safe', () => {
  const rewrite = rewriteQuery('   ');
  assert.equal(rewrite.original, '');
  assert.equal(rewrite.expanded, '');
  assert.equal(rewrite.addedTerms.length, 0);
});

test('rewrite: colloquial phrases are detected but do NOT inject generic terms into retrieval', () => {
  // v3.4 finding: injecting 概念/定义 for "是什么" pollutes real-corpus
  // retrieval (every "XX定义" node gains keyword affinity). Colloquial hits
  // stay in appliedRules (intent signal) but expansion stays term-only.
  const rewrite = rewriteQuery('TLB快表的作用是什么');
  assert.equal(rewrite.expanded, 'TLB快表的作用是什么');
  assert.equal(rewrite.addedTerms.length, 0);
  assert.ok(rewrite.appliedRules.length >= 1, 'colloquial hit still recorded for intent');
  // Term expansion keeps working for technical phrases.
  const technical = rewriteQuery('PV不会');
  assert.ok(technical.addedTerms.includes('PV操作'));
  assert.ok(technical.addedTerms.includes('信号量'));
});

// ---- 2. Hybrid retrieval ----

test('keywordOverlap: high overlap for related text, zero for disjoint', () => {
  const related = keywordOverlap('死锁条件', '死锁的四个必要条件是什么');
  assert.ok(related > 0.8, `related should score high, got ${related}`);
  assert.equal(keywordOverlap('死锁条件', '计算机网络的分层结构'), 0);
  assert.equal(keywordOverlap('', '任意文本'), 0);
});

test('hybridScore fuses vector, keyword and title signals with fixed weights', () => {
  const strong = hybridScore('死锁必要条件', {
    vectorScore: 0.8, title: '死锁必要条件', chapterPath: ['进程管理', '死锁'], contents: ['死锁产生的四个必要条件'],
  });
  const weak = hybridScore('死锁必要条件', {
    vectorScore: 0.3, title: '无向图', chapterPath: ['图'], contents: ['图的存储结构'],
  });
  assert.ok(strong.finalScore > weak.finalScore);
  assert.equal(strong.titleBoost, 1);
  assert.equal(weak.titleBoost, 0);
  // Weights: 0.65*v + 0.30*k + 0.05*t
  assert.ok(Math.abs(strong.finalScore - (0.65 * 0.8 + 0.30 * 1 + 0.05 * 1)) < 0.01);
});

// ---- 3. Graph expansion ----

test('expandWithGraph appends deduped 1-hop neighbours at half seed score', () => {
  const nodes = new Map([
    ['pv', { title: 'PV操作', subject: 'OS' }],
    ['sem', { title: '信号量', subject: 'OS' }],
    ['sync', { title: '进程同步', subject: 'OS' }],
    ['dl', { title: '死锁', subject: 'OS' }],
  ]);
  const relations = [
    { fromId: 'pv', toId: 'sem', type: 'RELATED' },
    { fromId: 'sync', toId: 'pv', type: 'PREREQUISITE' },
    { fromId: 'pv', toId: 'dl', type: 'RELATED' },
    { fromId: 'pv', toId: 'future', type: 'RELATED' },
  ];
  const expansions = expandWithGraph(
    [{ knowledgeNodeId: 'pv', subject: 'OS', title: 'PV操作', score: 0.8 }],
    relations,
    nodes,
  );
  // 3 max per seed; 'future' has no metadata but still expands with id as title
  assert.equal(expansions.length, 3);
  const sem = expansions.find((node) => node.knowledgeNodeId === 'sem');
  assert.ok(sem);
  assert.equal(sem.score, 0.4);
  assert.equal(sem.source, 'graph_expansion');
  assert.equal(sem.reachedFrom, 'pv');
  assert.equal(sem.relationType, 'RELATED');
  // seed itself never appears as expansion
  assert.ok(!expansions.some((node) => node.knowledgeNodeId === 'pv'));
});

// ---- 4. Difficulty awareness ----

test('difficulty: mastered nodes are penalised, weak+hard gently demoted, rest untouched', () => {
  const adjusted = applyDifficultyAwareness(
    [
      { knowledgeNodeId: 'mastered-node', score: 0.9 },
      { knowledgeNodeId: 'weak-hard-node', score: 0.8 },
      { knowledgeNodeId: 'normal-node', score: 0.7 },
    ],
    new Map([['mastered-node', 0.9], ['weak-hard-node', 0.3]]),
    new Map([['weak-hard-node', 5]]),
  );
  assert.equal(adjusted.get('mastered-node').adjustment, 'mastered_down');
  assert.ok(Math.abs(adjusted.get('mastered-node').adjustedScore - 0.63) < 0.001);
  assert.equal(adjusted.get('weak-hard-node').adjustment, 'weak_basic_up');
  assert.ok(Math.abs(adjusted.get('weak-hard-node').adjustedScore - 0.72) < 0.001);
  assert.equal(adjusted.get('normal-node').adjustment, 'none');
  assert.equal(adjusted.get('normal-node').adjustedScore, 0.7);
});

// ---- 5. Orchestrated service ----

function v1Result(overrides = {}) {
  return {
    knowledgeNodeId: 'OS-C06-S06-P02',
    subject: 'OS',
    nodeType: 'atomicPoint',
    title: '死锁必要条件',
    chapterPath: ['进程管理', '死锁'],
    relevanceScore: 0.8,
    matchedChunks: [{ chunkId: 'c1', kind: 'node_overview', content: '死锁 死锁必要条件 互斥 请求保持' }],
    relatedNodes: [{ knowledgeNodeId: 'OS-C06-S06-P01', title: '死锁定义', relationType: 'PREREQUISITE' }],
    ...overrides,
  };
}

function createService(overrides = {}) {
  const calls = [];
  const knowledgeSearch = {
    search: async (query, options) => {
      calls.push({ query, options });
      return {
        query,
        source: 'local-deterministic-v1',
        indexSize: 100,
        available: overrides.available ?? true,
        results: overrides.results ?? [v1Result()],
      };
    },
    getGraphSnapshot: async () => overrides.graph ?? {
      relations: [
        { fromId: 'OS-C06-S06-P02', toId: 'OS-C06-S06-P01', type: 'PREREQUISITE' },
        { fromId: 'OS-C06-S06-P02', toId: 'OS-C02-S04-P20', type: 'RELATED' },
      ],
      nodes: new Map([
        ['OS-C06-S06-P02', { title: '死锁必要条件', subject: 'OS', difficulty: 3 }],
        ['OS-C06-S06-P01', { title: '死锁定义', subject: 'OS', difficulty: 2 }],
        ['OS-C02-S04-P20', { title: '信号量', subject: 'OS', difficulty: 4 }],
      ]),
    },
  };
  const events = [];
  const service = new LearningRagService(knowledgeSearch, (event) => events.push(event));
  return { service, calls, events };
}

test('service pipeline: rewrite + hybrid + graph expansion run end-to-end', async () => {
  const { service, calls } = createService();
  const response = await service.search('死锁产生条件', { topK: 3 });

  // Expanded query drove the V1 search
  assert.ok(calls[0].query.includes('死锁必要条件'));
  assert.equal(response.query, '死锁产生条件');
  assert.ok(response.rewrittenQuery.expanded.includes('死锁必要条件'));
  assert.equal(response.pipeline.rewriteApplied, true);
  assert.equal(response.pipeline.hybridApplied, true);

  const seed = response.results.find((node) => node.source === 'seed');
  assert.ok(seed);
  assert.ok(seed.keywordScore > 0);
  // graph expansions appended below seeds
  const expansion = response.results.find((node) => node.source === 'graph_expansion');
  assert.ok(expansion, 'graph expansion should add related nodes');
  assert.ok(['OS-C06-S06-P01', 'OS-C02-S04-P20'].includes(expansion.knowledgeNodeId));
  assert.ok(response.pipeline.expansionCount >= 1);
  // difficulty not applied without mastery input
  assert.equal(response.pipeline.difficultyApplied, false);
});

test('service pipeline: difficulty awareness applies with StudentContext mastery', async () => {
  const { service } = createService();
  const response = await service.search('死锁产生条件', {
    topK: 3,
    studentMastery: [{ knowledgeNodeId: 'OS-C06-S06-P02', mastery: 0.9 }],
  });
  assert.equal(response.pipeline.difficultyApplied, true);
  const seed = response.results.find((node) => node.source === 'seed');
  assert.equal(seed.adjustment, 'mastered_down');
  assert.ok(seed.relevanceScore < 0.8 * 0.65 + 0.31); // penalised vs fused ceiling
});

test('service: empty query returns explicit unavailable response without searching', async () => {
  const { service, calls } = createService();
  const response = await service.search('   ');
  assert.equal(calls.length, 0);
  assert.equal(response.available, false);
  assert.deepEqual(response.results, []);
});

test('service: emits search event for observability', async () => {
  const { service, events } = createService();
  await service.search('死锁产生条件', { topK: 2 });
  assert.equal(events.length, 1);
  assert.equal(events[0].query, '死锁产生条件');
  assert.ok(events[0].durationMs >= 0);
});

// ---- HTTP route contract ----

test('V2 route exists with guard and mastery param validation; V1 route untouched', async () => {
  const source = await readFile(new URL('../apps/api/src/rag/rag.controller.ts', import.meta.url), 'utf8');
  assert.match(source, /Get\('rag\/knowledge\/v2\/search'\)/);
  assert.match(source, /mastery must be "nodeId:score" pairs/);
  assert.match(source, /Get\('rag\/knowledge\/search'\)/);
  // V1 constructor dependency kept intact
  assert.match(source, /private readonly knowledgeSearch: KnowledgeSearchService/);
  assert.match(source, /private readonly learningRag: LearningRagService/);
});

test('RagModule provides and exports LearningRagService', async () => {
  const source = await readFile(new URL('../apps/api/src/rag/rag.module.ts', import.meta.url), 'utf8');
  assert.match(source, /LearningRagService/);
  assert.match(source, /exports:\s*\[KnowledgeSearchService,\s*KnowledgeRetriever,\s*LearningRagService\]/);
});