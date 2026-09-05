/**
 * Learning RAG V2 pipeline (Phase AI-8) — pure functions.
 *
 * Upgrades Knowledge RAG V1 with four capabilities while keeping the V1
 * service contract untouched:
 *
 * 1. Query rewrite     — rule-based term expansion ("PV不会" → PV操作/信号量/同步机制...)
 * 2. Hybrid retrieval  — cosine score fused with character-n-gram keyword overlap
 * 3. Graph expansion   — 1-hop KnowledgeRelation neighbours appended below seeds
 * 4. Difficulty awareness — StudentContext mastery re-weights results
 *
 * Deterministic: no LLM, no clock, no randomness — fully unit-testable.
 */

// ---- 1. Query rewrite ----

interface RewriteRule {
  pattern: RegExp;
  expansion: string;
}

/** Curated 408 term table; deterministic and cheap. Order matters (first hit wins per alias). */
const TERM_EXPANSIONS: RewriteRule[] = [
  { pattern: /\bPV\b|PV操作|PV操作总?错?/, expansion: 'PV操作 信号量 P操作 V操作 进程同步' },
  { pattern: /信号量/, expansion: '信号量 整型信号量 记录型信号量 进程同步' },
  { pattern: /死锁/, expansion: '死锁 死锁必要条件 死锁预防 死锁避免' },
  { pattern: /\bLRU\b/i, expansion: 'LRU 最近最久未使用 页面置换' },
  { pattern: /\bFIFO\b/i, expansion: 'FIFO 先进先出 页面置换 队列' },
  { pattern: /页面置换/, expansion: '页面置换 缺页中断 虚拟内存' },
  { pattern: /\bTCP\b/i, expansion: 'TCP 传输控制 三次握手 流量控制 拥塞控制' },
  { pattern: /\bUDP\b/i, expansion: 'UDP 用户数据报 无连接' },
  { pattern: /拥塞控制/, expansion: '拥塞控制 慢启动 拥塞避免 TCP' },
  { pattern: /哈希|hash/i, expansion: '哈希 散列 冲突处理 装填因子' },
  { pattern: /二叉树/, expansion: '二叉树 遍历 性质 存储' },
  { pattern: /图的?(遍历|搜索)/, expansion: '图的遍历 DFS BFS 连通' },
  { pattern: /快速排序|\b快排\b/, expansion: '快速排序 分治 划分 时间复杂度' },
  { pattern: /流水线/, expansion: '指令流水线 数据通路 冒险 转发' },
  { pattern: /中断/, expansion: '中断 中断处理 中断向量 响应' },
  { pattern: /分页/, expansion: '分页 页表 虚拟内存 缺页' },
  { pattern: /分段/, expansion: '分段 段表 分段存储' },
];

/** Colloquial phrases → study-oriented expansion. */
const COLLOQUIAL_RULES: RewriteRule[] = [
  { pattern: /不会|不懂|搞不懂|搞不定|弄不明白|看不懂/, expansion: '概念 机制 解题步骤' },
  { pattern: /总是?错|老错|易错/, expansion: '易错点 典型错误 混淆' },
  { pattern: /怎么办|咋办|如何学|怎么学/, expansion: '学习方法 练习步骤' },
  { pattern: /是啥|是什么|啥意思/, expansion: '概念 定义' },
];

export interface RewrittenQuery {
  original: string;
  /** Expanded query text used for retrieval (original always included). */
  expanded: string;
  /** Individual expansion terms added by rules (deduped). */
  addedTerms: string[];
  appliedRules: string[];
}

export function rewriteQuery(query: string): RewrittenQuery {
  const trimmed = query.trim();
  const added = new Set<string>();
  const applied: string[] = [];
  // Term expansions inject into the retrieval query. Colloquial rules are
  // recorded for intent signalling only: v3.4 real-corpus evaluation showed
  // generic words (概念/定义) pollute vector+keyword retrieval across a
  // 1.3k-node corpus (every "XX定义" node gains affinity).
  for (const rule of TERM_EXPANSIONS) {
    if (rule.pattern.test(trimmed)) {
      applied.push(rule.expansion);
      for (const term of rule.expansion.split(/\s+/)) added.add(term);
    }
  }
  for (const rule of COLLOQUIAL_RULES) {
    if (rule.pattern.test(trimmed)) applied.push(rule.expansion);
  }
  for (const token of trimmed.split(/\s+/)) added.delete(token);
  const expanded = [trimmed, ...added].join(' ').replace(/\s+/g, ' ').trim();
  return { original: trimmed, expanded, addedTerms: [...added], appliedRules: applied };
}

// ---- 2. Hybrid retrieval ----

const WEIGHT_VECTOR = 0.65;
const WEIGHT_KEYWORD = 0.30;
const WEIGHT_TITLE = 0.05;

function bigrams(text: string): Set<string> {
  const normalized = text.toLowerCase().replace(/\s+/g, '');
  const grams = new Set<string>();
  for (const ch of normalized) grams.add(ch);
  for (let i = 0; i < normalized.length - 1; i++) grams.add(normalized.slice(i, i + 2));
  return grams;
}

/**
 * Keyword overlap: proportion of query bigrams present in the document text.
 * 1.0 = every query character/bigram appears; 0 = no overlap.
 */
export function keywordOverlap(query: string, documentText: string): number {
  const queryGrams = bigrams(query);
  if (queryGrams.size === 0) return 0;
  const docGrams = bigrams(documentText);
  let hits = 0;
  for (const gram of queryGrams) if (docGrams.has(gram)) hits += 1;
  return hits / queryGrams.size;
}

