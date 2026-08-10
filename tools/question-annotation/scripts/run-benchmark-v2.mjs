import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { computeBenchmarkMetrics } from '../core/benchmark.js';
import {
  evaluateV2Gate,
  finalV2ConfigHash,
  validateFrozenV2Config,
  V2_FINAL_HOLDOUT_COUNT,
} from '../core/benchmarkV2.js';
import { LocalTransformersProvider } from '../core/embedding.js';
import { retrieveSemanticV2 } from '../core/semanticAggregation.js';

const TOOL_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULTS = {
  snapshot: join(TOOL_ROOT, 'local-data', 'snapshot-snap-399242fb3d7f.json'),
  truth: join(TOOL_ROOT, 'local-data', 'gold-truth-manifest-v2r2-40.json'),
  legacyTruth: join(TOOL_ROOT, 'local-data', 'gold-truth-manifest-v1.json'),
  config: join(TOOL_ROOT, 'config', 'final-retriever-v2.json'),
  configHash: join(TOOL_ROOT, 'config', 'final-retriever-v2.sha256'),
  cacheDir: join(TOOL_ROOT, 'local-data', 'embedding-cache', 'v2'),
  metaDir: join(TOOL_ROOT, 'local-data', 'embedding-meta'),
  reportOut: join(TOOL_ROOT, 'local-data', 'benchmark-v2-dev.json'),
  holdoutReportOut: join(TOOL_ROOT, 'local-data', 'benchmark-v2-holdout.json'),
};

export const V2_BENCHMARK_VERSION = 'retrieval-benchmark-v2';
export const V2_GOLD_TRUTH_VERSION = 'gold-truth-v2r2-40';
export const V2_GOLD_TRUTH_SHA256 = '38cb67dbf0f0bdbfbe3101e70d7ec31d404db81e836592620b77c397a2a13c35';
export const V2_DEV_QUESTION_COUNT = 32;
export const V2_HOLDOUT_QUESTION_COUNT = 8;
export const V2_EXPERIMENTS = Object.freeze({
  Q1P1: Object.freeze({ queryMode: 'Q1', passageFormat: 'P1', complexityCost: 0 }),
  Q1P2: Object.freeze({ queryMode: 'Q1', passageFormat: 'P2', complexityCost: 1 }),
  Q2P1: Object.freeze({ queryMode: 'Q2', passageFormat: 'P1', complexityCost: 1 }),
  Q2P2: Object.freeze({ queryMode: 'Q2', passageFormat: 'P2', complexityCost: 2 }),
});

const V2_MODEL_SPEC = Object.freeze({
  id: 'Xenova/multilingual-e5-small',
  revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
  queryPrefix: 'query: ',
  passagePrefix: 'passage: ',
  pooling: 'mean',
  normalize: true,
  dimension: 384,
  transformersVersion: '3.8.1',
});

export function resolveV2ExperimentSplit(split) {
  if (split === 'DEV') return 'DEV';
  if (split === 'HOLDOUT') {
    throw new Error('HOLDOUT is reserved for the explicit one-shot V2 gate; V2-7 selection mode is DEV-only');
  }
  throw new Error(`unsupported V2 benchmark split ${split}; only DEV is allowed in V2-7`);
}

export function resolveV2HoldoutSplit(split) {
  if (split === 'HOLDOUT') return 'HOLDOUT';
  throw new Error(`unsupported V2 one-shot split ${split}; expected HOLDOUT`);
}

function parseArgs(argv) {
  const args = { split: 'DEV', legacy: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--snapshot') args.snapshot = argv[++index];
    else if (token === '--truth') args.truth = argv[++index];
    else if (token === '--legacy-truth') args.legacyTruth = argv[++index];
    else if (token === '--config') args.config = argv[++index];
    else if (token === '--config-hash') args.configHash = argv[++index];
    else if (token === '--cache-dir') args.cacheDir = argv[++index];
    else if (token === '--meta-dir') args.metaDir = argv[++index];
    else if (token === '--report-out') args.reportOut = argv[++index];
    else if (token === '--split') args.split = argv[++index];
    else if (token === '--legacy') args.legacy = true;
  }
  return args;
}

