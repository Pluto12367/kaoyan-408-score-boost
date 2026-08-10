import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildGoldManifest } from '../core/sample.js';
import { buildV2SplitManifest } from '../core/sampleV2.js';
import { canonicalJsonHash } from '../core/canonical.js';
import {
  V2_FORTY_GOLD_SAMPLE_VERSION,
  buildV2FortySplitManifest,
  splitV2FortyDevHoldout,
} from '../core/sampleV2Forty.js';
import * as gold from '../core/gold.js';
import * as goldAuthor from '../scripts/gold-author.mjs';

const SUBJECTS = ['DS', 'CO', 'OS', 'CN'];

function buildV2Fixture() {
  const snapshot = { snapshotId: 'snap-gold-v2-fixture', questions: [], nodes: [] };
  const frozen = [];
  for (const subject of SUBJECTS) {
    snapshot.nodes.push({
      id: `${subject}-atomic`,
      subject,
      nodeType: 'atomicPoint',
      name: `${subject} synthetic atomic`,
      isActive: true,
    });
    for (let index = 0; index < 25; index += 1) {
      const questionId = `${subject}-v2-${String(index + 1).padStart(2, '0')}`;
      const contentFingerprint = `fp-${questionId}`;
      const split = index < 18 ? 'DEV' : 'HOLDOUT';
      snapshot.questions.push({ id: questionId, subject, contentFingerprint, isCurrent: true });
      frozen.push({ questionId, contentFingerprint, subject, split });
    }
  }
  const frozenManifest = buildGoldManifest({
    goldVersion: 'gold-sample-v2r2',
    snapshotId: snapshot.snapshotId,
    entries: frozen.map((entry) => ({
      questionId: entry.questionId,
      contentFingerprint: entry.contentFingerprint,
      primaryNodeId: null,
      secondaryNodeIds: [],
      split: entry.split,
    })),
  });
  return { snapshot, frozen, frozenManifestSha256: frozenManifest.sha256 };
}

function createV2GoldSet({ confirmedCount = 0 } = {}) {
  assert.equal(typeof gold.createGoldSetV2, 'function');
  const fixture = buildV2Fixture();
  const goldSet = gold.createGoldSetV2({
    snapshotId: fixture.snapshot.snapshotId,
    frozen: fixture.frozen,
    frozenManifestSha256: fixture.frozenManifestSha256,
  });
  fixture.frozen
    .slice()
    .sort((left, right) => left.questionId.localeCompare(right.questionId))
    .forEach((entry, index) => {
      if (index >= confirmedCount) return;
      goldSet.authoring[entry.questionId] = {
        status: 'confirmed',
        primaryNodeId: `${entry.subject}-atomic`,
        secondaryNodeIds: [],
      };
    });
  return { ...fixture, goldSet };
}

function buildV2FortyFixture() {
  const source = buildV2Fixture();
  const frozen = [];
  for (const subject of SUBJECTS) {
    const selected = source.frozen.filter((entry) => entry.subject === subject).slice(0, 10);
    selected.forEach((entry, index) => frozen.push({
      ...entry,
      split: index < 8 ? 'DEV' : 'HOLDOUT',
    }));
  }
  const frozenManifest = buildGoldManifest({
    goldVersion: 'gold-sample-v2r2-40',
    snapshotId: source.snapshot.snapshotId,
    entries: frozen.map((entry) => ({
      questionId: entry.questionId,
      contentFingerprint: entry.contentFingerprint,
      primaryNodeId: null,
      secondaryNodeIds: [],
      split: entry.split,
    })),
  });
  return { ...source, frozen, frozenManifestSha256: frozenManifest.sha256 };
}

