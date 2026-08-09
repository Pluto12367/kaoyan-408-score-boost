import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { SUBJECTS, buildGoldManifest } from './sample.js';

export const GOLD_SET_VERSION = 'gold-set-v1';
export const GOLD_SAMPLE_MANIFEST_VERSION = 'gold-sample-v1';
export const GOLD_SET_VERSION_V2 = 'gold-set-v2';
export const GOLD_SAMPLE_MANIFEST_VERSION_V2 = 'gold-sample-v2r2';
export const GOLD_CONTRACT_V2 = Object.freeze({
  total: 100,
  dev: 72,
  holdout: 28,
  perSubject: 25,
  devPerSubject: 18,
  holdoutPerSubject: 7,
});

const GOLD_CONTRACT_V1 = Object.freeze({
  total: 40,
  dev: 24,
  holdout: 16,
  perSubject: 10,
  devPerSubject: 6,
  holdoutPerSubject: 4,
});
const GOLD_RUNTIME_V1 = Object.freeze({
  contract: GOLD_CONTRACT_V1,
  goldSetVersion: GOLD_SET_VERSION,
  sampleManifestVersion: GOLD_SAMPLE_MANIFEST_VERSION,
});
const GOLD_RUNTIME_V2 = Object.freeze({
  contract: GOLD_CONTRACT_V2,
  goldSetVersion: GOLD_SET_VERSION_V2,
  sampleManifestVersion: GOLD_SAMPLE_MANIFEST_VERSION_V2,
});

/**
 * Validate one Gold authoring entry. The locked signature is
 * (entry, nodeIds, byQuestion, nodeSubject); the optional fifth `context`
 * carries additive fail-closed bindings (active/atomic node sets, frozen
 * question ids, per-question fingerprint and split). Only these fields are
 * read — never future retrieval/embedding/AI metadata.
 *
 * Rules:
 * - PRIMARY exactly 1: exists, active, atomic, same subject as the question.
 * - SECONDARY 0..2: same eligibility, unique, and PRIMARY ∉ SECONDARY.
 * - When binding context is provided, snapshotId/fingerprint/split drift is
 *   rejected. Unknown questions and unknown nodes are rejected.
 */
export function validateGoldEntry(entry, nodeIds, byQuestion, nodeSubject, context = {}) {
  const errors = [];
  const questionId = entry?.questionId;
  const primaryNodeId = entry?.primaryNodeId;
  const secondaryNodeIds = entry?.secondaryNodeIds;
  const question = typeof questionId === 'string' ? byQuestion.get(questionId) : undefined;
  if (!question) {
    errors.push(`gold:${questionId ?? '?'} unknown or missing question`);
  }
  const questionSubject = question?.subject;

  if (context.frozenQuestionIds && questionId && !context.frozenQuestionIds.has(questionId)) {
    errors.push(`gold:${questionId} is not a frozen gold question`);
  }
  if (context.contentFingerprintByQuestion && questionId && context.contentFingerprintByQuestion.has(questionId)) {
    if (entry.contentFingerprint !== context.contentFingerprintByQuestion.get(questionId)) {
      errors.push(`gold:${questionId} contentFingerprint drift`);
    }
  }
  if (context.splitByQuestion && questionId && context.splitByQuestion.has(questionId)) {
    if (entry.split !== context.splitByQuestion.get(questionId)) {
      errors.push(`gold:${questionId} split drift (${entry.split} != ${context.splitByQuestion.get(questionId)})`);
    }
  }

  if (typeof primaryNodeId !== 'string' || primaryNodeId.length === 0) {
    errors.push(`gold:${questionId ?? '?'} PRIMARY missing`);
  } else if (!nodeIds.has(primaryNodeId)) {
    errors.push(`gold:${questionId ?? '?'} PRIMARY ${primaryNodeId} nonexistent`);
  } else {
    if (context.nodeActive && !context.nodeActive.has(primaryNodeId)) {
      errors.push(`gold:${questionId ?? '?'} PRIMARY ${primaryNodeId} inactive`);
    }
    if (context.nodeAtomic && !context.nodeAtomic.has(primaryNodeId)) {
      errors.push(`gold:${questionId ?? '?'} PRIMARY ${primaryNodeId} non-atomic`);
    }
    if (questionSubject && nodeSubject.get(primaryNodeId) !== questionSubject) {
      errors.push(`gold:${questionId ?? '?'} PRIMARY ${primaryNodeId} cross-subject`);
    }
  }

  if (!Array.isArray(secondaryNodeIds)) {
    errors.push(`gold:${questionId ?? '?'} secondaryNodeIds must be an array`);
  } else {
    if (secondaryNodeIds.length > 2) {
      errors.push(`gold:${questionId ?? '?'} SECONDARY count ${secondaryNodeIds.length} > 2`);
    }
    const seen = new Set();
    for (const nodeId of secondaryNodeIds) {
      if (typeof nodeId !== 'string' || nodeId.length === 0) {
        errors.push(`gold:${questionId ?? '?'} SECONDARY empty id`);
        continue;
      }
      if (nodeId === primaryNodeId) {
        errors.push(`gold:${questionId ?? '?'} PRIMARY ${nodeId} also SECONDARY`);
      }
      if (seen.has(nodeId)) {
        errors.push(`gold:${questionId ?? '?'} duplicate SECONDARY ${nodeId}`);
      }
      seen.add(nodeId);
      if (!nodeIds.has(nodeId)) {
        errors.push(`gold:${questionId ?? '?'} SECONDARY ${nodeId} nonexistent`);
        continue;
      }
      if (context.nodeActive && !context.nodeActive.has(nodeId)) {
        errors.push(`gold:${questionId ?? '?'} SECONDARY ${nodeId} inactive`);
      }
      if (context.nodeAtomic && !context.nodeAtomic.has(nodeId)) {
        errors.push(`gold:${questionId ?? '?'} SECONDARY ${nodeId} non-atomic`);
      }
      if (questionSubject && nodeSubject.get(nodeId) !== questionSubject) {
        errors.push(`gold:${questionId ?? '?'} SECONDARY ${nodeId} cross-subject`);
      }
    }
  }

  return { ok: errors.length === 0, errors: errors.sort() };
}

