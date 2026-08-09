import test from 'node:test';
import assert from 'node:assert/strict';
import { FUSION_VERSION, RRF_K, fuseCandidates } from '../core/fusion.js';

const K = 60;

function rrf(rank) {
  return 1 / (K + rank);
}

test('fuseCandidates applies RRF with k=60 and deterministic tie-break', () => {
  const input = {
    lexical: [{ nodeId: 'n1', rank: 1 }, { nodeId: 'n2', rank: 2 }],
    stemEmbedding: [{ nodeId: 'n2', rank: 1 }, { nodeId: 'n1', rank: 2 }],
    analysisEmbedding: [{ nodeId: 'n1', rank: 1 }, { nodeId: 'n2', rank: 2 }],
    kpMatched: new Set(),
    chapterMatched: new Set(),
    subjectFilter: new Set(['n1', 'n2']),
  };
  const out = fuseCandidates(input, 12);
  assert.equal(out[0].nodeId, 'n1');
  assert.ok(out.every((candidate) => candidate.finalRank >= 1 && candidate.retrievalReasons.length > 0));
});

test('structural bonus cannot promote a textually irrelevant node above a strongly matched one', () => {
  const input = {
    lexical: [{ nodeId: 'strong', rank: 1 }, { nodeId: 'weak-bonus', rank: 20 }],
    stemEmbedding: [{ nodeId: 'strong', rank: 1 }, { nodeId: 'weak-bonus', rank: 25 }],
    analysisEmbedding: [{ nodeId: 'strong', rank: 1 }, { nodeId: 'weak-bonus', rank: 25 }],
    kpMatched: new Set(['weak-bonus']),
    chapterMatched: new Set(['weak-bonus']),
    subjectFilter: new Set(['strong', 'weak-bonus']),
  };
  const out = fuseCandidates(input, 12);
  assert.equal(out[0].nodeId, 'strong');
});

test('TEST A — basic RRF math is exact for every node', () => {
  const input = {
    lexical: [{ nodeId: 'A', rank: 1 }, { nodeId: 'B', rank: 2 }],
    stemEmbedding: [{ nodeId: 'B', rank: 1 }, { nodeId: 'C', rank: 2 }],
    analysisEmbedding: [],
    kpMatched: new Set(),
    chapterMatched: new Set(),
    subjectFilter: new Set(['A', 'B', 'C']),
  };
  const out = fuseCandidates(input, 12);
  const byId = new Map(out.map((candidate) => [candidate.nodeId, candidate]));
  assert.equal(byId.size, 3);
  assert.ok(Math.abs(byId.get('A').rrfScore - rrf(1)) < 1e-12);
  assert.ok(Math.abs(byId.get('B').rrfScore - (rrf(2) + rrf(1))) < 1e-12);
  assert.ok(Math.abs(byId.get('C').rrfScore - rrf(2)) < 1e-12);
  assert.equal(byId.get('A').lexicalRank, 1);
  assert.equal(byId.get('A').stemEmbeddingRank, null);
  assert.equal(byId.get('B').lexicalRank, 2);
  assert.equal(byId.get('B').stemEmbeddingRank, 1);
});

test('TEST B — a node in both lists is merged into one entry with summed contributions', () => {
  const input = {
    lexical: [{ nodeId: 'X', rank: 2 }],
    stemEmbedding: [{ nodeId: 'X', rank: 1 }],
    analysisEmbedding: [],
    kpMatched: new Set(),
    chapterMatched: new Set(),
    subjectFilter: new Set(['X']),
  };
  const out = fuseCandidates(input, 12);
  assert.equal(out.length, 1);
  assert.equal(out[0].nodeId, 'X');
  assert.ok(Math.abs(out[0].rrfScore - (rrf(2) + rrf(1))) < 1e-12);
  assert.ok(out[0].retrievalReasons.some((reason) => reason.includes('lexical')));
  assert.ok(out[0].retrievalReasons.some((reason) => reason.includes('stemEmbedding')));
});

test('TEST C — lexical-only node still enters the result', () => {
  const input = {
    lexical: [{ nodeId: 'only-lex', rank: 1 }],
    stemEmbedding: [],
    analysisEmbedding: [],
    kpMatched: new Set(),
    chapterMatched: new Set(),
    subjectFilter: new Set(['only-lex']),
  };
  const out = fuseCandidates(input, 12);
  assert.deepEqual(out.map((candidate) => candidate.nodeId), ['only-lex']);
});

test('TEST D — semantic-only node still enters the result', () => {
  const input = {
    lexical: [],
    stemEmbedding: [{ nodeId: 'only-stem', rank: 1 }],
    analysisEmbedding: [],
    kpMatched: new Set(),
    chapterMatched: new Set(),
    subjectFilter: new Set(['only-stem']),
  };
  const out = fuseCandidates(input, 12);
  assert.deepEqual(out.map((candidate) => candidate.nodeId), ['only-stem']);
});

test('TEST E — identical rrf scores use a stable tie-break', () => {
  const input = {
    lexical: [{ nodeId: 'b', rank: 1 }, { nodeId: 'a', rank: 1 }],
    stemEmbedding: [],
    analysisEmbedding: [],
    kpMatched: new Set(),
    chapterMatched: new Set(),
    subjectFilter: new Set(['a', 'b']),
  };
  const first = fuseCandidates(input, 12);
  const second = fuseCandidates(input, 12);
  assert.deepEqual(first, second);
  assert.deepEqual(first.map((candidate) => candidate.nodeId), ['a', 'b']);
});

