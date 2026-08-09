import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBenchmarkMetrics,
  evaluateRetrievalGate,
  finalRetrieverConfigHash,
  resolveBenchmarkSplit,
  selectSplitEntries,
  validateFrozenConfig,
} from '../core/benchmark.js';

const CONFIG = {
  version: 'final-retriever-v1',
  retriever: 'semantic-e5-v1',
  selectedOn: 'DEV',
  holdoutEvaluatedBeforeFreeze: 0,
  goldSha256: '6ca5fa53e8b0db415c7d7132445a72bf10297550d110df0b92f8ce301fabd99d',
  snapshotId: 'snap-399242fb3d7f',
  modelId: 'Xenova/multilingual-e5-small',
  resolvedRevision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
  transformersVersion: '3.8.1',
  queryPrefix: 'query: ',
  passagePrefix: 'passage: ',
  pooling: 'mean',
  normalize: true,
  dimension: 384,
  topKInitial: 8,
  topKExpanded: 12,
};

function syntheticEntries() {
  const entries = [];
  for (let i = 1; i <= 40; i += 1) {
    entries.push({ questionId: `q-${String(i).padStart(2, '0')}`, split: i <= 24 ? 'DEV' : 'HOLDOUT' });
  }
  return entries;
}

function run({ primaryRank = null, secondaryRanks = [], subject = 'DS', subjectNodeIds = null, candidates = null }) {
  const pool = subjectNodeIds ?? new Set(['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9', 'n10', 'n11', 'n12']);
  const list = candidates ?? Array.from({ length: 12 }, (_, index) => ({ nodeId: `n${index + 1}`, rank: index + 1, score: 1 / (index + 1) }));
  return {
    questionId: 'q-dev-1',
    subject,
    knowledgePointIds: ['kp-1'],
    candidates: list,
    goldPrimary: primaryRank == null ? null : `n${primaryRank}`,
    goldSecondary: secondaryRanks.map((rank) => `n${rank}`),
    subjectNodeIds: pool,
  };
}

test('TEST A — DEV split selects exactly 24', () => {
  assert.equal(resolveBenchmarkSplit('DEV'), 'DEV');
  assert.equal(selectSplitEntries(syntheticEntries(), 'DEV').length, 24);
});

test('TEST B — HOLDOUT split selects exactly 16', () => {
  assert.equal(resolveBenchmarkSplit('HOLDOUT'), 'HOLDOUT');
  assert.equal(selectSplitEntries(syntheticEntries(), 'HOLDOUT').length, 16);
  assert.throws(() => resolveBenchmarkSplit('ALL'), /DEV or HOLDOUT/);
});

test('TEST C — HOLDOUT is rejected when the final retriever config is not frozen', () => {
  const result = validateFrozenConfig(null, CONFIG_HASH());
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('config missing')));
});

test('TEST D — config hash mismatch rejects the HOLDOUT gate', () => {
  const hash = finalRetrieverConfigHash(CONFIG);
  assert.equal(validateFrozenConfig(CONFIG, hash).ok, true);
  const tampered = { ...CONFIG, dimension: 512 };
  assert.equal(validateFrozenConfig(tampered, hash).ok, false);
  assert.ok(validateFrozenConfig(tampered, hash).errors.some((error) => error.includes('hash mismatch')));
});

function CONFIG_HASH() {
  return finalRetrieverConfigHash(CONFIG);
}

test('TEST E — exact gate arithmetic boundaries', () => {
  const pass8 = evaluateRetrievalGate({ primaryRecallAt8: 15 / 16, primaryRecallAt12: 1, macroAllRelevantAt12: 0.95, crossSubjectCount: 0 }, 16);
  assert.equal(pass8.pass, true);
  assert.equal(evaluateRetrievalGate({ primaryRecallAt8: 14 / 16, primaryRecallAt12: 1, macroAllRelevantAt12: 0.95, crossSubjectCount: 0 }, 16).pass, false);
  assert.equal(evaluateRetrievalGate({ primaryRecallAt8: 15 / 16, primaryRecallAt12: 16 / 16, macroAllRelevantAt12: 0.95, crossSubjectCount: 0 }, 16).pass, true);
  assert.equal(evaluateRetrievalGate({ primaryRecallAt8: 15 / 16, primaryRecallAt12: 15 / 16, macroAllRelevantAt12: 0.95, crossSubjectCount: 0 }, 16).pass, false);
  assert.equal(evaluateRetrievalGate({ primaryRecallAt8: 15 / 16, primaryRecallAt12: 1, macroAllRelevantAt12: 0.9, crossSubjectCount: 0 }, 16).pass, true);
  assert.equal(evaluateRetrievalGate({ primaryRecallAt8: 15 / 16, primaryRecallAt12: 1, macroAllRelevantAt12: 0.89, crossSubjectCount: 0 }, 16).pass, false);
});

