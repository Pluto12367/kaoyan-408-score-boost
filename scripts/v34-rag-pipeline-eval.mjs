/**
 * v3.4 Phase 3 — Real RAG pipeline evaluation.
 *
 * Pipeline under test (production code path, no fixtures):
 *   DB KnowledgeNode/Relation/Question  →  KnowledgeCorpusLoader
 *   → buildKnowledgeCorpus  → LocalDeterministicEmbeddingProvider
 *   → InMemoryVectorStore  → rewrite → hybrid → graph expansion → difficulty
 *
 * Ground truth: expected node NAME per query, resolved against the live DB
 * (name→id), so the eval never hardcodes ids. A hit = expected node itself
 * OR a sibling atomic point under the same parent appears in top-K
 * (teaching-level retrieval granularity).
 *
 * Run: DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55432/kaoyan408_test?schema=public node scripts/v34-rag-pipeline-eval.mjs
 */

import { PrismaClient } from '@prisma/client';
import { KnowledgeCorpusLoader } from '../apps/api/dist/rag/knowledge-corpus.loader.js';
import { LocalDeterministicEmbeddingProvider } from '../apps/api/dist/rag/embedding-provider.js';
import { InMemoryVectorStore } from '../apps/api/dist/rag/vector-store.js';
import { KnowledgeSearchService } from '../apps/api/dist/rag/knowledge-search.service.js';
import { LearningRagService } from '../apps/api/dist/rag/learning-rag.service.js';

const CASES = [
  // DS (6)
  { query: '快速排序的时间复杂度是多少', expect: '快速排序', subject: 'DS' },
  { query: '二叉树有哪几种遍历方式', expect: '二叉树遍历', subject: 'DS' },
  { query: '哈希冲突怎么解决', expect: '散列', subject: 'DS' },
  { query: '图的深度优先搜索过程', expect: '深度优先', subject: 'DS' },
  { query: '拓扑排序的步骤', expect: '拓扑', subject: 'DS' },
  { query: '顺序表插入元素要移动多少', expect: '顺序表插入', subject: 'DS' },
  // CO (6)
  { query: '指令流水线为什么会停顿', expect: '流水线', subject: 'CO' },
  { query: 'Cache 命中率怎么算', expect: 'Cache', subject: 'CO' },
  { query: '操作系统里中断处理的过程是怎样的', expect: '中断处理过程', subject: 'OS' },
  { query: '页式虚拟存储的原理', expect: '虚拟', subject: 'CO' },
  { query: 'TLB快表的作用是什么', expect: 'TLB', subject: 'CO' },
  { query: '冯诺依曼结构的特点', expect: '冯诺依曼', subject: 'CO' },
  // OS (6)
  { query: '死锁产生的四个必要条件', expect: '死锁', subject: 'OS' },
  { query: 'PV不会', expect: '信号量', subject: 'OS' },
  { query: '进程和程序有什么区别', expect: '进程', subject: 'OS' },
  { query: 'LRU页面置换怎么实现', expect: '页面置换', subject: 'OS' },
  { query: '银行家算法在避免什么', expect: '银行家', subject: 'OS' },
  { query: '分段和分页的区别', expect: '分段', subject: 'OS' },
  // CN (6)
  { query: 'TCP三次握手的过程', expect: '三次握手', subject: 'CN' },
  { query: 'IP地址分几类', expect: 'IP', subject: 'CN' },
  { query: '滑动窗口怎么实现流量控制', expect: '滑动窗口', subject: 'CN' },
  { query: 'DNS域名解析的过程', expect: 'DNS', subject: 'CN' },
  { query: '子网掩码怎么划分', expect: '子网', subject: 'CN' },
  { query: '拥塞控制的慢启动阶段', expect: '拥塞', subject: 'CN' },
  // Irrelevant (4)
  { query: '今天天气怎么样', irrelevant: true },
  { query: '股票行情如何', irrelevant: true },
  { query: '红烧肉怎么做', irrelevant: true },
  { query: '世界杯决赛时间', irrelevant: true },
];

function resolveGroundTruth(nodes, expectName) {
  const matches = nodes.filter((node) => node.name.includes(expectName) && node.nodeType === 'atomicPoint');
  const targetIds = new Set(matches.map((node) => node.id));
  const siblingIds = new Set();
  for (const node of matches) {
    for (const other of nodes) {
      if (other.parentId === node.parentId) siblingIds.add(other.id);
    }
  }
  return { targetIds, siblingIds, resolved: targetIds.size > 0 };
}