function createV2FortyGoldSet({ confirmedCount = 0 } = {}) {
  const fixture = buildV2FortyFixture();
  const goldSet = gold.createGoldSetV2Forty({
    snapshotId: fixture.snapshot.snapshotId,
    frozen: fixture.frozen,
    frozenManifestSha256: fixture.frozenManifestSha256,
  });
  fixture.frozen
    .slice()
    .sort((left, right) => left.questionId.localeCompare(right.questionId))
    .forEach((entry, index) => {
      if (index >= confirmedCount) return;
      goldSet.authoring[entry.questionId] = {
        status: 'confirmed',
        primaryNodeId: `${entry.subject}-atomic`,
        secondaryNodeIds: [],
      };
    });
  return { ...fixture, goldSet };
}

function buildV2FortySampleFixture() {
  const entries = [];
  for (const subject of SUBJECTS) {
    const kpIds = [`${subject}-kp-a`, `${subject}-kp-b`, `${subject}-kp-c`, `${subject}-kp-d`];
    const rows = [
      ['BASIC', 'MEDIUM', 'HARD'],
      ['BASIC', 'MEDIUM', 'HARD'],
      ['BASIC', 'MEDIUM'],
      ['BASIC', 'MEDIUM'],
    ];
    rows.forEach((difficulties, kpIndex) => difficulties.forEach((difficulty) => {
      const questionId = `${subject}-40-${kpIndex}-${difficulty}`;
      entries.push({
        questionId,
        contentFingerprint: `fp-${questionId}`,
        subject,
        difficulty,
        source: 'synthetic',
        year: 2026,
        knowledgePointIds: [kpIds[kpIndex]],
      });
    }));
  }
  const payload = {
    goldVersion: V2_FORTY_GOLD_SAMPLE_VERSION,
    snapshotId: 'snap-gold-v2-40-fixture',
    contentSha256: '2'.repeat(64),
    parentSampleSha256: 'be4485afd48a9107be3cfc63e896047911b642f95d013a649b7e17d8638109d4',
    entries: entries.sort((left, right) => left.questionId.localeCompare(right.questionId)),
  };
  return { ...payload, sha256: canonicalJsonHash(payload) };
}

test('V2-40 Gold runtime initializes and freezes exact 40/32/8 without changing V1/V2 contracts', () => {
  assert.deepEqual(gold.GOLD_CONTRACT_V2_FORTY, {
    total: 40,
    dev: 32,
    holdout: 8,
    perSubject: 10,
    devPerSubject: 8,
    holdoutPerSubject: 2,
  });
  const { snapshot, goldSet } = createV2FortyGoldSet({ confirmedCount: 40 });
  assert.equal(goldSet.goldVersion, 'gold-set-v2r2-40');
  assert.equal(goldSet.frozen.length, 40);
  const result = gold.freezeGoldManifestV2Forty({
    goldVersion: 'gold-truth-v2r2-40',
    goldSet,
    snapshot,
  });
  assert.equal(result.ok, true, result.errors?.join('\n'));
  assert.equal(result.manifest.entries.length, 40);
  assert.equal(result.manifest.entries.filter((entry) => entry.split === 'DEV').length, 32);
  assert.equal(result.manifest.entries.filter((entry) => entry.split === 'HOLDOUT').length, 8);
  assert.equal(gold.GOLD_CONTRACT_V2.total, 100);
  assert.equal(gold.GOLD_SET_VERSION_V2, 'gold-set-v2');
  assert.equal(gold.GOLD_SET_VERSION, 'gold-set-v1');
});

test('V2-40 Gold freeze fails closed on incomplete authoring and frozen fingerprint drift', () => {
  const incomplete = createV2FortyGoldSet({ confirmedCount: 39 });
  const incompleteResult = gold.freezeGoldManifestV2Forty({
    goldVersion: 'gold-truth-v2r2-40',
    goldSet: incomplete.goldSet,
    snapshot: incomplete.snapshot,
  });
  assert.equal(incompleteResult.ok, false);
  assert.match(incompleteResult.errors.join('\n'), /confirmed|40/);

  const drifted = createV2FortyGoldSet({ confirmedCount: 40 });
  drifted.snapshot.questions[0].contentFingerprint = 'drifted';
  const driftedResult = gold.freezeGoldManifestV2Forty({
    goldVersion: 'gold-truth-v2r2-40',
    goldSet: drifted.goldSet,
    snapshot: drifted.snapshot,
  });
  assert.equal(driftedResult.ok, false);
  assert.match(driftedResult.errors.join('\n'), /fingerprint/i);
});

