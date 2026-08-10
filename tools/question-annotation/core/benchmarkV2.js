import { finalRetrieverConfigHash } from './benchmark.js';
import { QUERY_VIEW_VERSION } from './queryViews.js';
import { PASSAGE_FORMAT, PASSAGE_VERSION } from './passage.js';
import { SEMANTIC_AGGREGATION_VERSION } from './semanticAggregation.js';

export const FINAL_RETRIEVER_V2_VERSION = 'final-retriever-v2';
export const SEMANTIC_RETRIEVER_V2_VERSION = 'semantic-retriever-v2';
export const V2_FINAL_GOLD_VERSION = 'gold-truth-v2r2-40';
export const V2_FINAL_DEV_COUNT = 32;
export const V2_FINAL_HOLDOUT_COUNT = 8;
export const V2_FINAL_GATE_MACRO_MIN = 0.9;
export const V2_FINAL_MODEL = Object.freeze({
  modelId: 'Xenova/multilingual-e5-small',
  resolvedRevision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
  transformersVersion: '3.8.1',
  queryPrefix: 'query: ',
  passagePrefix: 'passage: ',
  pooling: 'mean',
  normalize: true,
  dimension: 384,
});

const COMPLEXITY_COST = Object.freeze({
  Q1P1: 0,
  Q1P2: 1,
  Q2P1: 1,
  Q2P2: 2,
});

const EXPERIMENT_SHAPE = Object.freeze({
  Q1P1: Object.freeze({ queryMode: 'Q1', passageFormat: 'P1' }),
  Q1P2: Object.freeze({ queryMode: 'Q1', passageFormat: 'P2' }),
  Q2P1: Object.freeze({ queryMode: 'Q2', passageFormat: 'P1' }),
  Q2P2: Object.freeze({ queryMode: 'Q2', passageFormat: 'P2' }),
});

function metricNumber(cell, key) {
  const value = cell?.metrics?.[key];
  if (!Number.isFinite(value)) throw new Error(`V2 metric ${cell?.experimentId ?? 'unknown'}.${key} must be finite`);
  return value;
}

function assertDev32Report(report) {
  if (report?.benchmarkVersion !== 'retrieval-benchmark-v2') {
    throw new Error(`V2-8 requires retrieval-benchmark-v2, got ${report?.benchmarkVersion ?? 'missing'}`);
  }
  if (report.goldVersion !== V2_FINAL_GOLD_VERSION) {
    throw new Error(`V2-8 requires ${V2_FINAL_GOLD_VERSION}, got ${report.goldVersion}`);
  }
  if (report.selectionSplit !== 'DEV') throw new Error(`V2-8 requires DEV metrics, got ${report.selectionSplit}`);
  if (report.selectionQuestionCount !== V2_FINAL_DEV_COUNT) {
    throw new Error(`V2-8 requires DEV32 metrics, got ${report.selectionQuestionCount}`);
  }
  if (report.evaluatedHoldout !== 0) throw new Error('V2-8 requires HOLDOUT evaluated count to be 0');
  for (const experimentId of Object.keys(EXPERIMENT_SHAPE)) {
    const experiment = report.experiments?.[experimentId];
    if (!experiment) throw new Error(`V2-8 missing experiment ${experimentId}`);
    if (experiment.experimentId !== experimentId) throw new Error(`V2-8 experiment key ${experimentId} does not match ${experiment.experimentId}`);
    if (experiment.questionCount !== V2_FINAL_DEV_COUNT) {
      throw new Error(`V2-8 experiment ${experimentId} must have DEV32 metrics, got ${experiment.questionCount}`);
    }
    for (const key of ['primaryRecallAt12', 'primaryRecallAt8', 'macroAllRelevantAt12', 'primaryMrr']) {
      metricNumber(experiment, key);
    }
  }
}

function compareWinner(left, right) {
  return metricNumber(right, 'primaryRecallAt12') - metricNumber(left, 'primaryRecallAt12')
    || metricNumber(right, 'primaryRecallAt8') - metricNumber(left, 'primaryRecallAt8')
    || metricNumber(right, 'macroAllRelevantAt12') - metricNumber(left, 'macroAllRelevantAt12')
    || metricNumber(right, 'primaryMrr') - metricNumber(left, 'primaryMrr')
    || COMPLEXITY_COST[left.experimentId] - COMPLEXITY_COST[right.experimentId]
    || left.experimentId.localeCompare(right.experimentId);
}

export function selectV2Winner(report) {
  assertDev32Report(report);
  return Object.keys(EXPERIMENT_SHAPE)
    .map((experimentId) => report.experiments[experimentId])
    .sort(compareWinner)[0];
}

