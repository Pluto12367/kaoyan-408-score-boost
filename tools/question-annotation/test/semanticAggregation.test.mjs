import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SEMANTIC_AGGREGATION_VERSION,
  fuseSemanticViews,
  retrieveSemanticV2,
} from '../core/semanticAggregation.js';

function ranked(prefix, count) {
  return Array.from({ length: count }, (_, index) => ({
    nodeId: `${prefix}${String(index + 1).padStart(2, '0')}`,
    rank: index + 1,
  }));
}

function syntheticNode(overrides = {}) {
  return {
    id: 'syn-alpha',
    subject: 'SYN',
    name: 'Alpha',
    chapterName: 'Network',
    sectionName: 'Signals',
    nodeType: 'atomicPoint',
    isActive: true,
    ...overrides,
  };
}

function syntheticSnapshot() {
  return {
    nodes: [
      syntheticNode(),
      syntheticNode({ id: 'syn-beta', name: 'Beta' }),
      syntheticNode({ id: 'other-alpha', subject: 'OTHER', name: 'CrossSubject' }),
      syntheticNode({ id: 'syn-inactive', isActive: false, name: 'Inactive' }),
      syntheticNode({ id: 'syn-section', nodeType: 'section', name: 'NonAtomic' }),
    ],
  };
}

function vectorProvider() {
  const calls = [];
  return {
    calls,
    spec: {
      id: 'synthetic/vector-provider',
      revision: 'synthetic-revision',
      queryPrefix: 'query: ',
      passagePrefix: 'passage: ',
      pooling: 'mean',
      normalize: true,
      dimension: 2,
      transformersVersion: 'synthetic-version',
    },
    providerId: 'synthetic-vector-provider',
    modelVersion: 'synthetic-revision',
    async embed(view, text) {
      calls.push({ view, text: String(text) });
      const normalized = String(text).toLowerCase();
      if (normalized.includes('beta')) return [0, 1];
      return [1, 0];
    },
  };
}

function withCache(t) {
  const cacheDir = mkdtempSync(join(tmpdir(), 'semantic-v2-'));
  t.after(() => rmSync(cacheDir, { recursive: true, force: true }));
  return cacheDir;
}

test('V2-6: version is locked', () => {
  assert.equal(SEMANTIC_AGGREGATION_VERSION, 'semantic-rrf-v2');
});

test('V2-6: RRF rank math exact k=60', () => {
  const result = fuseSemanticViews({
    stem: [{ nodeId: 'node-a', rank: 1 }],
    analysis: [{ nodeId: 'node-a', rank: 2 }],
    subjectFilter: new Set(['node-a']),
  });
  assert.equal(result[0].rrfScore, 1 / 61 + 1 / 62);
  assert.deepEqual(result[0], {
    nodeId: 'node-a',
    finalRank: 1,
    rrfScore: 1 / 61 + 1 / 62,
    stemRank: 1,
    analysisRank: 2,
  });
});

test('V2-6: full ranking, no pre-fusion truncation', () => {
  const stem = ranked('node-', 50);
  const analysis = [
    { nodeId: 'node-50', rank: 1 },
    ...stem.slice(0, 49).map((entry, index) => ({ nodeId: entry.nodeId, rank: index + 2 })),
  ];
  const result = fuseSemanticViews({
    stem,
    analysis,
    subjectFilter: new Set(stem.map((entry) => entry.nodeId)),
    topK: 50,
  });
  const entry = result.find((candidate) => candidate.nodeId === 'node-50');
  assert.ok(entry);
  assert.equal(entry.stemRank, 50);
  assert.equal(entry.analysisRank, 1);
  assert.equal(entry.rrfScore, 1 / 110 + 1 / 61);
});