test('V2-40 migration copies only selected confirmed human labels and never mutates source or target inputs', () => {
  const sourceFixture = createV2GoldSet();
  for (const subject of SUBJECTS) {
    const ids = sourceFixture.frozen.filter((entry) => entry.subject === subject).map((entry) => entry.questionId);
    for (const id of ids.slice(0, 3)) {
      sourceFixture.goldSet.authoring[id] = {
        status: 'confirmed',
        primaryNodeId: `${subject}-atomic`,
        secondaryNodeIds: [],
      };
    }
    sourceFixture.goldSet.authoring[ids[3]] = {
      status: 'draft',
      primaryNodeId: `${subject}-atomic`,
      secondaryNodeIds: [],
    };
  }
  const targetFixture = createV2FortyGoldSet();
  const sourceBefore = structuredClone(sourceFixture.goldSet);
  const targetBefore = structuredClone(targetFixture.goldSet);
  const result = gold.migrateConfirmedGoldV2Forty({
    sourceGoldSet: sourceFixture.goldSet,
    targetGoldSet: targetFixture.goldSet,
    snapshot: targetFixture.snapshot,
  });
  assert.equal(result.migratedCount, 12);
  assert.equal(Object.values(result.goldSet.authoring).filter((entry) => entry.status === 'confirmed').length, 12);
  assert.equal(Object.values(result.goldSet.authoring).filter((entry) => entry.status === 'draft').length, 0);
  assert.deepEqual(sourceFixture.goldSet, sourceBefore);
  assert.deepEqual(targetFixture.goldSet, targetBefore);
});

test('V2-40 migration rejects source version, fingerprint and node eligibility drift', () => {
  const sourceFixture = createV2GoldSet({ confirmedCount: 1 });
  const targetFixture = createV2FortyGoldSet();
  assert.throws(() => gold.migrateConfirmedGoldV2Forty({
    sourceGoldSet: { ...sourceFixture.goldSet, goldVersion: 'gold-set-v1' },
    targetGoldSet: targetFixture.goldSet,
    snapshot: targetFixture.snapshot,
  }), /source Gold version/);

  const fingerprintDrift = structuredClone(targetFixture.goldSet);
  fingerprintDrift.frozen[0].contentFingerprint = 'drifted';
  assert.throws(() => gold.migrateConfirmedGoldV2Forty({
    sourceGoldSet: sourceFixture.goldSet,
    targetGoldSet: fingerprintDrift,
    snapshot: targetFixture.snapshot,
  }), /fingerprint/i);

  const inactiveSnapshot = structuredClone(targetFixture.snapshot);
  const confirmedId = Object.keys(sourceFixture.goldSet.authoring)
    .find((questionId) => sourceFixture.goldSet.authoring[questionId].status === 'confirmed');
  const confirmedSubject = sourceFixture.goldSet.frozen.find((entry) => entry.questionId === confirmedId).subject;
  inactiveSnapshot.nodes.find((node) => node.id === `${confirmedSubject}-atomic`).isActive = false;
  assert.throws(() => gold.migrateConfirmedGoldV2Forty({
    sourceGoldSet: sourceFixture.goldSet,
    targetGoldSet: targetFixture.goldSet,
    snapshot: inactiveSnapshot,
  }), /inactive/);
});