export function buildFinalV2Config({ winner, goldSha256, snapshotId }) {
  const experimentId = winner?.experimentId;
  const shape = EXPERIMENT_SHAPE[experimentId];
  if (!shape) throw new Error(`unsupported V2 winner experiment ${experimentId}`);
  if (typeof goldSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(goldSha256)) {
    throw new Error('V2 final config requires a 64-char goldSha256');
  }
  if (typeof snapshotId !== 'string' || snapshotId.length === 0) {
    throw new Error('V2 final config requires snapshotId');
  }
  return {
    version: FINAL_RETRIEVER_V2_VERSION,
    retriever: SEMANTIC_RETRIEVER_V2_VERSION,
    experimentId,
    queryMode: shape.queryMode,
    passageFormat: shape.passageFormat,
    complexityCost: COMPLEXITY_COST[experimentId],
    selectedOn: 'DEV-V2',
    devQuestionCount: V2_FINAL_DEV_COUNT,
    holdoutQuestionCount: V2_FINAL_HOLDOUT_COUNT,
    holdoutEvaluatedBeforeFreeze: 0,
    goldVersion: V2_FINAL_GOLD_VERSION,
    goldSha256,
    snapshotId,
    modelId: V2_FINAL_MODEL.modelId,
    resolvedRevision: V2_FINAL_MODEL.resolvedRevision,
    transformersVersion: V2_FINAL_MODEL.transformersVersion,
    queryPrefix: V2_FINAL_MODEL.queryPrefix,
    passagePrefix: V2_FINAL_MODEL.passagePrefix,
    pooling: V2_FINAL_MODEL.pooling,
    normalize: V2_FINAL_MODEL.normalize,
    dimension: V2_FINAL_MODEL.dimension,
    queryViewVersion: QUERY_VIEW_VERSION,
    passageVersion: PASSAGE_VERSION,
    passageFormatVersion: PASSAGE_FORMAT,
    semanticAggregationVersion: SEMANTIC_AGGREGATION_VERSION,
    topKInitial: 8,
    topKExpanded: 12,
  };
}

export function finalV2ConfigHash(config) {
  return finalRetrieverConfigHash(config);
}

export function validateFrozenV2Config(config, expectedHash) {
  const errors = [];
  if (!config || typeof config !== 'object') {
    return { ok: false, errors: ['final V2 retriever config missing'] };
  }
  if (config.version !== FINAL_RETRIEVER_V2_VERSION) errors.push(`version must be ${FINAL_RETRIEVER_V2_VERSION}`);
  if (config.retriever !== SEMANTIC_RETRIEVER_V2_VERSION) errors.push(`retriever must be ${SEMANTIC_RETRIEVER_V2_VERSION}`);
  if (!EXPERIMENT_SHAPE[config.experimentId]) errors.push(`unsupported experimentId ${config.experimentId}`);
  if (config.selectedOn !== 'DEV-V2') errors.push(`selectedOn must be DEV-V2, got ${config.selectedOn}`);
  if (config.devQuestionCount !== V2_FINAL_DEV_COUNT) errors.push(`devQuestionCount must be ${V2_FINAL_DEV_COUNT}`);
  if (config.holdoutQuestionCount !== V2_FINAL_HOLDOUT_COUNT) errors.push(`holdoutQuestionCount must be ${V2_FINAL_HOLDOUT_COUNT}`);
  if (config.holdoutEvaluatedBeforeFreeze !== 0) {
    errors.push(`holdoutEvaluatedBeforeFreeze must be 0, got ${config.holdoutEvaluatedBeforeFreeze}`);
  }
  if (config.goldVersion !== V2_FINAL_GOLD_VERSION) errors.push(`goldVersion must be ${V2_FINAL_GOLD_VERSION}`);
  if (config.topKInitial !== 8) errors.push('topKInitial must be 8');
  if (config.topKExpanded !== 12) errors.push('topKExpanded must be 12');
  if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    errors.push('expected config hash missing');
  } else if (finalV2ConfigHash(config) !== expectedHash) {
    errors.push('final V2 retriever config hash mismatch');
  }
  return { ok: errors.length === 0, errors: errors.sort() };
}

export function evaluateV2Gate(metrics, holdoutCount) {
  if (holdoutCount !== V2_FINAL_HOLDOUT_COUNT) {
    throw new Error(`V2-40 HOLDOUT8 gate requires ${V2_FINAL_HOLDOUT_COUNT} questions, got ${holdoutCount}`);
  }
  const reasons = [];
  const hit8 = Math.round((metrics?.primaryRecallAt8 ?? 0) * holdoutCount);
  const hit12 = Math.round((metrics?.primaryRecallAt12 ?? 0) * holdoutCount);
  if (hit8 < holdoutCount) reasons.push(`primaryRecallAt8 Recall@8 ${hit8}/${holdoutCount} < ${holdoutCount}/${holdoutCount}`);
  if (hit12 < holdoutCount) reasons.push(`primaryRecallAt12 Recall@12 ${hit12}/${holdoutCount} < ${holdoutCount}/${holdoutCount}`);
  if (!Number.isFinite(metrics?.macroAllRelevantAt12) || metrics.macroAllRelevantAt12 < V2_FINAL_GATE_MACRO_MIN) {
    reasons.push(`macroAllRelevantAt12 ${metrics?.macroAllRelevantAt12 ?? 'missing'} < ${V2_FINAL_GATE_MACRO_MIN}`);
  }
  for (const key of [
    'crossSubjectCount',
    'activeAtomicViolations',
    'invalidNodes',
    'duplicates',
    'nonFiniteScores',
  ]) {
    if ((metrics?.[key] ?? 0) !== 0) reasons.push(`${key} ${metrics?.[key] ?? 0} != 0`);
  }
  return { pass: reasons.length === 0, reasons };
}
