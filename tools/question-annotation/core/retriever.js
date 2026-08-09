import { normalizeText, searchLexical } from './lexical.js';
import { embedWithCache } from './embedding.js';
import { fuseCandidates } from './fusion.js';

export const HYBRID_RETRIEVER_VERSION = 'hybrid-retrieval-v1';

function dotProduct(left, right) {
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) sum += left[index] * right[index];
  return sum;
}

function nodeText(node) {
  return [node.name, node.chapterName, node.sectionName].filter((value) => value != null && value !== '').join(' ');
}

/**
 * Soft structural signals from the question's old KnowledgePoints: exact
 * normalized name match -> kpMatched; normalized chapter match -> chapterMatched.
 * These are tie-break-only signals in fusion and never touch Gold labels.
 */
function computeStructuralMatches(question, snapshot, pool) {
  const kpIds = new Set(
    (snapshot.questionKnowledgePoints ?? [])
      .filter((relation) => relation.questionId === question.id)
      .map((relation) => relation.knowledgePointId),
  );
  const kps = (snapshot.knowledgePoints ?? []).filter((point) => kpIds.has(point.id));
  const kpMatched = new Set();
  const chapterMatched = new Set();
  for (const node of pool) {
    for (const point of kps) {
      if (normalizeText(node.name) === normalizeText(point.title)) kpMatched.add(node.id);
      if (node.chapterName && normalizeText(node.chapterName) === normalizeText(point.chapter)) chapterMatched.add(node.id);
    }
  }
  return { kpMatched, chapterMatched };
}

async function rankView(provider, queryVector, pool, cacheDir) {
  const scored = [];
  for (const node of pool) {
    const passage = await embedWithCache(provider, 'passage', nodeText(node), cacheDir);
    scored.push({ nodeId: node.id, score: dotProduct(queryVector, passage) });
  }
  scored.sort((a, b) => b.score - a.score || a.nodeId.localeCompare(b.nodeId));
  return scored.map((entry, index) => ({ nodeId: entry.nodeId, rank: index + 1 }));
}

/**
 * Hybrid Top12 retriever: lexical BM25 + E5 stem view + E5 analysis view,
 * fused by RRF. Subject is a hard filter and the pool is the question subject's
 * active atomic nodes only; anything outside never enters fusion.
 * Stem/analysis query views come from the question stem/analysis; node text is
 * the passage view. Deterministic and offline (embeddings are cached).
 */
export async function retrieveTop12(question, snapshot, providers, cacheDir) {
  const subject = question.subject;
  const pool = (snapshot.nodes ?? []).filter(
    (node) =>
      node.subject === subject &&
      node.isActive !== false &&
      (node.nodeType === undefined || node.nodeType === null || node.nodeType === 'atomicPoint'),
  );
  const subjectFilter = new Set(pool.map((node) => node.id));

  const lexicalQuery = [question.stem, question.analysis].filter((value) => value != null && value !== '').join(' ');
  const lexicalRanked = searchLexical(providers.lexical, lexicalQuery, subject);
  const lexical = lexicalRanked.map((candidate, index) => ({ nodeId: candidate.nodeId, rank: index + 1 }));

  const stemVector = await embedWithCache(providers.stem, 'query', question.stem ?? '', cacheDir);
  const analysisVector = await embedWithCache(providers.analysis, 'query', question.analysis ?? '', cacheDir);
  const stemEmbedding = await rankView(providers.stem, stemVector, pool, cacheDir);
  const analysisEmbedding = await rankView(providers.analysis, analysisVector, pool, cacheDir);

  const { kpMatched, chapterMatched } = computeStructuralMatches(question, snapshot, pool);
  return fuseCandidates({ lexical, stemEmbedding, analysisEmbedding, kpMatched, chapterMatched, subjectFilter }, 12);
}