test('V2-40 authoring config uses isolated paths, hidden split and 40-question final version', () => {
  const v1 = goldAuthor.resolveGoldAuthoringConfig({});
  const v2 = goldAuthor.resolveGoldAuthoringConfig({ goldVersion: 'v2' });
  const forty = goldAuthor.resolveGoldAuthoringConfig({ goldVersion: 'v2-40' });
  assert.equal(forty.mode, 'v2-40');
  assert.equal(forty.total, 40);
  assert.equal(forty.hideSplit, true);
  assert.equal(forty.finalGoldVersion, 'gold-truth-v2r2-40');
  assert.match(forty.sample, /gold-sample-v2r2-40\.json$/);
  assert.match(forty.split, /gold-split-v2r2-40\.json$/);
  assert.match(forty.goldSet, /gold-set-v2r2-40\.json$/);
  assert.match(forty.manifestOut, /gold-truth-manifest-v2r2-40\.json$/);
  for (const key of ['sample', 'split', 'goldSet', 'manifestOut']) {
    assert.notEqual(forty[key], v1[key]);
    assert.notEqual(forty[key], v2[key]);
  }
});

test('V2-40 authoring preparation binds exact sample and split into a 40/32/8 frozen contract', () => {
  const sample = buildV2FortySampleFixture();
  const splitManifest = buildV2FortySplitManifest({
    sampleManifest: sample,
    split: splitV2FortyDevHoldout(sample),
  });
  const prepared = goldAuthor.prepareV2FortyAuthoringSample({ sample, splitManifest });
  assert.equal(prepared.entries.length, 40);
  assert.equal(prepared.entries.filter((entry) => entry.split === 'DEV').length, 32);
  assert.equal(prepared.entries.filter((entry) => entry.split === 'HOLDOUT').length, 8);
  assert.match(prepared.manifestSha256, /^[a-f0-9]{64}$/);

  const driftedSplit = { ...splitManifest, sampleSha256: '0'.repeat(64) };
  assert.throws(
    () => goldAuthor.prepareV2FortyAuthoringSample({ sample, splitManifest: driftedSplit }),
    /split invalid|sampleSha256|sha256/,
  );
});

test('V2-3: V1 gold contract unchanged (40/24/16)', () => {
  assert.equal(gold.GOLD_SET_VERSION, 'gold-set-v1');
  assert.equal(gold.GOLD_SAMPLE_MANIFEST_VERSION, 'gold-sample-v1');
  const fixture = buildV2Fixture();
  assert.throws(() => gold.createGoldSet({
    snapshotId: fixture.snapshot.snapshotId,
    frozen: fixture.frozen,
    frozenManifestSha256: fixture.frozenManifestSha256,
  }), /40/);
});

test('V2-3: createGoldSetV2 initializes 100 unstarted', () => {
  const { goldSet } = createV2GoldSet();
  assert.equal(gold.GOLD_SET_VERSION_V2, 'gold-set-v2');
  assert.deepEqual(gold.GOLD_CONTRACT_V2, {
    total: 100,
    dev: 72,
    holdout: 28,
    perSubject: 25,
    devPerSubject: 18,
    holdoutPerSubject: 7,
  });
  assert.equal(goldSet.goldVersion, 'gold-set-v2');
  assert.equal(goldSet.frozen.length, 100);
  assert.equal(Object.keys(goldSet.authoring).length, 100);
  assert.equal(Object.values(goldSet.authoring).filter((entry) => entry.status === 'unstarted').length, 100);
});

test('V2-3: freeze 100/100 confirmed succeeds', () => {
  assert.equal(typeof gold.freezeGoldManifestV2, 'function');
  const { snapshot, goldSet } = createV2GoldSet({ confirmedCount: 100 });
  const result = gold.freezeGoldManifestV2({ goldVersion: 'gold-truth-v2', goldSet, snapshot });
  assert.equal(result.ok, true, result.errors?.join('\n'));
  assert.equal(result.manifest.entries.length, 100);
  assert.equal(result.manifest.entries.filter((entry) => entry.split === 'DEV').length, 72);
  assert.equal(result.manifest.entries.filter((entry) => entry.split === 'HOLDOUT').length, 28);
  assert.equal(result.manifest.goldVersion, 'gold-truth-v2');
  assert.equal(result.manifest.snapshotId, snapshot.snapshotId);
  assert.match(result.manifest.sha256, /^[a-f0-9]{64}$/);
});

