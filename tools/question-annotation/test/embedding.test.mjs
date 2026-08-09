import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BGE_SMALL_ZH_SPEC,
  E5_SMALL_SPEC,
  FakeEmbeddingProvider,
  embeddingSpecHash,
  embedWithCache,
  fakeEmbeddingFor,
  retrieveSemanticCandidates,
  selectModelWinner,
  validateEmbeddingModelSpec,
} from '../core/embedding.js';
import { resolveBenchmarkSplit } from '../scripts/embedding-benchmark.mjs';

function fakeSpec(overrides = {}) {
  return {
    id: 'fake',
    revision: 'r1',
    queryPrefix: 'query: ',
    passagePrefix: 'passage: ',
    pooling: 'mean',
    normalize: true,
    dimension: 8,
    transformersVersion: 'test',
    ...overrides,
  };
}

function l2Norm(vector) {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

test('FakeEmbeddingProvider applies model-specific query/passage transformation and normalizes', async () => {
  const spec = fakeSpec();
  const provider = new FakeEmbeddingProvider(spec);
  const q = await provider.embed('query', '折半查找');
  const p = await provider.embed('passage', '折半查找');
  assert.deepEqual(q, await provider.embed('query', '折半查找'));
  assert.notDeepEqual(q, p);
  assert.ok(Math.abs(l2Norm(q) - 1) < 1e-9);
  assert.ok(Math.abs(l2Norm(p) - 1) < 1e-9);
});

test('embedWithCache cache identity includes encoding spec and view; config change invalidates', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'emb-'));
  const specA = fakeSpec();
  const specB = { ...specA, queryPrefix: '检索：' };
  const one = await embedWithCache(new FakeEmbeddingProvider(specA), 'query', 'TCP', dir);
  const two = await embedWithCache(new FakeEmbeddingProvider(specA), 'query', 'TCP', dir);
  assert.deepEqual(one, two);
  const changed = await embedWithCache(new FakeEmbeddingProvider(specB), 'query', 'TCP', dir);
  assert.notDeepEqual(changed, one);
});

test('TEST A — candidate model specs match the locked encoding contract', () => {
  assert.equal(E5_SMALL_SPEC.id, 'Xenova/multilingual-e5-small');
  assert.equal(E5_SMALL_SPEC.queryPrefix, 'query: ');
  assert.equal(E5_SMALL_SPEC.passagePrefix, 'passage: ');
  assert.equal(E5_SMALL_SPEC.pooling, 'mean');
  assert.equal(E5_SMALL_SPEC.normalize, true);
  assert.equal(E5_SMALL_SPEC.dimension, 384);
  assert.equal(BGE_SMALL_ZH_SPEC.id, 'Xenova/bge-small-zh-v1.5');
  assert.equal(BGE_SMALL_ZH_SPEC.queryPrefix, '为这个句子生成表示以用于检索相关文章：');
  assert.equal(BGE_SMALL_ZH_SPEC.passagePrefix, '');
  assert.equal(BGE_SMALL_ZH_SPEC.pooling, 'cls');
  assert.equal(BGE_SMALL_ZH_SPEC.normalize, true);
  assert.equal(BGE_SMALL_ZH_SPEC.dimension, 512);
  for (const spec of [E5_SMALL_SPEC, BGE_SMALL_ZH_SPEC]) {
    assert.deepEqual(validateEmbeddingModelSpec(spec).errors, []);
  }
  assert.equal(validateEmbeddingModelSpec({ ...fakeSpec(), dimension: 0 }).ok, false);
  assert.equal(validateEmbeddingModelSpec({ ...fakeSpec(), pooling: 'max' }).ok, false);
  assert.equal(validateEmbeddingModelSpec({ ...fakeSpec(), normalize: false }).ok, false);
  assert.equal(validateEmbeddingModelSpec({ ...fakeSpec(), revision: 'main' }).ok, true);
});

test('TEST B — query prefix is applied to queries only and passage prefix to passages only', async () => {
  const spec = fakeSpec({ queryPrefix: 'Q:', passagePrefix: 'P:' });
  const provider = new FakeEmbeddingProvider(spec);
  const queryVector = await provider.embed('query', 'TCP三次握手');
  const passageVector = await provider.embed('passage', 'TCP三次握手');
  assert.deepEqual(queryVector, fakeEmbeddingFor('Q:TCP三次握手', spec));
  assert.deepEqual(passageVector, fakeEmbeddingFor('P:TCP三次握手', spec));
  assert.notDeepEqual(queryVector, fakeEmbeddingFor('P:TCP三次握手', spec));
  assert.notDeepEqual(passageVector, fakeEmbeddingFor('Q:TCP三次握手', spec));
  const e5 = new FakeEmbeddingProvider(E5_SMALL_SPEC);
  const e5Query = await e5.embed('query', 'TCP三次握手');
  const e5Passage = await e5.embed('passage', 'TCP三次握手');
  assert.deepEqual(e5Query, fakeEmbeddingFor('query: TCP三次握手', E5_SMALL_SPEC));
  assert.deepEqual(e5Passage, fakeEmbeddingFor('passage: TCP三次握手', E5_SMALL_SPEC));
  const bge = new FakeEmbeddingProvider(BGE_SMALL_ZH_SPEC);
  const bgeQuery = await bge.embed('query', 'TCP三次握手');
  const bgePassage = await bge.embed('passage', 'TCP三次握手');
  assert.deepEqual(bgeQuery, fakeEmbeddingFor('为这个句子生成表示以用于检索相关文章：TCP三次握手', BGE_SMALL_ZH_SPEC));
  assert.deepEqual(bgePassage, fakeEmbeddingFor('TCP三次握手', BGE_SMALL_ZH_SPEC));
});