test('V2-6: rank14 + analysis1 rescue', () => {
  const stem = ranked('node-', 14);
  const rescued = stem[13].nodeId;
  const analysis = [
    { nodeId: rescued, rank: 1 },
    ...stem.slice(0, 13).map((entry, index) => ({ nodeId: entry.nodeId, rank: index + 2 })),
  ];
  const result = fuseSemanticViews({
    stem,
    analysis,
    subjectFilter: new Set(stem.map((entry) => entry.nodeId)),
    topK: 12,
  });
  const entry = result.find((candidate) => candidate.nodeId === rescued);
  assert.ok(entry);
  assert.equal(entry.stemRank, 14);
  assert.equal(entry.analysisRank, 1);
  assert.ok(entry.finalRank <= 12);
});

test('V2-6: retrieval integration preserves rank14 + analysis1 before Top12', async (t) => {
  const nodes = Array.from({ length: 14 }, (_, index) => syntheticNode({
    id: `syn-${String(index + 1).padStart(2, '0')}`,
    name: `Point${String(index + 1).padStart(2, '0')}`,
  }));
  const provider = vectorProvider();
  provider.embed = async (view, text) => {
    provider.calls.push({ view, text: String(text) });
    if (view === 'query') return String(text) === 'analysis signal' ? [0, 1] : [1, 0];
    const number = Number(/Point(\d+)/.exec(String(text))?.[1]);
    const angle = ((number - 1) / 13) * (Math.PI / 2);
    return [Math.cos(angle), Math.sin(angle)];
  };
  const result = await retrieveSemanticV2(
    { id: 'synthetic-question', subject: 'SYN', stem: 'Stem signal', analysis: 'Analysis signal' },
    { nodes },
    provider,
    withCache(t),
    { queryMode: 'Q2', passageFormat: 'P1' },
  );
  const rescued = result.find((entry) => entry.nodeId === 'syn-14');
  assert.ok(rescued);
  assert.equal(rescued.stemRank, 14);
  assert.equal(rescued.analysisRank, 1);
  assert.ok(rescued.finalRank <= 12);
});

test('V2-6: rrfScore DESC then nodeId ASC tie-break', () => {
  const result = fuseSemanticViews({
    stem: [{ nodeId: 'node-b', rank: 1 }],
    analysis: [{ nodeId: 'node-a', rank: 1 }],
    subjectFilter: new Set(['node-a', 'node-b']),
  });
  assert.deepEqual(result.map((entry) => entry.nodeId), ['node-a', 'node-b']);
});

test('V2-6: subject hard filter', () => {
  const result = fuseSemanticViews({
    stem: [
      { nodeId: 'same-subject', rank: 2 },
      { nodeId: 'cross-subject', rank: 1 },
    ],
    analysis: null,
    subjectFilter: new Set(['same-subject']),
  });
  assert.deepEqual(result.map((entry) => entry.nodeId), ['same-subject']);
});

test('V2-6: active atomic only in retrieval integration', async (t) => {
  const cacheDir = withCache(t);
  const provider = vectorProvider();
  const result = await retrieveSemanticV2(
    { id: 'synthetic-question', subject: 'SYN', stem: 'Alpha', analysis: 'Beta' },
    syntheticSnapshot(),
    provider,
    cacheDir,
    { queryMode: 'Q2', passageFormat: 'P1' },
  );
  assert.deepEqual(new Set(result.map((entry) => entry.nodeId)), new Set(['syn-alpha', 'syn-beta']));
  const passageText = provider.calls.filter((call) => call.view === 'passage').map((call) => call.text);
  assert.equal(passageText.some((text) => text.includes('CrossSubject')), false);
  assert.equal(passageText.some((text) => text.includes('Inactive')), false);
  assert.equal(passageText.some((text) => text.includes('NonAtomic')), false);
});

test('V2-6: P2 retrieval uses the locked labeled passage', async (t) => {
  const cacheDir = withCache(t);
  const provider = vectorProvider();
  await retrieveSemanticV2(
    { id: 'synthetic-question', subject: 'SYN', stem: 'Alpha', analysis: null },
    { nodes: [syntheticNode()] },
    provider,
    cacheDir,
    { queryMode: 'Q1', passageFormat: 'P2' },
  );
  const passageCall = provider.calls.find((call) => call.view === 'passage');
  assert.equal(passageCall.text, '考点：Alpha 章节：Network 小节：Signals');
});

