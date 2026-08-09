import { createHash } from 'node:crypto';

export const BENCHMARK_VERSION = 'retrieval-benchmark-v1';
export const GATE_RECALL8_MIN = 15 / 16;
export const GATE_RECALL12_MIN = 16 / 16;
export const GATE_MACRO_MIN = 0.9;

export function resolveBenchmarkSplit(split) {
  if (split === 'DEV') return 'DEV';
  if (split === 'HOLDOUT') return 'HOLDOUT';
  throw new Error(`unsupported benchmark split ${split}; expected DEV or HOLDOUT`);
}

export function selectSplitEntries(entries, split) {
  return (entries ?? []).filter((entry) => entry.split === split);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

/**
 * Deterministic SHA256 over the canonical (key-sorted) final retriever config.
 * Key order does not matter; any retrieval-relevant field change changes the
 * hash. Timestamps are never part of the frozen config and therefore never in
 * the hash.
 */
export function finalRetrieverConfigHash(config) {
  return createHash('sha256').update(JSON.stringify(canonicalize(config))).digest('hex');
}

export function validateFrozenConfig(config, expectedHash) {
  const errors = [];
  if (!config || typeof config !== 'object') {
    return { ok: false, errors: ['final retriever config missing; HOLDOUT gate requires a frozen config'] };
  }
  if (config.retriever !== 'semantic-e5-v1') {
    errors.push(`unexpected retriever ${config.retriever}; expected semantic-e5-v1`);
  }
  if (config.selectedOn !== 'DEV') {
    errors.push(`selectedOn must be DEV, got ${config.selectedOn}`);
  }
  if (config.holdoutEvaluatedBeforeFreeze !== 0) {
    errors.push(`holdoutEvaluatedBeforeFreeze must be 0, got ${config.holdoutEvaluatedBeforeFreeze}`);
  }
  if (typeof expectedHash !== 'string' || !/^[0-9a-f]{64}$/.test(expectedHash)) {
    errors.push('expected config hash missing');
  } else if (finalRetrieverConfigHash(config) !== expectedHash) {
    errors.push('final retriever config hash mismatch');
  }
  return { ok: errors.length === 0, errors: errors.sort() };
}

/**
 * Compute retrieval benchmark metrics. PRIMARY Recall@K counts questions whose
 * Gold primary is inside TopK; All Relevant recall is macro-averaged per
 * question (denominator = |PRIMARY ∪ SECONDARY| >= 1) and micro is diagnostic.
 * Cross-subject candidates are counted against each run's subjectNodeIds pool.
 */
export function computeBenchmarkMetrics(runs) {
  const count = runs.length;
  let primaryAt8 = 0;
  let primaryAt12 = 0;
  let macroSum = 0;
  let microHit = 0;
  let microTotal = 0;
  let crossSubject = 0;
  const perQuestionMisses = [];
  const perSubject = {};
  const perKp = {};

  for (const run of runs) {
    const top8 = (run.candidates ?? []).slice(0, 8);
    const top12 = (run.candidates ?? []).slice(0, 12);
    const top8Ids = new Set(top8.map((candidate) => candidate.nodeId));
    const top12Ids = new Set(top12.map((candidate) => candidate.nodeId));
    const primaryAt8Hit = run.goldPrimary != null && top8Ids.has(run.goldPrimary) ? 1 : 0;
    const primaryAt12Hit = run.goldPrimary != null && top12Ids.has(run.goldPrimary) ? 1 : 0;
    primaryAt8 += primaryAt8Hit;
    primaryAt12 += primaryAt12Hit;

    const relevant = new Set([run.goldPrimary, ...(run.goldSecondary ?? [])].filter(Boolean));
    const hit = [...relevant].filter((id) => top12Ids.has(id)).length;
    const perQuestionRecall = relevant.size > 0 ? hit / relevant.size : 0;
    macroSum += perQuestionRecall;
    microHit += hit;
    microTotal += relevant.size;

    if (run.subjectNodeIds) {
      for (const candidate of run.candidates ?? []) {
        if (!run.subjectNodeIds.has(candidate.nodeId)) crossSubject += 1;
      }
    } else {
      crossSubject += (run.candidates ?? []).filter((candidate) => candidate.subject !== undefined && candidate.subject !== run.subject).length;
    }

    if (primaryAt12Hit === 0 || perQuestionRecall < 1) {
      perQuestionMisses.push({ questionId: run.questionId, primaryFoundAt12: primaryAt12Hit === 1, macroRecall: perQuestionRecall });
    }

    perSubject[run.subject] ??= { questionCount: 0, primaryRecallAt12: 0, macroAllRelevantAt12: 0 };
    perSubject[run.subject].questionCount += 1;
    perSubject[run.subject].primaryRecallAt12 += primaryAt12Hit;
    perSubject[run.subject].macroAllRelevantAt12 += perQuestionRecall;
    for (const kpId of run.knowledgePointIds ?? []) {
      perKp[kpId] ??= { questionCount: 0, primaryRecallAt12: 0 };
      perKp[kpId].questionCount += 1;
      perKp[kpId].primaryRecallAt12 += primaryAt12Hit;
    }
  }

  for (const subject of Object.keys(perSubject)) {
    perSubject[subject].primaryRecallAt12 /= perSubject[subject].questionCount;
    perSubject[subject].macroAllRelevantAt12 /= perSubject[subject].questionCount;
  }
  return {
    primaryRecallAt8: count > 0 ? primaryAt8 / count : 0,
    primaryRecallAt12: count > 0 ? primaryAt12 / count : 0,
    macroAllRelevantAt12: count > 0 ? macroSum / count : 0,
    microAllRelevantAt12: microTotal > 0 ? microHit / microTotal : 0,
    crossSubjectCount: crossSubject,
    perQuestionMisses,
    perSubject,
    perKp,
  };
}

/**
 * Final gate: PRIMARY Recall@8 >= 15/16, PRIMARY Recall@12 = 16/16, Macro
 * AllRelevant@12 >= 0.90, cross-subject = 0, plus zero safety violations.
 */
export function evaluateRetrievalGate(metrics, holdoutCount) {
  const reasons = [];
  const hit8 = Math.round(metrics.primaryRecallAt8 * holdoutCount);
  const hit12 = Math.round(metrics.primaryRecallAt12 * holdoutCount);
  const required8 = Math.ceil(GATE_RECALL8_MIN * holdoutCount);
  const required12 = Math.ceil(GATE_RECALL12_MIN * holdoutCount);
  if (hit8 < required8) reasons.push(`PRIMARY Recall@8 ${hit8}/${holdoutCount} < ${required8}/${holdoutCount}`);
  if (hit12 < required12) reasons.push(`PRIMARY Recall@12 ${hit12}/${holdoutCount} < ${required12}/${holdoutCount}`);
  if (metrics.macroAllRelevantAt12 < GATE_MACRO_MIN) {
    reasons.push(`Macro AllRelevant@12 ${metrics.macroAllRelevantAt12} < ${GATE_MACRO_MIN}`);
  }
  if (metrics.crossSubjectCount !== 0) reasons.push(`cross-subject candidates ${metrics.crossSubjectCount} != 0`);
  for (const [key, label] of [
    ['activeAtomicViolations', 'active atomic violations'],
    ['invalidNodes', 'invalid node ids'],
    ['duplicates', 'duplicate candidates'],
    ['nonFiniteScores', 'non-finite scores'],
  ]) {
    if ((metrics[key] ?? 0) !== 0) reasons.push(`${label} ${metrics[key] ?? 0} != 0`);
  }
  return { pass: reasons.length === 0, reasons };
}