test('TEST C — embeddings are finite, exact dimension and L2-normalized', async () => {
  const provider = new FakeEmbeddingProvider(fakeSpec({ dimension: 16 }));
  const vector = await provider.embed('query', '补码');
  assert.equal(vector.length, 16);
  assert.ok(vector.every((value) => Number.isFinite(value)));
  assert.ok(Math.abs(l2Norm(vector) - 1) < 1e-9);
});

test('TEST D — deterministic embedding for the same model/revision/text/view', async () => {
  const provider = new FakeEmbeddingProvider(fakeSpec());
  const a = await provider.embed('query', 'Cache平均访问时间');
  const b = await provider.embed('query', 'Cache平均访问时间');
  assert.deepEqual(a, b);
});

function fakeNode(overrides = {}) {
  return {
    id: 'cn-tcp-handshake',
    subject: 'CN',
    name: 'TCP三次握手',
    chapterName: '传输层',
    sectionName: 'TCP连接管理',
    nodeType: 'atomicPoint',
    isActive: true,
    ...overrides,
  };
}

async function fakeEmbedder(spec) {
  const provider = new FakeEmbeddingProvider(spec);
  return { embed: (view, text) => provider.embed(view, text) };
}

test('TEST E — subject is a hard filter even when a cross-subject node is more similar', async () => {
  const spec = fakeSpec({ dimension: 16 });
  const embedder = await fakeEmbedder(spec);
  const nodes = [
    fakeNode({ id: 'ds-same-name', subject: 'DS', name: 'TCP三次握手', chapterName: '传输层', sectionName: 'TCP连接管理' }),
    fakeNode({ id: 'cn-lookalike', subject: 'CN', name: 'TCP三次握手', chapterName: '传输层', sectionName: 'TCP连接管理' }),
  ];
  const result = await retrieveSemanticCandidates(embedder, nodes, 'DS', 'TCP三次握手', 8, 'query');
  assert.ok(result.length > 0);
  const subjectOf = new Map(nodes.map((entry) => [entry.id, entry.subject]));
  assert.ok(result.every((candidate) => subjectOf.get(candidate.nodeId) === 'DS'));
  assert.ok(!result.some((candidate) => candidate.nodeId === 'cn-lookalike'));
});

test('TEST F — inactive and non-atomic nodes never rank', async () => {
  const spec = fakeSpec({ dimension: 16 });
  const embedder = await fakeEmbedder(spec);
  const nodes = [
    fakeNode({ id: 'cn-active', name: 'TCP三次握手', chapterName: '传输层', sectionName: 'TCP连接管理' }),
    fakeNode({ id: 'cn-inactive', name: 'TCP三次握手', chapterName: '传输层', sectionName: 'TCP连接管理', isActive: false }),
    fakeNode({ id: 'cn-section', name: 'TCP三次握手', chapterName: '传输层', sectionName: 'TCP连接管理', nodeType: 'section' }),
  ];
  const result = await retrieveSemanticCandidates(embedder, nodes, 'CN', 'TCP三次握手', 8, 'query');
  const ids = result.map((candidate) => candidate.nodeId);
  assert.ok(ids.includes('cn-active'));
  assert.ok(!ids.includes('cn-inactive'));
  assert.ok(!ids.includes('cn-section'));
});

test('TEST G — stable ranking with nodeId ascending tie-break on equal similarity', async () => {
  const spec = fakeSpec({ dimension: 16 });
  const embedder = await fakeEmbedder(spec);
  const nodes = [
    fakeNode({ id: 'cn-b', name: '完全相同的节点文本', chapterName: '章', sectionName: '节' }),
    fakeNode({ id: 'cn-a', name: '完全相同的节点文本', chapterName: '章', sectionName: '节' }),
  ];
  const first = await retrieveSemanticCandidates(embedder, nodes, 'CN', '完全相同的节点文本', 8, 'query');
  const second = await retrieveSemanticCandidates(embedder, nodes, 'CN', '完全相同的节点文本', 8, 'query');
  assert.deepEqual(first, second);
  assert.deepEqual(first.map((candidate) => candidate.nodeId), ['cn-a', 'cn-b']);
});