test('TEST E2 — among equal rrf, kpMatched beats chapterMatched beats nodeId order', () => {
  const input = {
    lexical: [{ nodeId: 'b', rank: 1 }, { nodeId: 'a', rank: 1 }, { nodeId: 'c', rank: 1 }],
    stemEmbedding: [],
    analysisEmbedding: [],
    kpMatched: new Set(['b']),
    chapterMatched: new Set(['a']),
    subjectFilter: new Set(['a', 'b', 'c']),
  };
  const out = fuseCandidates(input, 12);
  assert.deepEqual(out.map((candidate) => candidate.nodeId), ['b', 'a', 'c']);
});

test('TEST F — Top8 and Top12 are supported without duplicates or rank gaps', () => {
  const lexical = [];
  for (let i = 1; i <= 20; i += 1) lexical.push({ nodeId: `n-${String(i).padStart(2, '0')}`, rank: i });
  const input = {
    lexical,
    stemEmbedding: [],
    analysisEmbedding: [],
    kpMatched: new Set(),
    chapterMatched: new Set(),
    subjectFilter: new Set(lexical.map((entry) => entry.nodeId)),
  };
  const top8 = fuseCandidates(input, 8);
  const top12 = fuseCandidates(input, 12);
  assert.equal(top8.length, 8);
  assert.equal(top12.length, 12);
  for (const out of [top8, top12]) {
    assert.equal(new Set(out.map((candidate) => candidate.nodeId)).size, out.length);
    out.forEach((candidate, index) => assert.equal(candidate.finalRank, index + 1));
  }
});

test('TEST G — cross-subject candidates are rejected by the subject filter', () => {
  const input = {
    lexical: [{ nodeId: 'ds-node', rank: 1 }, { nodeId: 'cn-node', rank: 1 }],
    stemEmbedding: [],
    analysisEmbedding: [],
    kpMatched: new Set(['cn-node']),
    chapterMatched: new Set(['cn-node']),
    subjectFilter: new Set(['ds-node']),
  };
  const out = fuseCandidates(input, 12);
  assert.deepEqual(out.map((candidate) => candidate.nodeId), ['ds-node']);
});

test('TEST H — inactive/non-atomic nodes are rejected when absent from the pool', () => {
  const input = {
    lexical: [{ nodeId: 'active', rank: 1 }, { nodeId: 'inactive', rank: 2 }, { nodeId: 'section', rank: 3 }],
    stemEmbedding: [],
    analysisEmbedding: [],
    kpMatched: new Set(),
    chapterMatched: new Set(),
    subjectFilter: new Set(['active']),
  };
  const out = fuseCandidates(input, 12);
  assert.deepEqual(out.map((candidate) => candidate.nodeId), ['active']);
});

test('TEST I — repeated execution is fully deterministic', () => {
  const input = {
    lexical: [{ nodeId: 'n1', rank: 1 }, { nodeId: 'n2', rank: 3 }, { nodeId: 'n3', rank: 2 }],
    stemEmbedding: [{ nodeId: 'n2', rank: 1 }, { nodeId: 'n3', rank: 4 }],
    analysisEmbedding: [{ nodeId: 'n1', rank: 2 }],
    kpMatched: new Set(['n2']),
    chapterMatched: new Set(['n3']),
    subjectFilter: new Set(['n1', 'n2', 'n3']),
  };
  const a = fuseCandidates(input, 12);
  const b = fuseCandidates(input, 12);
  assert.deepEqual(a, b);
  const snapshot = JSON.stringify(a);
  assert.equal(JSON.stringify(fuseCandidates(input, 12)), snapshot);
});

test('TEST J — raw score magnitude never affects RRF (rank-only fusion)', () => {
  const base = {
    lexical: [{ nodeId: 'A', rank: 1, rawScore: 100000 }, { nodeId: 'B', rank: 2, rawScore: 1 }],
    stemEmbedding: [{ nodeId: 'B', rank: 1, rawScore: -50 }, { nodeId: 'A', rank: 2, rawScore: 0.0001 }],
    analysisEmbedding: [],
    kpMatched: new Set(),
    chapterMatched: new Set(),
    subjectFilter: new Set(['A', 'B']),
  };
  const other = {
    ...base,
    lexical: [{ nodeId: 'A', rank: 1, rawScore: 0.5 }, { nodeId: 'B', rank: 2, rawScore: 9999 }],
    stemEmbedding: [{ nodeId: 'B', rank: 1, rawScore: 3 }, { nodeId: 'A', rank: 2, rawScore: -7 }],
  };
  const a = fuseCandidates(base, 12);
  const b = fuseCandidates(other, 12);
  assert.deepEqual(a, b);
  for (const candidate of a) {
    assert.ok(Math.abs(candidate.rrfScore - (candidate.lexicalRank === 1 ? rrf(1) : rrf(2)) - (candidate.stemEmbeddingRank === 1 ? rrf(1) : rrf(2))) < 1e-12);
  }
});

test('fusion version and RRF k are centralized', () => {
  assert.equal(FUSION_VERSION, 'rrf-k60-bonus-v1');
  assert.equal(RRF_K, 60);
});