function readConfigHash(input) {
  if (typeof input !== 'string' || input.length === 0) throw new Error('V2 HOLDOUT gate requires a config hash');
  return existsSync(input) ? readFileSync(input, 'utf8').trim() : input;
}

function questionMaps(snapshot) {
  return {
    questionById: new Map((snapshot.questions ?? []).map((question) => [question.id, question])),
    nodeById: new Map((snapshot.nodes ?? []).map((node) => [node.id, node])),
    kpIdsByQuestion: (snapshot.questionKnowledgePoints ?? []).reduce((map, relation) => {
      const list = map.get(relation.questionId) ?? [];
      list.push(relation.knowledgePointId);
      map.set(relation.questionId, list.sort());
      return map;
    }, new Map()),
    poolBySubject: (snapshot.nodes ?? []).reduce((map, node) => {
      if (node?.isActive === true && node?.nodeType === 'atomicPoint') {
        const set = map.get(node.subject) ?? new Set();
        set.add(node.id);
        map.set(node.subject, set);
      }
      return map;
    }, new Map()),
  };
}

function selectDevEntries(truth, { expectedCount = null } = {}) {
  const entries = (truth.entries ?? [])
    .filter((entry) => entry.split === 'DEV')
    .slice()
    .sort((left, right) => left.questionId.localeCompare(right.questionId));
  if (expectedCount !== null && entries.length !== expectedCount) {
    throw new Error(`DEV questions ${entries.length} != ${expectedCount}`);
  }
  return entries;
}

function selectHoldoutEntries(truth, { expectedCount = null } = {}) {
  const entries = (truth.entries ?? [])
    .filter((entry) => entry.split === 'HOLDOUT')
    .slice()
    .sort((left, right) => left.questionId.localeCompare(right.questionId));
  if (expectedCount !== null && entries.length !== expectedCount) {
    throw new Error(`HOLDOUT questions ${entries.length} != ${expectedCount}`);
  }
  return entries;
}

function assertV2Truth(truth, snapshot) {
  if (truth?.goldVersion !== V2_GOLD_TRUTH_VERSION) {
    throw new Error(`V2-7 requires ${V2_GOLD_TRUTH_VERSION}, got ${truth?.goldVersion ?? 'missing'}`);
  }
  if (truth.sha256 !== V2_GOLD_TRUTH_SHA256) {
    throw new Error(`V2-7 Gold truth sha mismatch: ${truth.sha256}`);
  }
  if (truth.snapshotId !== snapshot.snapshotId) {
    throw new Error(`V2-7 Gold truth snapshot ${truth.snapshotId} != ${snapshot.snapshotId}`);
  }
}

function summarizeSafety(candidates, nodeById) {
  const seen = new Set();
  const safety = { activeAtomicViolations: 0, invalidNodes: 0, duplicates: 0, nonFiniteScores: 0 };
  for (const candidate of candidates) {
    const node = nodeById.get(candidate.nodeId);
    if (!node) safety.invalidNodes += 1;
    else if (node.isActive !== true || node.nodeType !== 'atomicPoint') safety.activeAtomicViolations += 1;
    if (!Number.isFinite(candidate.rrfScore)) safety.nonFiniteScores += 1;
    if (seen.has(candidate.nodeId)) safety.duplicates += 1;
    seen.add(candidate.nodeId);
  }
  return safety;
}

function addSafety(left, right) {
  return {
    activeAtomicViolations: left.activeAtomicViolations + right.activeAtomicViolations,
    invalidNodes: left.invalidNodes + right.invalidNodes,
    duplicates: left.duplicates + right.duplicates,
    nonFiniteScores: left.nonFiniteScores + right.nonFiniteScores,
  };
}