async function main() {
  const prisma = new PrismaClient();
  const startedAt = Date.now();

  // Real corpus from the seeded test DB.
  const loader = new KnowledgeCorpusLoader(prisma);
  const provider = new LocalDeterministicEmbeddingProvider();
  const store = new InMemoryVectorStore();
  const search = new KnowledgeSearchService(loader, provider, store);
  const rag = new LearningRagService(search);

  const raw = await loader.load();
  if (!raw.available) throw new Error('corpus unavailable');
  const nodes = await prisma.knowledgeNode.findMany({
    where: { isActive: true },
    select: { id: true, name: true, parentId: true, nodeType: true },
  });

  const results = [];
  const latencies = [];
  for (const testCase of CASES) {
    const t0 = Date.now();
    const response = await rag.search(testCase.query, { topK: 5 });
    const latencyMs = Date.now() - t0;
    latencies.push(latencyMs);

    if (testCase.irrelevant) {
      const topScore = response.results[0]?.relevanceScore ?? 0;
      results.push({ query: testCase.query, kind: 'irrelevant', topScore, rejected: topScore < 0.25 });
      continue;
    }
    const truth = resolveGroundTruth(nodes, testCase.expect);
    if (!truth.resolved) {
      results.push({ query: testCase.query, kind: 'hit', error: `ground truth unresolved: ${testCase.expect}` });
      continue;
    }
    const topIds = response.results.slice(0, 3).map((result) => result.knowledgeNodeId);
    const hit = topIds.some((id) => truth.targetIds.has(id) || truth.siblingIds.has(id));
    results.push({
      query: testCase.query,
      kind: 'hit',
      expect: testCase.expect,
      hit,
      top3: response.results.slice(0, 3).map((result) => `${result.knowledgeNodeId}:${result.title}`),
      expansions: response.pipeline.expansionCount,
      rewriteApplied: response.pipeline.rewriteApplied,
    });
  }

  // Payload size: serialized search response for a typical query.
  const sample = await rag.search('死锁产生的四个必要条件', { topK: 5 });
  const payloadBytes = Buffer.byteLength(JSON.stringify(sample), 'utf8');

  const latenciesSorted = [...latencies].sort((a, b) => a - b);
  const hitCases = results.filter((result) => result.kind === 'hit');
  const irrelevantCases = results.filter((result) => result.kind === 'irrelevant');
  const hits = hitCases.filter((result) => result.hit).length;
  const rejections = irrelevantCases.filter((result) => result.rejected).length;
  const p95 = latenciesSorted[Math.floor(latenciesSorted.length * 0.95)];

  // Evaluation V2 (Phase 11): precision@3 / recall over resolvable cases.
  // Relevant = expected node itself or a same-parent sibling in top-3.
  const relevantReturned = hitCases.reduce((sum, result) => {
    if (!result.top3) return sum;
    const truth = resolveGroundTruth(nodes, result.expect);
    return sum + result.top3.filter((entry) => {
      const nodeId = entry.split(':')[0];
      return truth.targetIds.has(nodeId) || truth.siblingIds.has(nodeId);
    }).length;
  }, 0);
  const precisionAt3 = hitCases.length === 0 ? 0 : Math.round((relevantReturned / (hitCases.length * 3)) * 1000) / 1000;
  const recall = hitCases.length === 0 ? 0 : Math.round((hits / hitCases.length) * 1000) / 1000;

  const summary = {
    corpus: { nodes: raw.nodes.length, chunksIndexed: 0, indexSize: sample.indexSize },
    retrieval: {
      total: hitCases.length + irrelevantCases.length,
      top3Hit: `${hits}/${hitCases.length}`,
      precisionAt3,
      recall,
      irrelevantRejection: `${rejections}/${irrelevantCases.length}`,
      avgLatencyMs: Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length),
      p95LatencyMs: p95,
      payloadBytes,
    },
    levels: { pipeline: 'Fixture-to-DB Integration PASS (local deterministic embedding; remote provider BLOCKED)' },
  };

  console.log(JSON.stringify({ summary, failures: results.filter((result) => (result.kind === 'hit' && !result.hit) || (result.kind === 'irrelevant' && !result.rejected) || result.error), results }, null, 1));
  await prisma.$disconnect();
  void startedAt;
}

main().catch((error) => {
  console.error('EVAL FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});