/**
 * Initialize a gitignored local gold authoring workspace from a frozen sample.
 * `frozen` entries carry questionId/contentFingerprint/subject/split; the
 * immutable frozen sample plus its manifest sha256 are stored so later runs
 * can fail closed if the frozen sample drifted.
 */
function createGoldSetWithRuntime({ snapshotId, frozen, frozenManifestSha256 }, runtime) {
  if (!Array.isArray(frozen) || frozen.length !== runtime.contract.total) {
    throw new Error(`createGoldSet expects ${runtime.contract.total} frozen entries, got ${frozen?.length ?? 'none'}`);
  }
  const sortedFrozen = [...frozen]
    .map((entry) => ({
      questionId: entry.questionId,
      contentFingerprint: entry.contentFingerprint,
      subject: entry.subject,
      split: entry.split,
    }))
    .sort((a, b) => a.questionId.localeCompare(b.questionId));
  const authoring = {};
  for (const entry of sortedFrozen) {
    authoring[entry.questionId] = { status: 'unstarted', primaryNodeId: null, secondaryNodeIds: [] };
  }
  return { goldVersion: runtime.goldSetVersion, snapshotId, frozenManifestSha256, frozen: sortedFrozen, authoring };
}

export function createGoldSet({ snapshotId, frozen, frozenManifestSha256 }) {
  return createGoldSetWithRuntime({ snapshotId, frozen, frozenManifestSha256 }, GOLD_RUNTIME_V1);
}

export function createGoldSetV2({ snapshotId, frozen, frozenManifestSha256 }) {
  return createGoldSetWithRuntime({ snapshotId, frozen, frozenManifestSha256 }, GOLD_RUNTIME_V2);
}

export function saveGoldSet(path, goldSet) {
  writeFileSync(path, `${JSON.stringify(goldSet, null, 2)}\n`, 'utf8');
}

/**
 * Resume-safe load. Returns null when the file does not exist yet and throws
 * on malformed or drifted gold-set files.
 */