function primaryMrr(runs) {
  if (runs.length === 0) return 0;
  const total = runs.reduce((sum, run) => {
    const rank = (run.candidates ?? []).find((candidate) => candidate.nodeId === run.goldPrimary)?.finalRank;
    return sum + (rank ? 1 / rank : 0);
  }, 0);
  return total / runs.length;
}

export async function runV2Cell(question, snapshot, provider, cacheDir, cell) {
  const experiment = V2_EXPERIMENTS[cell];
  if (!experiment) throw new Error(`unsupported V2 experiment cell: ${cell}`);
  return retrieveSemanticV2(question, snapshot, provider, cacheDir, experiment);
}

async function runExperiment({ experimentId, entries, snapshot, provider, cacheDir }) {
  const { questionById, nodeById, kpIdsByQuestion, poolBySubject } = questionMaps(snapshot);
  const runs = [];
  const perQuestion = [];
  let safety = { activeAtomicViolations: 0, invalidNodes: 0, duplicates: 0, nonFiniteScores: 0 };

  for (const entry of entries) {
    const question = questionById.get(entry.questionId);
    if (!question) throw new Error(`benchmark question ${entry.questionId} missing from snapshot`);
    const candidates = await runV2Cell(question, snapshot, provider, cacheDir, experimentId);
    safety = addSafety(safety, summarizeSafety(candidates, nodeById));
    const relevant = new Set([entry.primaryNodeId, ...(entry.secondaryNodeIds ?? [])].filter(Boolean));
    const relevantRanks = candidates
      .filter((candidate) => relevant.has(candidate.nodeId))
      .map((candidate) => candidate.finalRank)
      .sort((left, right) => left - right);
    const primaryRank = candidates.find((candidate) => candidate.nodeId === entry.primaryNodeId)?.finalRank ?? null;
    runs.push({
      questionId: entry.questionId,
      subject: question.subject,
      knowledgePointIds: kpIdsByQuestion.get(entry.questionId) ?? [],
      candidates,
      goldPrimary: entry.primaryNodeId,
      goldSecondary: entry.secondaryNodeIds ?? [],
      subjectNodeIds: poolBySubject.get(question.subject) ?? new Set(),
    });
    perQuestion.push({
      questionId: entry.questionId,
      goldPrimaryRank: primaryRank,
      relevantRanks,
      candidates: candidates.map((candidate) => ({
        nodeId: candidate.nodeId,
        rank: candidate.finalRank,
        rrfScore: candidate.rrfScore,
        stemRank: candidate.stemRank,
        analysisRank: candidate.analysisRank,
      })),
    });
  }

  const metrics = computeBenchmarkMetrics(runs);
  return {
    experimentId,
    ...V2_EXPERIMENTS[experimentId],
    questionCount: entries.length,
    metrics: { ...metrics, primaryMrr: primaryMrr(runs) },
    safety,
    perQuestion,
  };
}

async function buildLegacyRegression({ snapshot, legacyTruth, provider, cacheDir }) {
  if (!legacyTruth) return null;
  if (legacyTruth.snapshotId !== snapshot.snapshotId) {
    throw new Error(`legacy Gold truth snapshot ${legacyTruth.snapshotId} != ${snapshot.snapshotId}`);
  }
  const entries = selectDevEntries(legacyTruth);
  const report = await runExperiment({ experimentId: 'Q1P1', entries, snapshot, provider, cacheDir });
  return {
    goldVersion: legacyTruth.goldVersion,
    goldSha256: legacyTruth.sha256,
    questionCount: report.questionCount,
    inWinnerSelection: false,
    metrics: report.metrics,
    safety: report.safety,
  };
}