test('V2-3: freeze <100 confirmed fails', () => {
  const { snapshot, goldSet } = createV2GoldSet({ confirmedCount: 99 });
  const result = gold.freezeGoldManifestV2({ goldVersion: 'gold-truth-v2', goldSet, snapshot });
  assert.equal(result.ok, false);
  assert.equal(result.manifest, undefined);
  assert.match(result.errors.join('\n'), /confirmed|100/);
});

test('V2-3: fingerprint drift fails closed', () => {
  const { snapshot, goldSet } = createV2GoldSet({ confirmedCount: 100 });
  snapshot.questions[0].contentFingerprint = 'drifted';
  const result = gold.freezeGoldManifestV2({ goldVersion: 'gold-truth-v2', goldSet, snapshot });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /contentFingerprint|fingerprint/i);
});

test('V2-3: sample drift fails closed', () => {
  const { snapshot, goldSet } = createV2GoldSet({ confirmedCount: 100 });
  goldSet.frozen[0].questionId = 'DS-v2-replaced';
  const result = gold.freezeGoldManifestV2({ goldVersion: 'gold-truth-v2', goldSet, snapshot });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /frozen sample drifted|frozenManifestSha256/);
});

test('V2-3: snapshot drift fails closed', () => {
  const { snapshot, goldSet } = createV2GoldSet({ confirmedCount: 100 });
  goldSet.snapshotId = 'snap-other';
  const result = gold.freezeGoldManifestV2({ goldVersion: 'gold-truth-v2', goldSet, snapshot });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /snapshot/);
});

test('V2-3: split drift fails closed', () => {
  const { snapshot, goldSet } = createV2GoldSet({ confirmedCount: 100 });
  goldSet.frozen[0].split = 'HOLDOUT';
  const result = gold.freezeGoldManifestV2({ goldVersion: 'gold-truth-v2', goldSet, snapshot });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /frozen sample drifted|split|DEV total/);
});

test('V2-3: resume preserves progress', () => {
  assert.equal(typeof gold.loadGoldSetV2, 'function');
  const dir = mkdtempSync(join(tmpdir(), 'gold-v2-'));
  const path = join(dir, 'gold-set-v2.json');
  const { goldSet } = createV2GoldSet({ confirmedCount: 7 });
  goldSet.authoring['DS-v2-08'] = { status: 'draft', primaryNodeId: 'DS-atomic', secondaryNodeIds: [] };
  gold.saveGoldSet(path, goldSet);
  assert.deepEqual(gold.loadGoldSetV2(path), goldSet);
  assert.throws(() => gold.loadGoldSet(path), /version mismatch/);
});

test('V2-3: authoring view omits split labels', () => {
  assert.equal(typeof goldAuthor.formatAuthoringListLine, 'function');
  assert.equal(typeof goldAuthor.formatAuthoringQuestionHeader, 'function');
  const frozen = { questionId: 'DS-v2-01', subject: 'DS', split: 'HOLDOUT' };
  const authored = { status: 'unstarted' };
  const listLine = goldAuthor.formatAuthoringListLine(frozen, authored, { hideSplit: true });
  const header = goldAuthor.formatAuthoringQuestionHeader(
    { questionId: frozen.questionId, subject: frozen.subject },
    frozen,
    authored,
    { hideSplit: true },
  );
  assert.doesNotMatch(`${listLine}\n${header}`, /DEV|HOLDOUT|split/i);
  assert.match(listLine, /DS-v2-01/);
  assert.match(header, /unstarted/);
});

test('V2-3: V2 files do not collide with V1 files', () => {
  assert.equal(typeof goldAuthor.resolveGoldAuthoringConfig, 'function');
  const v1 = goldAuthor.resolveGoldAuthoringConfig({});
  const v2 = goldAuthor.resolveGoldAuthoringConfig({ goldVersion: 'v2' });
  assert.match(v1.sample, /gold-sample-v1\.json$/);
  assert.match(v1.goldSet, /gold-set-v1\.json$/);
  assert.match(v1.manifestOut, /gold-truth-manifest-v1\.json$/);
  assert.match(v2.sample, /gold-sample-v2r2\.json$/);
  assert.match(v2.split, /gold-split-v2\.json$/);
  assert.match(v2.goldSet, /gold-set-v2\.json$/);
  assert.match(v2.manifestOut, /gold-truth-manifest-v2\.json$/);
  assert.equal(v2.finalGoldVersion, 'gold-truth-v2');
  assert.notEqual(v2.sample, v1.sample);
  assert.notEqual(v2.goldSet, v1.goldSet);
  assert.notEqual(v2.manifestOut, v1.manifestOut);
});