function loadGoldSetWithRuntime(path, runtime) {
  if (!existsSync(path)) return null;
  const goldSet = JSON.parse(readFileSync(path, 'utf8'));
  if (goldSet.goldVersion !== runtime.goldSetVersion) {
    throw new Error(`gold set version mismatch: ${goldSet.goldVersion}`);
  }
  if (typeof goldSet.snapshotId !== 'string' || goldSet.snapshotId.length === 0) {
    throw new Error('gold set snapshotId missing');
  }
  if (!/^[a-f0-9]{64}$/.test(goldSet.frozenManifestSha256 ?? '')) {
    throw new Error('gold set frozenManifestSha256 invalid');
  }
  if (!Array.isArray(goldSet.frozen) || goldSet.frozen.length !== runtime.contract.total) {
    throw new Error(`gold set frozen must have ${runtime.contract.total} entries, got ${goldSet.frozen?.length ?? 'none'}`);
  }
  if (!goldSet.authoring || typeof goldSet.authoring !== 'object' || Array.isArray(goldSet.authoring)) {
    throw new Error('gold set authoring missing');
  }
  return goldSet;
}

export function loadGoldSet(path) {
  return loadGoldSetWithRuntime(path, GOLD_RUNTIME_V1);
}

export function loadGoldSetV2(path) {
  return loadGoldSetWithRuntime(path, GOLD_RUNTIME_V2);
}

function buildSnapshotMaps(snapshot) {
  const questions = snapshot.questions ?? [];
  const nodes = snapshot.nodes ?? [];
  return {
    nodeIds: new Set(nodes.map((node) => node.id)),
    nodeSubject: new Map(nodes.map((node) => [node.id, node.subject])),
    nodeActive: new Set(nodes.filter((node) => node.isActive).map((node) => node.id)),
    nodeAtomic: new Set(nodes.filter((node) => node.nodeType === 'atomicPoint').map((node) => node.id)),
    byQuestion: new Map(questions.map((question) => [question.id, { subject: question.subject }])),
    fingerprintByQuestion: new Map(questions.map((question) => [question.id, question.contentFingerprint])),
  };
}

/**
 * Freeze the final Gold Truth manifest. Only succeeds when:
 * - the gold-set snapshot identity matches the snapshot;
 * - the immutable frozen sample (Task 4) is untouched (manifest sha256 recomputed);
 * - every frozen question id is authored and status === 'confirmed';
 * - every entry passes validateGoldEntry (node eligibility, subject,
 *   fingerprint/split binding);
 * - aggregate counts match the selected V1 or V2 frozen contract.
 *
 * The returned manifest uses the shared buildGoldManifest shape and hashing;
 * version-specific aggregate validation happens in this function. The sha256
 * changes when PRIMARY/SECONDARY change. Incomplete authoring never yields a
 * manifest.
 */