export async function buildV2DevBenchmarkReport({ snapshot, truth, provider, cacheDir, legacyTruth = null }) {
  resolveV2ExperimentSplit('DEV');
  assertV2Truth(truth, snapshot);
  const entries = selectDevEntries(truth, { expectedCount: V2_DEV_QUESTION_COUNT });
  const experiments = {};
  for (const experimentId of Object.keys(V2_EXPERIMENTS)) {
    experiments[experimentId] = await runExperiment({ experimentId, entries, snapshot, provider, cacheDir });
  }
  return {
    benchmarkVersion: V2_BENCHMARK_VERSION,
    goldVersion: truth.goldVersion,
    goldSha256: truth.sha256,
    snapshotId: truth.snapshotId,
    selectionSplit: 'DEV',
    selectionQuestionCount: entries.length,
    evaluatedHoldout: 0,
    model: {
      id: provider.spec.id,
      revision: provider.spec.revision,
      transformersVersion: provider.spec.transformersVersion,
      queryPrefix: provider.spec.queryPrefix,
      passagePrefix: provider.spec.passagePrefix,
      pooling: provider.spec.pooling,
      normalize: provider.spec.normalize,
      dimension: provider.spec.dimension,
    },
    experiments,
    legacyRegression: await buildLegacyRegression({ snapshot, legacyTruth, provider, cacheDir }),
  };
}