test('V2-3: rejected V2/V2R samples are refused before authoring preparation', () => {
  assert.equal(typeof goldAuthor.prepareV2AuthoringSample, 'function');
  const { snapshot, frozen } = buildV2Fixture();
  const dev = frozen.filter((entry) => entry.split === 'DEV').map((entry) => entry.questionId);
  const holdout = frozen.filter((entry) => entry.split === 'HOLDOUT').map((entry) => entry.questionId);
  const splitManifest = buildV2SplitManifest({
    goldVersion: 'gold-sample-v2r2',
    snapshotId: snapshot.snapshotId,
    sampleSha256: 'be4485afd48a9107be3cfc63e896047911b642f95d013a649b7e17d8638109d4',
    split: { dev, holdout },
  });
  for (const rejected of [
    { goldVersion: 'gold-sample-v2', sha256: '439f3527666784bb6a5ebe73ab44871e732846f59a0482b4543036eb8492a2fc' },
    { goldVersion: 'gold-sample-v2r', sha256: '368c025c8438d7a7e73efcfb4df73d90b7479e92ef64d6ecf4a19971e9590854' },
  ]) {
    assert.throws(() => goldAuthor.prepareV2AuthoringSample({
      sample: { ...rejected, snapshotId: snapshot.snapshotId, entries: frozen },
      splitManifest,
    }), /REJECTED_PRE_SPLIT_SAMPLE/);
  }
  assert.throws(() => goldAuthor.prepareV2AuthoringSample({
    sample: {
      goldVersion: 'gold-sample-v2r2',
      snapshotId: snapshot.snapshotId,
      contentSha256: '0'.repeat(64),
      sha256: 'be4485afd48a9107be3cfc63e896047911b642f95d013a649b7e17d8638109d4',
      entries: frozen,
    },
    splitManifest,
  }), /sha256 mismatch/);
});

test('V2-3: sample entries and split build one fingerprint-protected frozen contract', () => {
  assert.equal(typeof goldAuthor.buildFrozenV2AuthoringContract, 'function');
  const { snapshot, frozen } = buildV2Fixture();
  const prepared = goldAuthor.buildFrozenV2AuthoringContract({
    snapshotId: snapshot.snapshotId,
    sampleEntries: frozen.map(({ split: _split, ...entry }) => entry),
    split: {
      dev: frozen.filter((entry) => entry.split === 'DEV').map((entry) => entry.questionId),
      holdout: frozen.filter((entry) => entry.split === 'HOLDOUT').map((entry) => entry.questionId),
    },
  });
  assert.equal(prepared.entries.length, 100);
  assert.equal(prepared.entries.filter((entry) => entry.split === 'DEV').length, 72);
  assert.equal(prepared.entries.filter((entry) => entry.split === 'HOLDOUT').length, 28);
  assert.match(prepared.manifestSha256, /^[a-f0-9]{64}$/);
});

test('V2-3: V2 wrappers delegate to the shared core', () => {
  assert.match(gold.createGoldSetV2.toString(), /createGoldSetWithRuntime/);
  assert.match(gold.loadGoldSetV2.toString(), /loadGoldSetWithRuntime/);
  assert.match(gold.freezeGoldManifestV2.toString(), /freezeGoldManifestWithRuntime/);
  assert.deepEqual(
    gold.freezeGoldManifestV2({ goldVersion: 'gold-truth-v2', goldSet: null, snapshot: {} }),
    gold.freezeGoldManifest({ goldVersion: 'gold-truth-v1', goldSet: null, snapshot: {} }),
  );
});
