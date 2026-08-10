import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  V2_BENCHMARK_VERSION,
  buildV2DevBenchmarkReport,
  resolveV2ExperimentSplit,
  runV2Cell,
} from '../scripts/run-benchmark-v2.mjs';

const SUBJECTS = ['DS', 'CO', 'OS', 'CN'];
const GOLD_SHA = '38cb67dbf0f0bdbfbe3101e70d7ec31d404db81e836592620b77c397a2a13c35';

function withCache(t) {
  const cacheDir = mkdtempSync(join(tmpdir(), 'benchmark-v2-'));
  t.after(() => rmSync(cacheDir, { recursive: true, force: true }));
  return cacheDir;
}

function provider() {
  return {
    spec: {
      id: 'synthetic/e5',
      revision: 'synthetic-revision',
      queryPrefix: 'query: ',
      passagePrefix: 'passage: ',
      pooling: 'mean',
      normalize: true,
      dimension: 2,
      transformersVersion: 'synthetic-transformers',
    },
    providerId: 'fake:synthetic/e5',
    modelVersion: 'synthetic-revision',
    async embed(view, text) {
      const value = String(text).toLowerCase();
      if (value.includes('beta')) return [0, 1];
      return [1, 0];
    },
  };
}

function syntheticBenchmarkFixture() {
  const questions = [];
  const nodes = [];
  const entries = [];
  const questionKnowledgePoints = [];

  for (const subject of SUBJECTS) {
    nodes.push(
      {
        id: `${subject}-alpha`,
        subject,
        name: 'Alpha',
        chapterName: 'Chapter',
        sectionName: 'Section',
        nodeType: 'atomicPoint',
        isActive: true,
      },
      {
        id: `${subject}-beta`,
        subject,
        name: 'Beta',
        chapterName: 'Chapter',
        sectionName: 'Section',
        nodeType: 'atomicPoint',
        isActive: true,
      },
      {
        id: `${subject}-inactive`,
        subject,
        name: 'Inactive',
        chapterName: 'Chapter',
        sectionName: 'Section',
        nodeType: 'atomicPoint',
        isActive: false,
      },
    );

    for (let index = 0; index < 10; index += 1) {
      const questionId = `${subject}-q-${String(index).padStart(2, '0')}`;
      const split = index < 8 ? 'DEV' : 'HOLDOUT';
      const primaryNodeId = index % 2 === 0 ? `${subject}-alpha` : `${subject}-beta`;
      questions.push({
        id: questionId,
        subject,
        stem: primaryNodeId.endsWith('alpha') ? 'Alpha signal' : 'Beta signal',
        analysis: primaryNodeId.endsWith('alpha') ? 'Alpha reasoning' : 'Beta reasoning',
      });
      entries.push({
        questionId,
        contentFingerprint: `fp-${questionId}`,
        primaryNodeId,
        secondaryNodeIds: [],
        split,
      });
      questionKnowledgePoints.push({ questionId, knowledgePointId: `${subject}-kp-${index % 4}` });
    }
  }

  return {
    snapshot: {
      snapshotId: 'snap-v2-40-benchmark-fixture',
      questions,
      nodes,
      questionKnowledgePoints,
    },
    truth: {
      goldVersion: 'gold-truth-v2r2-40',
      snapshotId: 'snap-v2-40-benchmark-fixture',
      entries,
      sha256: GOLD_SHA,
    },
  };
}

test('V2-7: DEV mode selects exactly 32 and HOLDOUT is rejected in selection mode', () => {
  assert.equal(resolveV2ExperimentSplit('DEV'), 'DEV');
  assert.throws(() => resolveV2ExperimentSplit('HOLDOUT'), /HOLDOUT.*one-shot/i);
  assert.throws(() => resolveV2ExperimentSplit('TRAIN'), /only DEV/i);
});