test('TEST H — Top8 and Top12 are supported without duplicates', async () => {
  const spec = fakeSpec({ dimension: 16 });
  const embedder = await fakeEmbedder(spec);
  const nodes = [];
  for (let i = 1; i <= 15; i += 1) {
    nodes.push(fakeNode({ id: `cn-${String(i).padStart(2, '0')}`, name: `TCP三次握手变体${i}`, chapterName: '传输层', sectionName: 'TCP连接管理' }));
  }
  const top8 = await retrieveSemanticCandidates(embedder, nodes, 'CN', 'TCP三次握手', 8, 'query');
  const top12 = await retrieveSemanticCandidates(embedder, nodes, 'CN', 'TCP三次握手', 12, 'query');
  assert.equal(top8.length, 8);
  assert.equal(top12.length, 12);
  for (const result of [top8, top12]) {
    assert.equal(new Set(result.map((candidate) => candidate.nodeId)).size, result.length);
  }
});

test('TEST I — cache identity covers content, spec (id/revision/prefix/pooling) and view', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'emb-key-'));
  const base = fakeSpec();
  const run = async (spec, view, text) => embedWithCache(new FakeEmbeddingProvider(spec), view, text, dir);
  const keyFiles = () => readdirSync(dir).filter((name) => name.endsWith('.json'));
  await run(base, 'query', 'TCP');
  const oneKey = keyFiles().length;
  await run(base, 'query', 'TCP');
  assert.equal(keyFiles().length, oneKey, 'same content+spec+view -> same key');
  await run({ ...base, id: 'fake-other' }, 'query', 'TCP');
  assert.equal(keyFiles().length, oneKey + 1, 'model id change -> new key');
  await run({ ...base, revision: 'r2' }, 'query', 'TCP');
  assert.equal(keyFiles().length, oneKey + 2, 'revision change -> new key');
  await run({ ...base, queryPrefix: '检索：' }, 'query', 'TCP');
  assert.equal(keyFiles().length, oneKey + 3, 'queryPrefix change -> new key');
  await run({ ...base, pooling: 'cls' }, 'query', 'TCP');
  assert.equal(keyFiles().length, oneKey + 4, 'pooling change -> new key');
  await run(base, 'analysis', 'TCP');
  assert.equal(keyFiles().length, oneKey + 5, 'view change -> new key');
  assert.equal(existsSync(join(dir, 'unrelated.json')), false);
});

test('embeddingSpecHash is canonical and field-sensitive', () => {
  const spec = fakeSpec();
  assert.equal(embeddingSpecHash(spec), embeddingSpecHash({ ...spec }));
  assert.notEqual(embeddingSpecHash(spec), embeddingSpecHash({ ...spec, queryPrefix: 'x:' }));
  assert.notEqual(embeddingSpecHash(spec), embeddingSpecHash({ ...spec, pooling: 'cls' }));
  assert.notEqual(embeddingSpecHash(spec), embeddingSpecHash({ ...spec, revision: 'r2' }));
  assert.notEqual(embeddingSpecHash(spec), embeddingSpecHash({ ...spec, dimension: 16 }));
});

test('model selection rule is deterministic, model-agnostic and never reads holdout fields', () => {
  const rule = (a, b) =>
    b.primaryRecallAt8 - a.primaryRecallAt8 ||
    b.primaryRecallAt12 - a.primaryRecallAt12 ||
    b.macroAllRelevantAt12 - a.macroAllRelevantAt12 ||
    a.modelId.localeCompare(b.modelId);
  const e5 = { modelId: 'Xenova/multilingual-e5-small', primaryRecallAt8: 0.5, primaryRecallAt12: 0.6, macroAllRelevantAt12: 0.55 };
  const bge = { modelId: 'Xenova/bge-small-zh-v1.5', primaryRecallAt8: 0.4, primaryRecallAt12: 0.7, macroAllRelevantAt12: 0.6 };
  assert.equal(selectModelWinner({ e5, bge }, rule), 'e5');
  const tie = { ...e5, primaryRecallAt8: 0.4, primaryRecallAt12: 0.7, macroAllRelevantAt12: 0.6 };
  assert.equal(selectModelWinner({ e5: tie, bge }, rule), 'bge');
  assert.equal(
    selectModelWinner({ e5, bge: { ...bge, primaryRecallAt8: 0.5, primaryRecallAt12: 0.6, macroAllRelevantAt12: 0.55 } }, rule),
    'bge',
  );
});

test('benchmark split policy is fail-closed: DEV allowed, HOLDOUT rejected', () => {
  assert.equal(resolveBenchmarkSplit('DEV'), 'DEV');
  assert.throws(() => resolveBenchmarkSplit('HOLDOUT'), /HOLDOUT/);
  assert.throws(() => resolveBenchmarkSplit('ALL'), /DEV/);
});