export interface HybridInput {
  /** V1 relevance score (cosine-based). */
  vectorScore: number;
  title: string;
  chapterPath: readonly string[];
  /** Chunk contents backing this hit (already bounded upstream). */
  contents: readonly string[];
}

export interface HybridScore {
  vectorScore: number;
  keywordScore: number;
  titleBoost: number;
  finalScore: number;
}

export function hybridScore(query: string, input: HybridInput): HybridScore {
  const documentText = [input.title, ...input.chapterPath, ...input.contents].join(' ');
  const keywordScore = keywordOverlap(query, documentText);
  const titleBoost = input.title.toLowerCase().includes(query.trim().toLowerCase()) && query.trim().length >= 2 ? 1 : 0;
  const finalScore = WEIGHT_VECTOR * input.vectorScore + WEIGHT_KEYWORD * keywordScore + WEIGHT_TITLE * titleBoost;
  return { vectorScore: input.vectorScore, keywordScore: round4(keywordScore), titleBoost, finalScore: round4(finalScore) };
}

// ---- 3. Knowledge graph expansion ----

export interface GraphRelation {
  fromId: string;
  toId: string;
  type: string;
}

export interface SeedNode {
  knowledgeNodeId: string;
  subject: string;
  title: string;
  score: number;
}

export interface ExpandedNode {
  knowledgeNodeId: string;
  subject: string;
  title: string;
  score: number;
  source: 'graph_expansion';
  reachedFrom: string;
  relationType: string;
}

const EXPANSION_SCORE_FACTOR = 0.5;
const MAX_EXPANSIONS_PER_SEED = 3;

/**
 * Append 1-hop neighbours of the seed nodes (deduped against seeds and each
 * other), scored at half the reaching seed's score. Bounded per seed.
 */
export function expandWithGraph(
  seeds: readonly SeedNode[],
  relations: readonly GraphRelation[],
  titleById: Map<string, { title: string; subject: string }>,
): ExpandedNode[] {
  const seedIds = new Set(seeds.map((seed) => seed.knowledgeNodeId));
  const neighbours = new Map<string, ExpandedNode>();
  for (const seed of seeds) {
    let added = 0;
    for (const rel of relations) {
      if (added >= MAX_EXPANSIONS_PER_SEED) break;
      const out = rel.fromId === seed.knowledgeNodeId;
      const neighbourId = out ? rel.toId : rel.toId === seed.knowledgeNodeId ? rel.fromId : null;
      if (!neighbourId || seedIds.has(neighbourId) || neighbours.has(neighbourId)) continue;
      const meta = titleById.get(neighbourId);
      neighbours.set(neighbourId, {
        knowledgeNodeId: neighbourId,
        subject: meta?.subject ?? seed.subject,
        title: meta?.title ?? neighbourId,
        score: round4(seed.score * EXPANSION_SCORE_FACTOR),
        source: 'graph_expansion',
        reachedFrom: seed.knowledgeNodeId,
        relationType: rel.type,
      });
      added += 1;
    }
  }
  return [...neighbours.values()].sort((left, right) => right.score - left.score);
}

// ---- 4. Difficulty awareness ----

export interface MasteryEntry {
  knowledgeNodeId: string;
  mastery: number;
}

export interface DifficultyAdjustedNode {
  knowledgeNodeId: string;
  adjustedScore: number;
  adjustment: 'mastered_down' | 'weak_basic_up' | 'none';
}

const MASTERED_THRESHOLD = 0.8;
const WEAK_THRESHOLD = 0.45;
const MASTERED_PENALTY = 0.7;

/**
 * Re-weight results by StudentContext mastery:
 * - mastered nodes (≥0.8) are penalised — no need to re-learn them;
 * - hard topics (difficulty ≥4) of weak students (node mastery <0.45) are
 *   gently demoted in favour of foundational material;
 * - everything else keeps its fused score.
 */
export function applyDifficultyAwareness(
  results: readonly { knowledgeNodeId: string; score: number }[],
  masteryByNode: Map<string, number>,
  difficultyByNode: Map<string, number> = new Map(),
): Map<string, DifficultyAdjustedNode> {
  const adjusted = new Map<string, DifficultyAdjustedNode>();
  for (const result of results) {
    const mastery = masteryByNode.get(result.knowledgeNodeId);
    if (mastery != null && mastery >= MASTERED_THRESHOLD) {
      adjusted.set(result.knowledgeNodeId, {
        knowledgeNodeId: result.knowledgeNodeId,
        adjustedScore: round4(result.score * MASTERED_PENALTY),
        adjustment: 'mastered_down',
      });
      continue;
    }
    const difficulty = difficultyByNode.get(result.knowledgeNodeId);
    if (mastery != null && mastery < WEAK_THRESHOLD && difficulty != null && difficulty >= 4) {
      // Advanced material for a weak area: keep score but flag it so callers
      // can surface foundational siblings first (graph expansion usually does).
      adjusted.set(result.knowledgeNodeId, {
        knowledgeNodeId: result.knowledgeNodeId,
        adjustedScore: round4(result.score * 0.9),
        adjustment: 'weak_basic_up',
      });
      continue;
    }
    adjusted.set(result.knowledgeNodeId, {
      knowledgeNodeId: result.knowledgeNodeId,
      adjustedScore: result.score,
      adjustment: 'none',
    });
  }
  return adjusted;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}