test('V2-7: runV2Cell maps all four pre-registered cells to semantic retrieval', async (t) => {
  const { snapshot } = syntheticBenchmarkFixture();
  const question = snapshot.questions[0];
  const cacheDir = withCache(t);
  for (const cell of ['Q1P1', 'Q1P2', 'Q2P1', 'Q2P2']) {
    const candidates = await runV2Cell(question, snapshot, provider(), cacheDir, cell);
    assert.ok(candidates.length > 0);
    assert.ok(candidates.every((candidate) => candidate.nodeId.startsWith(question.subject)));
  }
  await assert.rejects(
    runV2Cell(question, snapshot, provider(), cacheDir, 'Q3P1'),
    /unsupported V2 experiment cell/,
  );
});

test('V2-7: executes all four cells on the same 32 DEV ids and computes metrics', async (t) => {
  const { snapshot, truth } = syntheticBenchmarkFixture();
  const report = await buildV2DevBenchmarkReport({
    snapshot,
    truth,
    provider: provider(),
    cacheDir: withCache(t),
  });
  assert.equal(report.benchmarkVersion, V2_BENCHMARK_VERSION);
  assert.equal(report.goldVersion, 'gold-truth-v2r2-40');
  assert.equal(report.goldSha256, GOLD_SHA);
  assert.equal(report.selectionSplit, 'DEV');
  assert.equal(report.selectionQuestionCount, 32);
  assert.equal(report.evaluatedHoldout, 0);
  assert.deepEqual(Object.keys(report.experiments), ['Q1P1', 'Q1P2', 'Q2P1', 'Q2P2']);

  const ids = new Set(report.experiments.Q1P1.perQuestion.map((entry) => entry.questionId));
  assert.equal(ids.size, 32);
  for (const experiment of Object.values(report.experiments)) {
    assert.equal(experiment.questionCount, 32);
    assert.deepEqual(new Set(experiment.perQuestion.map((entry) => entry.questionId)), ids);
    assert.match(String(experiment.metrics.primaryRecallAt8), /^[\d.]+$/);
    assert.equal(typeof experiment.metrics.primaryMrr, 'number');
  }
});

test('V2-7: legacy V1 regression is reported separately and never merged into selection metrics', async (t) => {
  const { snapshot, truth } = syntheticBenchmarkFixture();
  const legacyTruth = {
    goldVersion: 'gold-truth-v1',
    snapshotId: snapshot.snapshotId,
    sha256: '6ca5fa53e8b0db415c7d7132445a72bf10297550d110df0b92f8ce301fabd99d',
    entries: truth.entries.slice(0, 4).map((entry) => ({ ...entry, split: 'DEV' })),
  };
  const report = await buildV2DevBenchmarkReport({
    snapshot,
    truth,
    provider: provider(),
    cacheDir: withCache(t),
    legacyTruth,
  });
  assert.equal(report.selectionQuestionCount, 32);
  assert.equal(report.legacyRegression.questionCount, 4);
  assert.equal(report.legacyRegression.inWinnerSelection, false);
  assert.equal(report.legacyRegression.goldVersion, 'gold-truth-v1');
});

test('V2-7: report is deterministic and git-safe', async (t) => {
  const { snapshot, truth } = syntheticBenchmarkFixture();
  const cacheDir = withCache(t);
  const first = await buildV2DevBenchmarkReport({ snapshot, truth, provider: provider(), cacheDir });
  const second = await buildV2DevBenchmarkReport({
    snapshot: { ...snapshot, questions: [...snapshot.questions].reverse(), nodes: [...snapshot.nodes].reverse() },
    truth: { ...truth, entries: [...truth.entries].reverse() },
    provider: provider(),
    cacheDir,
  });
  assert.deepEqual(second, first);
  const serialized = JSON.stringify(first);
  assert.equal(serialized.includes('Alpha signal'), false);
  assert.equal(serialized.includes('Beta reasoning'), false);
  assert.equal(serialized.includes('HOLDOUT'), false);
});
