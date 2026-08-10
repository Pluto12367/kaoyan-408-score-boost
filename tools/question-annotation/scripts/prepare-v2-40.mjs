import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { canonicalJsonHash } from '../core/canonical.js';
import {
  createGoldSetV2Forty,
  loadGoldSetV2Forty,
  migrateConfirmedGoldV2Forty,
} from '../core/gold.js';
import {
  V2R2_ACCEPTED_SAMPLE_SHA256,
} from '../core/sampleV2.js';
import {
  buildV2FortySampleManifest,
  buildV2FortySplitManifest,
  splitV2FortyDevHoldout,
  validateV2FortySampleManifest,
  validateV2FortySplitManifest,
} from '../core/sampleV2Forty.js';
import { buildFrozenV2FortyAuthoringContract } from './gold-author.mjs';

const TOOL_ROOT = fileURLToPath(new URL('..', import.meta.url));
const LOCAL_DATA = join(TOOL_ROOT, 'local-data');

function readJson(path, label) {
  if (!existsSync(path)) throw new Error(`${label} not found: ${path}`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function fileSha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function jsonSha256(value) {
  return canonicalJsonHash(value);
}

function atomicWriteJson(path, value) {
  const temporaryPath = `${path}.tmp-v2-40-${process.pid}`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    renameSync(temporaryPath, path);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function assertExistingJson(path, expected, label) {
  if (!existsSync(path)) {
    atomicWriteJson(path, expected);
    return;
  }
  const actual = readJson(path, `existing ${label}`);
  if (jsonSha256(actual) !== jsonSha256(expected)) {
    throw new Error(`existing ${label} drift; refusing to overwrite ${path}`);
  }
}

function resolveDefaultSnapshotPath() {
  const manifest = readJson(join(LOCAL_DATA, 'snapshot-manifest.json'), 'snapshot manifest');
  if (typeof manifest.snapshotFile !== 'string' || manifest.snapshotFile.length === 0) {
    throw new Error('snapshot manifest snapshotFile missing');
  }
  return join(LOCAL_DATA, manifest.snapshotFile);
}

function progress(goldSet) {
  const authoring = Object.values(goldSet.authoring ?? {});
  const confirmed = authoring.filter((entry) => entry?.status === 'confirmed').length;
  const draft = authoring.filter((entry) => entry?.status === 'draft').length;
  return { confirmed, draft, unstarted: 40 - confirmed - draft };
}

export function prepareV2FortyArtifacts({
  parentSamplePath = join(LOCAL_DATA, 'gold-sample-v2r2.json'),
  sourceGoldSetPath = join(LOCAL_DATA, 'gold-set-v2.json'),
  snapshotPath = resolveDefaultSnapshotPath(),
  outputDir = LOCAL_DATA,
  acceptedParentSha256 = V2R2_ACCEPTED_SAMPLE_SHA256,
  logger = console.log,
} = {}) {
  const inputPaths = [parentSamplePath, sourceGoldSetPath, snapshotPath];
  const inputHashesBefore = Object.fromEntries(inputPaths.map((path) => [path, fileSha256(path)]));
  const parentSample = readJson(parentSamplePath, 'accepted V2R2 parent sample');
  const sourceGoldSet = readJson(sourceGoldSetPath, 'source V2R2 Gold set');
  const snapshot = readJson(snapshotPath, 'annotation snapshot');
  if (parentSample.snapshotId !== snapshot.snapshotId || sourceGoldSet.snapshotId !== snapshot.snapshotId) {
    throw new Error('V2-40 preparation snapshot identity mismatch');
  }

  const sample = buildV2FortySampleManifest(parentSample, { acceptedParentSha256 });
  const sampleValidation = validateV2FortySampleManifest(sample, parentSample, { acceptedParentSha256 });
  if (!sampleValidation.ok) throw new Error(`V2-40 sample invalid: ${sampleValidation.errors.join('; ')}`);
  const split = splitV2FortyDevHoldout(sample);
  const splitManifest = buildV2FortySplitManifest({ sampleManifest: sample, split });
  const splitValidation = validateV2FortySplitManifest(splitManifest, sample);
  if (!splitValidation.ok) throw new Error(`V2-40 split invalid: ${splitValidation.errors.join('; ')}`);

  const frozen = buildFrozenV2FortyAuthoringContract({
    snapshotId: snapshot.snapshotId,
    sampleEntries: sample.entries,
    split: splitManifest.split,
  });
  const sampleOut = join(outputDir, 'gold-sample-v2r2-40.json');
  const splitOut = join(outputDir, 'gold-split-v2r2-40.json');
  const goldSetOut = join(outputDir, 'gold-set-v2r2-40.json');
  assertExistingJson(sampleOut, sample, 'V2-40 sample');
  assertExistingJson(splitOut, splitManifest, 'V2-40 split');

  let goldSet;
  let migratedCount;
  let supplementalConfirmedCount;
  if (existsSync(goldSetOut)) {
    goldSet = loadGoldSetV2Forty(goldSetOut);
    if (goldSet.snapshotId !== snapshot.snapshotId
      || goldSet.frozenManifestSha256 !== frozen.manifestSha256
      || jsonSha256(goldSet.frozen) !== jsonSha256(frozen.entries)) {
      throw new Error(`existing V2-40 Gold set drift; refusing to overwrite ${goldSetOut}`);
    }
    migratedCount = Object.values(goldSet.authoring).filter((entry) => entry?.status === 'confirmed').length;
    const targetIds = new Set(goldSet.frozen.map((entry) => entry.questionId));
    supplementalConfirmedCount = Object.entries(sourceGoldSet.authoring ?? {})
      .filter(([questionId, entry]) => entry?.status === 'confirmed' && !targetIds.has(questionId)).length;
  } else {
    const emptyGoldSet = createGoldSetV2Forty({
      snapshotId: snapshot.snapshotId,
      frozen: frozen.entries,
      frozenManifestSha256: frozen.manifestSha256,
    });
    const migrated = migrateConfirmedGoldV2Forty({ sourceGoldSet, targetGoldSet: emptyGoldSet, snapshot });
    goldSet = migrated.goldSet;
    migratedCount = migrated.migratedCount;
    supplementalConfirmedCount = migrated.supplementalConfirmedCount;
    atomicWriteJson(goldSetOut, goldSet);
  }

  const inputHashesAfter = Object.fromEntries(inputPaths.map((path) => [path, fileSha256(path)]));
  for (const path of inputPaths) {
    if (inputHashesBefore[path] !== inputHashesAfter[path]) {
      throw new Error(`historical input changed during V2-40 preparation: ${path}`);
    }
  }
  const state = progress(goldSet);
  const result = {
    total: sample.entries.length,
    dev: split.dev.length,
    holdout: split.holdout.length,
    confirmed: state.confirmed,
    draft: state.draft,
    unstarted: state.unstarted,
    migratedCount,
    supplementalConfirmedCount,
    sampleSha256: sample.sha256,
    splitSha256: splitManifest.sha256,
    frozenManifestSha256: frozen.manifestSha256,
    goldSetSha256: fileSha256(goldSetOut),
  };
  logger(`V2-40 sample version=${sample.goldVersion} sha256=${result.sampleSha256}`);
  logger(`V2-40 split DEV=${result.dev} HOLDOUT=${result.holdout} sha256=${result.splitSha256}`);
  logger(`V2-40 Gold confirmed=${result.confirmed} draft=${result.draft} unstarted=${result.unstarted}`);
  logger(`V2-40 migration migrated=${migratedCount} supplemental=${supplementalConfirmedCount}`);
  logger(`V2-40 frozenManifestSha256=${result.frozenManifestSha256}`);
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    prepareV2FortyArtifacts();
  } catch (error) {
    console.error(`[prepare-v2-40] FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