test('TEST F — cross-subject candidates fail the gate', () => {
  const metrics = { primaryRecallAt8: 1, primaryRecallAt12: 1, macroAllRelevantAt12: 1, crossSubjectCount: 1 };
  assert.equal(evaluateRetrievalGate(metrics, 16).pass, false);
});

test('TEST G — active atomic violations fail the gate', () => {
  const metrics = { primaryRecallAt8: 1, primaryRecallAt12: 1, macroAllRelevantAt12: 1, crossSubjectCount: 0, activeAtomicViolations: 1 };
  assert.equal(evaluateRetrievalGate(metrics, 16).pass, false);
});

test('TEST H — invalid node ids fail the gate', () => {
  const metrics = { primaryRecallAt8: 1, primaryRecallAt12: 1, macroAllRelevantAt12: 1, crossSubjectCount: 0, invalidNodes: 1 };
  assert.equal(evaluateRetrievalGate(metrics, 16).pass, false);
});

test('TEST I — duplicate candidates fail the gate', () => {
  const metrics = { primaryRecallAt8: 1, primaryRecallAt12: 1, macroAllRelevantAt12: 1, crossSubjectCount: 0, duplicates: 1 };
  assert.equal(evaluateRetrievalGate(metrics, 16).pass, false);
});

test('TEST J — non-finite scores fail the gate', () => {
  const metrics = { primaryRecallAt8: 1, primaryRecallAt12: 1, macroAllRelevantAt12: 1, crossSubjectCount: 0, nonFiniteScores: 1 };
  assert.equal(evaluateRetrievalGate(metrics, 16).pass, false);
});

test('computeBenchmarkMetrics produces recall metrics and per-question misses', () => {
  const runs = [
    run({ primaryRank: 3 }), // PRIMARY in top8
    run({ primaryRank: 9, secondaryRanks: [2] }), // PRIMARY only in top12, secondary in top8
    run({ primaryRank: 20, candidates: Array.from({ length: 12 }, (_, i) => ({ nodeId: `n${i + 1}`, rank: i + 1, score: 1 })) }), // miss
  ];
  const m = computeBenchmarkMetrics(runs);
  assert.ok(m.primaryRecallAt8 >= 0 && m.primaryRecallAt8 <= 1);
  assert.ok(m.primaryRecallAt12 >= m.primaryRecallAt8);
  assert.equal(m.primaryRecallAt12, 2 / 3);
  assert.ok(Number.isFinite(m.macroAllRelevantAt12));
  assert.ok(Number.isFinite(m.microAllRelevantAt12));
  assert.ok(m.perQuestionMisses.length > 0);
  assert.equal(m.crossSubjectCount, 0);
});

test('evaluateRetrievalGate matches the locked thresholds', () => {
  assert.equal(evaluateRetrievalGate({ primaryRecallAt8: 15 / 16, primaryRecallAt12: 1, macroAllRelevantAt12: 0.95, crossSubjectCount: 0 }, 16).pass, true);
  assert.equal(evaluateRetrievalGate({ primaryRecallAt8: 14 / 16, primaryRecallAt12: 1, macroAllRelevantAt12: 0.95, crossSubjectCount: 0 }, 16).pass, false);
  assert.equal(evaluateRetrievalGate({ primaryRecallAt8: 15 / 16, primaryRecallAt12: 15 / 16, macroAllRelevantAt12: 0.95, crossSubjectCount: 0 }, 16).pass, false);
  assert.equal(evaluateRetrievalGate({ primaryRecallAt8: 15 / 16, primaryRecallAt12: 1, macroAllRelevantAt12: 0.89, crossSubjectCount: 0 }, 16).pass, false);
  assert.equal(evaluateRetrievalGate({ primaryRecallAt8: 15 / 16, primaryRecallAt12: 1, macroAllRelevantAt12: 0.95, crossSubjectCount: 1 }, 16).pass, false);
});

test('final retriever config hash is canonical, key-order independent and field-sensitive', () => {
  const hash = finalRetrieverConfigHash(CONFIG);
  assert.equal(hash, finalRetrieverConfigHash(CONFIG));
  const reordered = {};
  for (const key of Object.keys(CONFIG).reverse()) reordered[key] = CONFIG[key];
  assert.equal(finalRetrieverConfigHash(reordered), hash);
  assert.notEqual(finalRetrieverConfigHash({ ...CONFIG, resolvedRevision: 'other' }), hash);
  assert.notEqual(finalRetrieverConfigHash({ ...CONFIG, modelId: 'other' }), hash);
  assert.notEqual(finalRetrieverConfigHash({ ...CONFIG, topKExpanded: 20 }), hash);
  assert.notEqual(finalRetrieverConfigHash({ ...CONFIG, queryPrefix: 'x: ' }), hash);
  assert.notEqual(finalRetrieverConfigHash({ ...CONFIG, pooling: 'cls' }), hash);
});
