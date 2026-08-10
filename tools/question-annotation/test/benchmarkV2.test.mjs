import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  V2_BENCHMARK_VERSION,
  buildV2HoldoutGateReport,
  buildV2DevBenchmarkReport,
  resolveV2HoldoutSplit,
  resolveV2ExperimentSplit,
  runV2Cell,
} from '../scripts/run-benchmark-v2.mjs';
import {
  buildFinalV2Config,
  evaluateV2Gate,
  finalV2ConfigHash,
  selectV2Winner,
  validateFrozenV2Config,
} from '../core/benchmarkV2.js';

const SUBJECTS = ['DS', 'CO', 'OS', 'CN'];
const GOLD_SHA = '38cb67dbf0f0bdbfbe3101e70d7ec31d404db81e836592620b77c397a2a13c35';
const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const TOOL_ROOT = join(TEST_DIR, '..');

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

function metricCell(experimentId, metrics = {}, overrides = {}) {
  const defaults = {
    primaryRecallAt8: 0.5,
    primaryRecallAt12: 0.5,
    macroAllRelevantAt12: 0.5,
    primaryMrr: 0.5,
  };
  return {
    experimentId,
    questionCount: 32,
    queryMode: experimentId.slice(0, 2),
    passageFormat: experimentId.slice(2),
    metrics: { ...defaults, ...metrics },
    ...overrides,
  };
}

function fullMetricSet(overrides = {}) {
  const { experiments: experimentOverrides = {}, ...rest } = overrides;
  return {
    benchmarkVersion: V2_BENCHMARK_VERSION,
    goldVersion: 'gold-truth-v2r2-40',
    goldSha256: GOLD_SHA,
    snapshotId: 'snap-v2-40-benchmark-fixture',
    selectionSplit: 'DEV',
    selectionQuestionCount: 32,
    evaluatedHoldout: 0,
    experiments: {
      Q1P1: metricCell('Q1P1'),
      Q1P2: metricCell('Q1P2'),
      Q2P1: metricCell('Q2P1'),
      Q2P2: metricCell('Q2P2'),
      ...experimentOverrides,
    },
    ...rest,
  };
}

test('V2-8: selection order is Recall@12, Recall@8, Macro, PRIMARY MRR, complexity, experimentId', () => {
  assert.equal(selectV2Winner(fullMetricSet({
    experiments: {
      Q1P1: metricCell('Q1P1', { primaryRecallAt12: 0.80 }),
      Q1P2: metricCell('Q1P2', { primaryRecallAt12: 0.90, primaryRecallAt8: 0.10 }),
      Q2P1: metricCell('Q2P1', { primaryRecallAt12: 0.80, primaryRecallAt8: 1.00 }),
      Q2P2: metricCell('Q2P2', { primaryRecallAt12: 0.80, macroAllRelevantAt12: 1.00 }),
    },
  })).experimentId, 'Q1P2');

  assert.equal(selectV2Winner(fullMetricSet({
    experiments: {
      Q1P1: metricCell('Q1P1', { primaryRecallAt12: 1, primaryRecallAt8: 1, macroAllRelevantAt12: 1, primaryMrr: 0.50 }),
      Q2P1: metricCell('Q2P1', { primaryRecallAt12: 1, primaryRecallAt8: 1, macroAllRelevantAt12: 1, primaryMrr: 0.75 }),
    },
  })).experimentId, 'Q2P1');

  assert.equal(selectV2Winner(fullMetricSet({
    experiments: {
      Q1P2: metricCell('Q1P2', { primaryRecallAt12: 1, primaryRecallAt8: 1, macroAllRelevantAt12: 1, primaryMrr: 1 }),
      Q2P1: metricCell('Q2P1', { primaryRecallAt12: 1, primaryRecallAt8: 1, macroAllRelevantAt12: 1, primaryMrr: 1 }),
      Q2P2: metricCell('Q2P2', { primaryRecallAt12: 1, primaryRecallAt8: 1, macroAllRelevantAt12: 1, primaryMrr: 1 }),
    },
  })).experimentId, 'Q1P2');
});

