export const FUSION_VERSION = 'rrf-k60-bonus-v1';
export const RRF_K = 60;

function rrfScore(rank) {
  return 1 / (RRF_K + rank);
}

/**
 * Best (lowest) rank of each node within one list, rank-only: raw scores are
 * never part of the fusion input contract, so magnitude cannot affect RRF.
 */
function listRanks(list) {
  const ranks = new Map();
  for (const entry of list ?? []) {
    const rank = Number.isInteger(entry.rank) && entry.rank >= 1 ? entry.rank : null;
    if (rank === null) continue;
    const existing = ranks.get(entry.nodeId);
    if (existing === undefined || rank < existing) ranks.set(entry.nodeId, rank);
  }
  return ranks;
}

/**
 * Reciprocal Rank Fusion over three ranked lists (lexical, stem embedding,
 * analysis embedding), k=60. Subject filter is a hard fail-closed gate: any
 * candidate not in `subjectFilter` (the question subject's active atomic pool)
 * is excluded. Nodes present in several lists are merged with summed RRF
 * contributions. Structural kp/chapter signals are deterministic tie-breaks
 * only (they never add magnitude), so a textually irrelevant node can never be
 * promoted above a strongly matched one. Ordering: rrfScore DESC, kpMatched,
 * chapterMatched, nodeId ASC. Output is a contiguous rank 1..N.
 */
export function fuseCandidates(input, topK) {
  const lexical = listRanks(input.lexical);
  const stem = listRanks(input.stemEmbedding);
  const analysis = listRanks(input.analysisEmbedding);
  const subjectFilter = input.subjectFilter ?? new Set();
  const kpMatchedSet = input.kpMatched ?? new Set();
  const chapterMatchedSet = input.chapterMatched ?? new Set();

  const nodeIds = new Set([...lexical.keys(), ...stem.keys(), ...analysis.keys()]);
  const rows = [];
  for (const nodeId of nodeIds) {
    if (!subjectFilter.has(nodeId)) continue;
    const lexicalRank = lexical.get(nodeId) ?? null;
    const stemEmbeddingRank = stem.get(nodeId) ?? null;
    const analysisEmbeddingRank = analysis.get(nodeId) ?? null;
    let score = 0;
    const retrievalReasons = [];
    if (lexicalRank !== null) {
      score += rrfScore(lexicalRank);
      retrievalReasons.push(`rrf:lexical:${lexicalRank}`);
    }
    if (stemEmbeddingRank !== null) {
      score += rrfScore(stemEmbeddingRank);
      retrievalReasons.push(`rrf:stemEmbedding:${stemEmbeddingRank}`);
    }
    if (analysisEmbeddingRank !== null) {
      score += rrfScore(analysisEmbeddingRank);
      retrievalReasons.push(`rrf:analysisEmbedding:${analysisEmbeddingRank}`);
    }
    const kpMatched = kpMatchedSet.has(nodeId);
    const chapterMatched = chapterMatchedSet.has(nodeId);
    if (kpMatched) retrievalReasons.push('kpMatched');
    if (chapterMatched) retrievalReasons.push('chapterMatched');
    rows.push({
      nodeId,
      rrfScore: score,
      lexicalRank,
      stemEmbeddingRank,
      analysisEmbeddingRank,
      kpMatched,
      chapterMatched,
      retrievalReasons,
    });
  }

  rows.sort(
    (a, b) =>
      b.rrfScore - a.rrfScore ||
      (b.kpMatched ? 1 : 0) - (a.kpMatched ? 1 : 0) ||
      (b.chapterMatched ? 1 : 0) - (a.chapterMatched ? 1 : 0) ||
      a.nodeId.localeCompare(b.nodeId),
  );
  const limit = typeof topK === 'number' && topK > 0 ? topK : rows.length;
  return rows.slice(0, limit).map((row, index) => ({ ...row, finalRank: index + 1 }));
}