function freezeGoldManifestWithRuntime({ goldVersion, goldSet, snapshot }, runtime) {
  const errors = [];
  if (!goldSet || typeof goldSet !== 'object') {
    return { ok: false, errors: ['goldSet missing'], manifest: undefined };
  }
  if (goldSet.goldVersion !== runtime.goldSetVersion) {
    errors.push(`gold set version mismatch: ${goldSet.goldVersion}`);
  }
  if (goldSet.snapshotId !== snapshot.snapshotId) {
    errors.push(`goldSet snapshot ${goldSet.snapshotId} does not match snapshot ${snapshot.snapshotId}`);
  }
  if (!Array.isArray(goldSet.frozen) || goldSet.frozen.length !== runtime.contract.total) {
    errors.push(`goldSet frozen must have ${runtime.contract.total} entries, got ${goldSet.frozen?.length ?? 'none'}`);
    return { ok: false, errors: errors.sort(), manifest: undefined };
  }

  const recomputedFrozenManifest = buildGoldManifest({
    goldVersion: runtime.sampleManifestVersion,
    snapshotId: goldSet.snapshotId,
    entries: goldSet.frozen.map((entry) => ({
      questionId: entry.questionId,
      contentFingerprint: entry.contentFingerprint,
      primaryNodeId: null,
      secondaryNodeIds: [],
      split: entry.split,
    })),
  });
  if (recomputedFrozenManifest.sha256 !== goldSet.frozenManifestSha256) {
    errors.push('goldSet frozen sample drifted (frozenManifestSha256 mismatch)');
  }

  const frozenById = new Map(goldSet.frozen.map((entry) => [entry.questionId, entry]));
  if (frozenById.size !== runtime.contract.total) {
    errors.push('goldSet frozen question ids must be unique');
  }
  const authoring = goldSet.authoring ?? {};
  const frozenIds = [...frozenById.keys()].sort();
  for (const id of frozenIds) {
    if (!(id in authoring)) errors.push(`gold question ${id} missing authoring entry`);
  }
  for (const id of Object.keys(authoring).filter((id) => !frozenById.has(id)).sort()) {
    errors.push(`authoring question ${id} is not a frozen gold question`);
  }

  const maps = buildSnapshotMaps(snapshot);
  const splitByQuestion = new Map(goldSet.frozen.map((entry) => [entry.questionId, entry.split]));
  const frozenQuestionIds = new Set(frozenIds);
  const manifestEntries = [];
  for (const frozenEntry of [...goldSet.frozen].sort((a, b) => a.questionId.localeCompare(b.questionId))) {
    const authored = authoring[frozenEntry.questionId];
    if (!authored) continue;
    if (authored.status !== 'confirmed') {
      errors.push(`gold question ${frozenEntry.questionId} not confirmed (${authored.status})`);
      continue;
    }
    const entry = {
      questionId: frozenEntry.questionId,
      contentFingerprint: frozenEntry.contentFingerprint,
      split: frozenEntry.split,
      primaryNodeId: authored.primaryNodeId,
      secondaryNodeIds: authored.secondaryNodeIds,
    };
    const validation = validateGoldEntry(entry, maps.nodeIds, maps.byQuestion, maps.nodeSubject, {
      nodeActive: maps.nodeActive,
      nodeAtomic: maps.nodeAtomic,
      frozenQuestionIds,
      contentFingerprintByQuestion: maps.fingerprintByQuestion,
      splitByQuestion,
    });
    for (const error of validation.errors) errors.push(error);
    if (validation.ok) {
      manifestEntries.push({
        questionId: entry.questionId,
        contentFingerprint: entry.contentFingerprint,
        primaryNodeId: entry.primaryNodeId,
        secondaryNodeIds: [...entry.secondaryNodeIds].sort(),
        split: entry.split,
      });
    }
  }

  if (manifestEntries.length !== runtime.contract.total) {
    errors.push(`confirmed gold entries ${manifestEntries.length} != ${runtime.contract.total}`);
  }
  const dev = manifestEntries.filter((entry) => entry.split === 'DEV').length;
  const holdout = manifestEntries.filter((entry) => entry.split === 'HOLDOUT').length;
  if (dev !== runtime.contract.dev) errors.push(`DEV total ${dev} != ${runtime.contract.dev}`);
  if (holdout !== runtime.contract.holdout) errors.push(`HOLDOUT total ${holdout} != ${runtime.contract.holdout}`);
  const perSubject = {};
  const devPerSubject = {};
  const holdoutPerSubject = {};
  for (const entry of manifestEntries) {
    const subject = maps.byQuestion.get(entry.questionId)?.subject;
    perSubject[subject] = (perSubject[subject] ?? 0) + 1;
    if (entry.split === 'DEV') devPerSubject[subject] = (devPerSubject[subject] ?? 0) + 1;
    else holdoutPerSubject[subject] = (holdoutPerSubject[subject] ?? 0) + 1;
  }
  for (const subject of SUBJECTS) {
    if (perSubject[subject] !== runtime.contract.perSubject) {
      errors.push(`subject ${subject} has ${perSubject[subject] ?? 0} confirmed gold questions, expected ${runtime.contract.perSubject}`);
    }
    if (devPerSubject[subject] !== runtime.contract.devPerSubject) {
      errors.push(`subject ${subject} DEV ${devPerSubject[subject] ?? 0} != ${runtime.contract.devPerSubject}`);
    }
    if (holdoutPerSubject[subject] !== runtime.contract.holdoutPerSubject) {
      errors.push(`subject ${subject} HOLDOUT ${holdoutPerSubject[subject] ?? 0} != ${runtime.contract.holdoutPerSubject}`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors: errors.sort(), manifest: undefined };
  }
  const manifest = buildGoldManifest({ goldVersion, snapshotId: goldSet.snapshotId, entries: manifestEntries });
  return { ok: true, errors: [], manifest };
}

export function freezeGoldManifest({ goldVersion, goldSet, snapshot }) {
  return freezeGoldManifestWithRuntime({ goldVersion, goldSet, snapshot }, GOLD_RUNTIME_V1);
}

export function freezeGoldManifestV2({ goldVersion, goldSet, snapshot }) {
  return freezeGoldManifestWithRuntime({ goldVersion, goldSet, snapshot }, GOLD_RUNTIME_V2);
}
