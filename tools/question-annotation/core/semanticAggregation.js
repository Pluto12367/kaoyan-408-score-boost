import { embedWithCache } from './embedding.js';
import { buildPassageV1, buildPassageV2 } from './passage.js';
import { buildQueryViews } from './queryViews.js';

export const SEMANTIC_AGGREGATION_VERSION = 'semantic-rrf-v2';

function validateRankedList(entries, label) {
  if (!Array.isArray(entries)) throw new Error(`${label} ranking must be an array`);
  const seen = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry.nodeId !== 'string' || entry.nodeId.length === 0) {
      throw new Error(`${label} ranking has invalid nodeId`);
    }
    if (!Number.isInteger(entry.rank) || entry.rank <= 0) {
      throw new Error(`${label} ranking has invalid rank for ${entry.nodeId}`);
    }
    if (seen.has(entry.nodeId)) throw new Error(`${label} ranking has duplicate nodeId ${entry.nodeId}`);
    seen.add(entry.nodeId);
  }
}

function addRanking(scores, entries, rankField, subjectFilter, k) {
  for (const entry of entries) {
    if (!subjectFilter.has(entry.nodeId)) continue;
    const current = scores.get(entry.nodeId) ?? {
      nodeId: entry.nodeId,
      rrfScore: 0,
      stemRank: null,
      analysisRank: null,
    };
    current[rankField] = entry.rank;
    current.rrfScore += 1 / (k + entry.rank);
    scores.set(entry.nodeId, current);
  }
}

/** Fuse complete per-view rankings with the locked rank-only RRF contract. */
export function fuseSemanticViews(input) {
  const stem = input?.stem;
  const analysis = input?.analysis ?? null;
  const subjectFilter = input?.subjectFilter;
  const k = input?.k ?? 60;
  const topK = input?.topK ?? 12;

  validateRankedList(stem, 'stem');
  if (analysis !== null) validateRankedList(analysis, 'analysis');
  if (!subjectFilter || typeof subjectFilter.has !== 'function') {
    throw new Error('subjectFilter must be a set of eligible nodeIds');
  }
  if (!Number.isFinite(k) || k <= 0) throw new Error(`invalid RRF k: ${k}`);
  if (!Number.isInteger(topK) || topK <= 0) throw new Error(`invalid topK: ${topK}`);

  const scores = new Map();
  addRanking(scores, stem, 'stemRank', subjectFilter, k);
  if (analysis !== null) addRanking(scores, analysis, 'analysisRank', subjectFilter, k);

  return [...scores.values()]
    .sort((left, right) => right.rrfScore - left.rrfScore || left.nodeId.localeCompare(right.nodeId))
    .slice(0, topK)
    .map((entry, index) => ({ ...entry, finalRank: index + 1 }))
    .map(({ nodeId, finalRank, rrfScore, stemRank, analysisRank }) => ({
      nodeId,
      finalRank,
      rrfScore,
      stemRank,
      analysisRank,
    }));
}

function dotProduct(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0 || left.length !== right.length) {
    throw new Error(`embedding dimension mismatch: ${left?.length ?? 'invalid'} vs ${right?.length ?? 'invalid'}`);
  }
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (!Number.isFinite(left[index]) || !Number.isFinite(right[index])) {
      throw new Error('embedding contains non-finite value');
    }
    sum += left[index] * right[index];
  }
  if (!Number.isFinite(sum)) throw new Error('semantic score is non-finite');
  return sum;
}

function selectPassageBuilder(format) {
  if (format === 'P1') return buildPassageV1;
  if (format === 'P2') return buildPassageV2;
  throw new Error(`invalid passageFormat: ${format}`);
}

function selectQueryViews(question, mode) {
  if (mode !== 'Q1' && mode !== 'Q2') throw new Error(`invalid queryMode: ${mode}`);
  const built = buildQueryViews(question);
  if (mode === 'Q1') return built.views.filter((view) => view.type === 'stem');
  return built.views;
}

function buildEligiblePool(question, snapshot) {
  if (!question || typeof question.subject !== 'string' || question.subject.length === 0) {
    throw new Error('question subject is required');
  }
  const pool = (snapshot?.nodes ?? [])
    .filter((node) => node.subject === question.subject)
    .filter((node) => node.isActive === true && node.nodeType === 'atomicPoint');
  const seen = new Set();
  for (const node of pool) {
    if (typeof node.id !== 'string' || node.id.length === 0) throw new Error('eligible node has invalid id');
    if (seen.has(node.id)) throw new Error(`eligible pool has duplicate nodeId ${node.id}`);
    seen.add(node.id);
  }
  return pool.sort((left, right) => left.id.localeCompare(right.id));
}

async function rankFullView(provider, queryContent, pool, passageBuilder, cacheDir) {
  const queryVector = await embedWithCache(provider, 'query', queryContent, cacheDir);
  const scored = [];
  for (const node of pool) {
    const passageVector = await embedWithCache(provider, 'passage', passageBuilder(node), cacheDir);
    scored.push({ nodeId: node.id, score: dotProduct(queryVector, passageVector) });
  }
  scored.sort((left, right) => right.score - left.score || left.nodeId.localeCompare(right.nodeId));
  return scored.map((entry, index) => ({ nodeId: entry.nodeId, rank: index + 1 }));
}

/**
 * Rank every same-subject active atomic node for each selected query view,
 * then fuse the complete rankings. This function has no Gold or split input.
 */
export async function retrieveSemanticV2(question, snapshot, provider, cacheDir, options) {
  const queryViews = selectQueryViews(question, options?.queryMode);
  const passageBuilder = selectPassageBuilder(options?.passageFormat);
  const pool = buildEligiblePool(question, snapshot);
  if (pool.length === 0) return [];

  let stem = null;
  let analysis = null;
  for (const view of queryViews) {
    const ranking = await rankFullView(provider, view.content, pool, passageBuilder, cacheDir);
    if (view.type === 'stem') stem = ranking;
    if (view.type === 'analysis') analysis = ranking;
  }

  return fuseSemanticViews({
    stem: stem ?? [],
    analysis,
    subjectFilter: new Set(pool.map((node) => node.id)),
    k: 60,
    topK: 12,
  });
}