export async function buildV2HoldoutGateReport({ snapshot, truth, config, configHash, provider, cacheDir }) {
  resolveV2HoldoutSplit('HOLDOUT');
  assertV2Truth(truth, snapshot);
  const frozen = validateFrozenV2Config(config, configHash);
  if (!frozen.ok) throw new Error(`V2 HOLDOUT gate blocked: ${frozen.errors.join('; ')}`);
  if (configHash !== finalV2ConfigHash(config)) {
    throw new Error('V2 HOLDOUT gate blocked: final V2 retriever config hash mismatch');
  }
  const entries = selectHoldoutEntries(truth, { expectedCount: V2_FINAL_HOLDOUT_COUNT });
  const experiment = await runExperiment({
    experimentId: config.experimentId,
    entries,
    snapshot,
    provider,
    cacheDir,
  });
  const gate = evaluateV2Gate({ ...experiment.metrics, ...experiment.safety }, entries.length);
  return {
    benchmarkVersion: V2_BENCHMARK_VERSION,
    goldVersion: truth.goldVersion,
    goldSha256: truth.sha256,
    snapshotId: truth.snapshotId,
    evaluationSplit: 'HOLDOUT',
    holdoutQuestionCount: entries.length,
    configHash,
    configSelectedOn: config.selectedOn,
    configHoldoutEvaluatedBeforeFreeze: config.holdoutEvaluatedBeforeFreeze,
    retriever: {
      id: config.retriever,
      modelId: config.modelId,
      resolvedRevision: config.resolvedRevision,
      transformersVersion: config.transformersVersion,
      queryPrefix: config.queryPrefix,
      passagePrefix: config.passagePrefix,
      pooling: config.pooling,
      normalize: config.normalize,
      dimension: config.dimension,
      topKInitial: config.topKInitial,
      topKExpanded: config.topKExpanded,
      queryViewVersion: config.queryViewVersion,
      passageVersion: config.passageVersion,
      passageFormatVersion: config.passageFormatVersion,
      semanticAggregationVersion: config.semanticAggregationVersion,
    },
    experiment,
    gate,
    holdoutConsumed: true,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const snapshot = JSON.parse(readFileSync(args.snapshot ?? DEFAULTS.snapshot, 'utf8'));
  const truth = JSON.parse(readFileSync(args.truth ?? DEFAULTS.truth, 'utf8'));
  const cacheDir = args.cacheDir ?? DEFAULTS.cacheDir;
  if (args.split === 'HOLDOUT') {
    resolveV2HoldoutSplit(args.split);
    const config = JSON.parse(readFileSync(args.config ?? DEFAULTS.config, 'utf8'));
    const configHash = readConfigHash(args.configHash ?? DEFAULTS.configHash);
    const provider = new LocalTransformersProvider(
      {
        id: config.modelId,
        revision: config.resolvedRevision,
        queryPrefix: config.queryPrefix,
        passagePrefix: config.passagePrefix,
        pooling: config.pooling,
        normalize: config.normalize,
        dimension: config.dimension,
        transformersVersion: config.transformersVersion,
      },
      { modelCacheDir: cacheDir, metaDir: args.metaDir ?? DEFAULTS.metaDir },
    );
    const report = await buildV2HoldoutGateReport({
      snapshot,
      truth,
      config,
      configHash,
      provider,
      cacheDir: join(cacheDir, 'vectors'),
    });
    const reportOut = args.reportOut ?? DEFAULTS.holdoutReportOut;
    writeFileSync(reportOut, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    const count = report.holdoutQuestionCount;
    const hit8 = Math.round(report.experiment.metrics.primaryRecallAt8 * count);
    const hit12 = Math.round(report.experiment.metrics.primaryRecallAt12 * count);
    console.log(`HOLDOUT evaluated: ${count}`);
    console.log(`experiment: ${report.experiment.experimentId}`);
    console.log(`PRIMARY Recall@8=${hit8}/${count} (${report.experiment.metrics.primaryRecallAt8.toFixed(4)})`);
    console.log(`PRIMARY Recall@12=${hit12}/${count} (${report.experiment.metrics.primaryRecallAt12.toFixed(4)})`);
    console.log(`Macro AllRelevant@12=${report.experiment.metrics.macroAllRelevantAt12.toFixed(4)}`);
    console.log(`safety: crossSubject=${report.experiment.metrics.crossSubjectCount} activeAtomicViolations=${report.experiment.safety.activeAtomicViolations} invalidNodes=${report.experiment.safety.invalidNodes} duplicates=${report.experiment.safety.duplicates} nonFiniteScores=${report.experiment.safety.nonFiniteScores}`);
    console.log(`report: ${reportOut}`);
    console.log(report.gate.pass ? 'RETRIEVAL_V2_GATE_PASS' : 'RETRIEVAL_V2_GATE_FAIL');
    if (!report.gate.pass) console.log(`gate reasons: ${report.gate.reasons.join('; ')}`);
    return;
  }

  resolveV2ExperimentSplit(args.split);
  const provider = new LocalTransformersProvider(V2_MODEL_SPEC, {
    modelCacheDir: cacheDir,
    metaDir: args.metaDir ?? DEFAULTS.metaDir,
  });
  const legacyPath = args.legacyTruth ?? DEFAULTS.legacyTruth;
  const legacyTruth = args.legacy && existsSync(legacyPath)
    ? JSON.parse(readFileSync(legacyPath, 'utf8'))
    : null;
  const report = await buildV2DevBenchmarkReport({
    snapshot,
    truth,
    provider,
    cacheDir: join(cacheDir, 'vectors'),
    legacyTruth,
  });
  writeFileSync(args.reportOut ?? DEFAULTS.reportOut, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`DEV evaluated: ${report.selectionQuestionCount}; HOLDOUT evaluated: 0`);
  for (const experiment of Object.values(report.experiments)) {
    const hit8 = Math.round(experiment.metrics.primaryRecallAt8 * experiment.questionCount);
    const hit12 = Math.round(experiment.metrics.primaryRecallAt12 * experiment.questionCount);
    console.log(
      `${experiment.experimentId}: PRIMARY Recall@8=${hit8}/${experiment.questionCount} ` +
        `PRIMARY Recall@12=${hit12}/${experiment.questionCount} ` +
        `Macro=${experiment.metrics.macroAllRelevantAt12.toFixed(4)} ` +
        `MRR=${experiment.metrics.primaryMrr.toFixed(4)}`,
    );
  }
  if (report.legacyRegression) {
    console.log(`legacy regression reported separately: ${report.legacyRegression.questionCount}`);
  }
  console.log(`report: ${args.reportOut ?? DEFAULTS.reportOut}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[run-benchmark-v2] FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