test('V2-8: accepts only the exact V2-40 DEV32 metric input', () => {
  assert.throws(() => selectV2Winner(fullMetricSet({ selectionQuestionCount: 72 })), /DEV32|32/);
  assert.throws(() => selectV2Winner(fullMetricSet({ selectionQuestionCount: 112 })), /DEV32|32/);
  assert.throws(() => selectV2Winner(fullMetricSet({ selectionSplit: 'HOLDOUT' })), /DEV/);
  assert.throws(() => selectV2Winner(fullMetricSet({ evaluatedHoldout: 1 })), /HOLDOUT/);
  assert.throws(() => selectV2Winner(fullMetricSet({ goldVersion: 'gold-truth-v2' })), /gold-truth-v2r2-40/);
});

test('V2-8: final config is canonical, field-sensitive, and frozen before HOLDOUT', () => {
  const winner = selectV2Winner(fullMetricSet({
    experiments: {
      Q1P1: metricCell('Q1P1', { primaryRecallAt12: 1, primaryRecallAt8: 1, macroAllRelevantAt12: 1, primaryMrr: 0.798 }),
      Q2P1: metricCell('Q2P1', { primaryRecallAt12: 1, primaryRecallAt8: 1, macroAllRelevantAt12: 1, primaryMrr: 0.738 }),
    },
  }));
  const config = buildFinalV2Config({
    winner,
    goldSha256: GOLD_SHA,
    snapshotId: 'snap-v2-40-benchmark-fixture',
  });
  assert.equal(config.version, 'final-retriever-v2');
  assert.equal(config.selectedOn, 'DEV-V2');
  assert.equal(config.holdoutEvaluatedBeforeFreeze, 0);
  assert.equal(config.experimentId, 'Q1P1');
  assert.equal(config.queryMode, 'Q1');
  assert.equal(config.passageFormat, 'P1');
  assert.equal(config.goldVersion, 'gold-truth-v2r2-40');
  assert.equal(config.devQuestionCount, 32);

  const hash = finalV2ConfigHash(config);
  assert.equal(finalV2ConfigHash({ ...config }), hash);
  assert.notEqual(finalV2ConfigHash({ ...config, experimentId: 'Q2P1' }), hash);
  assert.deepEqual(validateFrozenV2Config(config, hash), { ok: true, errors: [] });
  assert.equal(validateFrozenV2Config(config, '0'.repeat(64)).ok, false);
  assert.equal(validateFrozenV2Config({ ...config, holdoutEvaluatedBeforeFreeze: 1 }, hash).ok, false);
});