test('V2-6: Top8 and Top12 without duplicates', () => {
  const stem = ranked('node-', 15);
  const input = {
    stem,
    analysis: [...stem].reverse().map((entry, index) => ({ nodeId: entry.nodeId, rank: index + 1 })),
    subjectFilter: new Set(stem.map((entry) => entry.nodeId)),
  };
  const top8 = fuseSemanticViews({ ...input, topK: 8 });
  const top12 = fuseSemanticViews({ ...input, topK: 12 });
  assert.equal(top8.length, 8);
  assert.equal(top12.length, 12);
  assert.equal(new Set(top8.map((entry) => entry.nodeId)).size, 8);
  assert.equal(new Set(top12.map((entry) => entry.nodeId)).size, 12);
  assert.deepEqual(top8.map((entry) => entry.finalRank), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('V2-6: stem-only fallback when analysis unavailable', async (t) => {
  const result = await retrieveSemanticV2(
    { id: 'synthetic-question', subject: 'SYN', stem: 'Alpha', analysis: '   ' },
    { nodes: [syntheticNode(), syntheticNode({ id: 'syn-beta', name: 'Beta' })] },
    vectorProvider(),
    withCache(t),
    { queryMode: 'Q2', passageFormat: 'P1' },
  );
  assert.ok(result.length > 0);
  assert.ok(result.every((entry) => entry.analysisRank === null));
});

test('V2-6: Q1 ignores available analysis', async (t) => {
  const provider = vectorProvider();
  const result = await retrieveSemanticV2(
    { id: 'synthetic-question', subject: 'SYN', stem: 'Alpha', analysis: 'Beta' },
    { nodes: [syntheticNode(), syntheticNode({ id: 'syn-beta', name: 'Beta' })] },
    provider,
    withCache(t),
    { queryMode: 'Q1', passageFormat: 'P1' },
  );
  assert.ok(result.every((entry) => entry.analysisRank === null));
  assert.equal(provider.calls.some((call) => call.view === 'query' && call.text === 'beta'), false);
});

test('V2-6: deterministic for identical input and shuffled node order', async (t) => {
  const cacheDir = withCache(t);
  const question = { id: 'synthetic-question', subject: 'SYN', stem: 'Alpha', analysis: 'Beta' };
  const snapshot = syntheticSnapshot();
  const options = { queryMode: 'Q2', passageFormat: 'P1' };
  const first = await retrieveSemanticV2(question, snapshot, vectorProvider(), cacheDir, options);
  const second = await retrieveSemanticV2(
    question,
    { nodes: [...snapshot.nodes].reverse() },
    vectorProvider(),
    cacheDir,
    options,
  );
  assert.deepEqual(first, second);
});

test('V2-6: invalid modes and non-finite ranks fail closed', async (t) => {
  assert.throws(
    () => fuseSemanticViews({
      stem: [{ nodeId: 'node-a', rank: Number.NaN }],
      analysis: null,
      subjectFilter: new Set(['node-a']),
    }),
    /rank/,
  );
  await assert.rejects(
    retrieveSemanticV2(
      { subject: 'SYN', stem: 'Alpha', analysis: null },
      { nodes: [syntheticNode()] },
      vectorProvider(),
      withCache(t),
      { queryMode: 'Q3', passageFormat: 'P1' },
    ),
    /queryMode/,
  );
  await assert.rejects(
    retrieveSemanticV2(
      { subject: 'SYN', stem: 'Alpha', analysis: null },
      { nodes: [syntheticNode(), syntheticNode({ id: undefined, name: 'Malformed' })] },
      vectorProvider(),
      withCache(t),
      { queryMode: 'Q1', passageFormat: 'P1' },
    ),
    /invalid id/,
  );
});

test('V2-6: implementation contains no protected artifact references', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '..', 'core', 'semanticAggregation.js'), 'utf8');
  for (const forbidden of [
    'gold-sample-v2r2.json',
    'gold-split-v2.json',
    'gold-set-v2.json',
    'gold-truth-manifest-v2.json',
  ]) {
    assert.equal(source.includes(forbidden), false);
  }
});