test('V2-8: freeze CLI writes config plus hash from a DEV32 report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'freeze-v2-'));
  try {
    const reportPath = join(dir, 'benchmark-v2-dev.json');
    const configPath = join(dir, 'final-retriever-v2.json');
    const hashPath = join(dir, 'final-retriever-v2.sha256');
    const report = fullMetricSet({
      experiments: {
        Q1P1: metricCell('Q1P1', { primaryRecallAt12: 1, primaryRecallAt8: 1, macroAllRelevantAt12: 1, primaryMrr: 0.8 }),
        Q2P1: metricCell('Q2P1', { primaryRecallAt12: 1, primaryRecallAt8: 1, macroAllRelevantAt12: 1, primaryMrr: 0.7 }),
      },
    });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    const result = spawnSync(process.execPath, [
      join(TOOL_ROOT, 'scripts', 'freeze-retriever-v2.mjs'),
      '--report',
      reportPath,
      '--config-out',
      configPath,
      '--hash-out',
      hashPath,
    ], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(configPath), true);
    assert.equal(existsSync(hashPath), true);
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    const hash = readFileSync(hashPath, 'utf8').trim();
    assert.equal(config.experimentId, 'Q1P1');
    assert.equal(validateFrozenV2Config(config, hash).ok, true);
    assert.match(result.stdout, /WINNER: Q1P1/);
    assert.match(result.stdout, /HOLDOUT evaluated before freeze: 0/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function gateMetrics(overrides = {}) {
  return {
    primaryRecallAt8: 1,
    primaryRecallAt12: 1,
    macroAllRelevantAt12: 0.9,
    crossSubjectCount: 0,
    activeAtomicViolations: 0,
    invalidNodes: 0,
    duplicates: 0,
    nonFiniteScores: 0,
    ...overrides,
  };
}

function frozenConfig(overrides = {}) {
  const config = buildFinalV2Config({
    winner: { experimentId: 'Q1P1' },
    goldSha256: GOLD_SHA,
    snapshotId: 'snap-v2-40-benchmark-fixture',
  });
  return { ...config, ...overrides };
}

test('V2-9: locked V2-40 gate requires 8/8 PRIMARY Recall@8 and 8/8 PRIMARY Recall@12', () => {
  assert.deepEqual(evaluateV2Gate(gateMetrics(), 8), { pass: true, reasons: [] });
  assert.equal(evaluateV2Gate(gateMetrics({ primaryRecallAt8: 7 / 8 }), 8).pass, false);
  assert.match(evaluateV2Gate(gateMetrics({ primaryRecallAt8: 7 / 8 }), 8).reasons.join('\n'), /Recall@8 7\/8 < 8\/8/);
  assert.equal(evaluateV2Gate(gateMetrics({ primaryRecallAt12: 7 / 8 }), 8).pass, false);
  assert.match(evaluateV2Gate(gateMetrics({ primaryRecallAt12: 7 / 8 }), 8).reasons.join('\n'), /Recall@12 7\/8 < 8\/8/);
  assert.throws(() => evaluateV2Gate(gateMetrics(), 28), /V2-40 HOLDOUT8/);
});

test('V2-9: macro threshold is 0.90 and every safety counter must be zero', () => {
  assert.equal(evaluateV2Gate(gateMetrics({ macroAllRelevantAt12: 0.9 }), 8).pass, true);
  assert.equal(evaluateV2Gate(gateMetrics({ macroAllRelevantAt12: 0.89 }), 8).pass, false);
  for (const key of ['crossSubjectCount', 'activeAtomicViolations', 'invalidNodes', 'duplicates', 'nonFiniteScores']) {
    const result = evaluateV2Gate(gateMetrics({ [key]: 1 }), 8);
    assert.equal(result.pass, false, key);
    assert.match(result.reasons.join('\n'), new RegExp(key));
  }
});

test('V2-9: HOLDOUT mode is separate from DEV selection mode and selects exactly 8', async (t) => {
  assert.equal(resolveV2HoldoutSplit('HOLDOUT'), 'HOLDOUT');
  assert.throws(() => resolveV2HoldoutSplit('DEV'), /HOLDOUT/);

  const { snapshot, truth } = syntheticBenchmarkFixture();
  const config = frozenConfig();
  const report = await buildV2HoldoutGateReport({
    snapshot,
    truth,
    config,
    configHash: finalV2ConfigHash(config),
    provider: provider(),
    cacheDir: withCache(t),
  });
  assert.equal(report.evaluationSplit, 'HOLDOUT');
  assert.equal(report.holdoutQuestionCount, 8);
  assert.equal(report.configHoldoutEvaluatedBeforeFreeze, 0);
  assert.equal(report.experiment.experimentId, 'Q1P1');
  assert.equal(report.experiment.perQuestion.length, 8);
  assert.equal(report.gate.pass, true);
  assert.equal(JSON.stringify(report).includes('Alpha signal'), false);
  assert.equal(JSON.stringify(report).includes('Beta reasoning'), false);
});

test('V2-9: runner requires frozen config, valid hash, DEV-V2 selection, and zero prior HOLDOUT', async (t) => {
  const { snapshot, truth } = syntheticBenchmarkFixture();
  const base = frozenConfig();
  const common = { snapshot, truth, provider: provider(), cacheDir: withCache(t) };
  await assert.rejects(
    buildV2HoldoutGateReport({ ...common, config: { ...base, selectedOn: 'HOLDOUT' }, configHash: finalV2ConfigHash({ ...base, selectedOn: 'HOLDOUT' }) }),
    /selectedOn/,
  );
  await assert.rejects(
    buildV2HoldoutGateReport({ ...common, config: { ...base, holdoutEvaluatedBeforeFreeze: 1 }, configHash: finalV2ConfigHash({ ...base, holdoutEvaluatedBeforeFreeze: 1 }) }),
    /holdoutEvaluatedBeforeFreeze/,
  );
  await assert.rejects(
    buildV2HoldoutGateReport({ ...common, config: base, configHash: '0'.repeat(64) }),
    /hash mismatch/,
  );
});
