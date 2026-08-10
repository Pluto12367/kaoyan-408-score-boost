import test from 'node:test';
import assert from 'node:assert/strict';
import { buildV2R2SampleManifest, buildV2SampleManifest } from '../core/sampleV2.js';
import {
  V2_FORTY_GOLD_SAMPLE_VERSION,
  buildV2FortySampleManifest,
  buildV2FortySplitManifest,
  compareV2FortyMatrixScores,
  scoreV2FortyMatrix,
  selectV2FortyEntries,
  splitV2FortyDevHoldout,
  validateV2FortySampleManifest,
  validateV2FortySplitManifest,
} from '../core/sampleV2Forty.js';

const SUBJECT_KPS = {
  DS: ['ds-a', 'ds-b', 'ds-c', 'ds-d'],
  CO: ['co-a', 'co-b', 'co-c', 'co-d'],
  OS: ['os-a', 'os-b', 'os-c', 'os-d'],
  CN: ['net-a', 'net-b', 'net-c', 'net-d'],
};

const PARENT_MATRIX = [
  { BASIC: 3, MEDIUM: 3, HARD: 1 },
  { BASIC: 2, MEDIUM: 3, HARD: 1 },
  { BASIC: 2, MEDIUM: 2, HARD: 2 },
  { BASIC: 3, MEDIUM: 2, HARD: 1 },
];

function makeEntry(subject, kpId, difficulty, serial) {
  const questionId = `${subject.toLowerCase()}-${kpId}-${difficulty.toLowerCase()}-${String(serial).padStart(2, '0')}`;
  return {
    questionId,
    contentFingerprint: `fp-${questionId}`,
    subject,
    difficulty,
    source: 'synthetic',
    year: 2026,
    knowledgePointIds: [kpId],
  };
}

function buildParentManifest() {
  const entries = [];
  for (const [subject, kpIds] of Object.entries(SUBJECT_KPS)) {
    kpIds.forEach((kpId, kpIndex) => {
      for (const difficulty of ['BASIC', 'MEDIUM', 'HARD']) {
        for (let index = 1; index <= PARENT_MATRIX[kpIndex][difficulty]; index += 1) {
          entries.push(makeEntry(subject, kpId, difficulty, index));
        }
      }
    });
  }
  return buildV2R2SampleManifest({
    snapshotId: 'snap-v2-40-fixture',
    contentSha256: '1'.repeat(64),
    entries,
  });
}

function buildFortyManifest() {
  const parent = buildParentManifest();
  const entries = selectV2FortyEntries(parent);
  return buildV2SampleManifest({
    snapshotId: parent.snapshotId,
    contentSha256: parent.contentSha256,
    goldVersion: 'gold-sample-v2r2-40',
    entries,
  });
}

function countsFor(entries, subject) {
  const selected = entries.filter((entry) => entry.subject === subject);
  const difficulty = { BASIC: 0, MEDIUM: 0, HARD: 0 };
  const kp = {};
  for (const entry of selected) {
    difficulty[entry.difficulty] += 1;
    const kpId = entry.knowledgePointIds[0];
    kp[kpId] = (kp[kpId] ?? 0) + 1;
  }
  return { total: selected.length, difficulty, kp: Object.values(kp).sort((a, b) => a - b) };
}

test('V2-40 reduction selects exact 40 with 10/subject, 3/3/2/2 KP and 4/4/2 difficulty', () => {
  const selected = selectV2FortyEntries(buildParentManifest());
  assert.equal(selected.length, 40);
  for (const subject of Object.keys(SUBJECT_KPS)) {
    assert.deepEqual(countsFor(selected, subject), {
      total: 10,
      difficulty: { BASIC: 4, MEDIUM: 4, HARD: 2 },
      kp: [2, 2, 3, 3],
    });
  }
});

test('V2-40 matrix objectives produce 1/1/0/0 HARD and choose third slots by parent availability then KP id', () => {
  const selected = selectV2FortyEntries(buildParentManifest());
  for (const [subject, kpIds] of Object.entries(SUBJECT_KPS)) {
    const byKp = Object.fromEntries(kpIds.map((kpId) => [kpId, { total: 0, hard: 0 }]));
    for (const entry of selected.filter((candidate) => candidate.subject === subject)) {
      const kpId = entry.knowledgePointIds[0];
      byKp[kpId].total += 1;
      if (entry.difficulty === 'HARD') byKp[kpId].hard += 1;
    }
    assert.deepEqual(kpIds.map((kpId) => byKp[kpId].total), [3, 3, 2, 2]);
    assert.deepEqual(kpIds.map((kpId) => byKp[kpId].hard), [1, 1, 0, 0]);
  }
});

test('V2-40 matrix comparator applies deviation, third-slot owners, then canonical matrix in order', () => {
  const eligible = new Map([['aa', 7], ['bb', 6], ['cc', 5], ['dd', 5]]);
  const balanced = {
    aa: { BASIC: 1, MEDIUM: 1, HARD: 1 },
    bb: { BASIC: 1, MEDIUM: 1, HARD: 1 },
    cc: { BASIC: 1, MEDIUM: 1, HARD: 0 },
    dd: { BASIC: 1, MEDIUM: 1, HARD: 0 },
  };
  const skewed = {
    aa: { BASIC: 0, MEDIUM: 2, HARD: 1 },
    bb: { BASIC: 2, MEDIUM: 0, HARD: 1 },
    cc: { BASIC: 1, MEDIUM: 1, HARD: 0 },
    dd: { BASIC: 1, MEDIUM: 1, HARD: 0 },
  };
  const balancedScore = scoreV2FortyMatrix(balanced, eligible);
  const skewedScore = scoreV2FortyMatrix(skewed, eligible);
  assert.equal(balancedScore.maxHard, skewedScore.maxHard);
  assert.equal(balancedScore.hardRange, skewedScore.hardRange);
  assert.equal(balancedScore.difficultyDeviationCost, 24);
  assert.equal(skewedScore.difficultyDeviationCost, 124);
  assert.equal(compareV2FortyMatrixScores(balancedScore, skewedScore) < 0, true);

  const lowerOwnerAvailability = {
    aa: balanced.aa,
    bb: { BASIC: 1, MEDIUM: 1, HARD: 0 },
    cc: balanced.bb,
    dd: balanced.dd,
  };
  assert.equal(
    compareV2FortyMatrixScores(balancedScore, scoreV2FortyMatrix(lowerOwnerAvailability, eligible)) < 0,
    true,
  );

  const canonicalLeft = {
    aa: balanced.aa,
    bb: balanced.bb,
    cc: { BASIC: 0, MEDIUM: 2, HARD: 0 },
    dd: { BASIC: 2, MEDIUM: 0, HARD: 0 },
  };
  const canonicalRight = {
    aa: balanced.aa,
    bb: balanced.bb,
    cc: { BASIC: 2, MEDIUM: 0, HARD: 0 },
    dd: { BASIC: 0, MEDIUM: 2, HARD: 0 },
  };
  const leftScore = scoreV2FortyMatrix(canonicalLeft, eligible);
  const rightScore = scoreV2FortyMatrix(canonicalRight, eligible);
  assert.equal(leftScore.difficultyDeviationCost, rightScore.difficultyDeviationCost);
  assert.deepEqual(leftScore.thirdSlotOwners, rightScore.thirdSlotOwners);
  assert.equal(compareV2FortyMatrixScores(leftScore, rightScore) < 0, true);
});

test('V2-40 reduction is input-order and future-metadata independent', () => {
  const parent = buildParentManifest();
  const baseline = selectV2FortyEntries(parent);
  const decorated = {
    ...parent,
    entries: [...parent.entries].reverse().map((entry, index) => ({
      ...entry,
      split: index % 2 ? 'DEV' : 'HOLDOUT',
      authoring: { status: index % 3 ? 'confirmed' : 'unstarted' },
      primaryNodeId: `forbidden-${index}`,
      stem: `forbidden-${index}`,
      retrievalRank: index,
    })),
  };
  assert.deepEqual(selectV2FortyEntries(decorated), baseline);
});

test('V2-40 reduction rejects non-V2R2 parent and impossible hard availability', () => {
  const parent = buildParentManifest();
  assert.throws(() => selectV2FortyEntries({ ...parent, goldVersion: 'gold-sample-v2r' }), /gold-sample-v2r2/);
  const impossibleEntries = parent.entries.map((entry) => (
    entry.difficulty === 'HARD' ? { ...entry, difficulty: 'MEDIUM' } : entry
  ));
  const impossibleParent = buildV2R2SampleManifest({
    snapshotId: parent.snapshotId,
    contentSha256: parent.contentSha256,
    entries: impossibleEntries,
  });
  assert.throws(() => selectV2FortyEntries(impossibleParent), /V2-40 SAMPLING BLOCKED/);
});

test('V2-40 manifest locks parent identity, canonical SHA and forbids content/Gold/split fields', () => {
  const parent = buildParentManifest();
  const manifest = buildV2FortySampleManifest(parent, { acceptedParentSha256: parent.sha256 });
  assert.equal(manifest.goldVersion, V2_FORTY_GOLD_SAMPLE_VERSION);
  assert.equal(manifest.entries.length, 40);
  assert.equal(validateV2FortySampleManifest(manifest, parent, { acceptedParentSha256: parent.sha256 }).ok, true);

  const drifted = {
    ...manifest,
    entries: manifest.entries.map((entry, index) => index === 0 ? { ...entry, split: 'DEV' } : entry),
  };
  const result = validateV2FortySampleManifest(drifted, parent, { acceptedParentSha256: parent.sha256 });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /forbidden split|sha256/);
  assert.throws(
    () => buildV2FortySampleManifest(parent, { acceptedParentSha256: 'f'.repeat(64) }),
    /accepted parent SHA/,
  );
});

test('V2-40 split is exact, stratified, deterministic and input-order independent', () => {
  const sample = buildFortyManifest();
  const split = splitV2FortyDevHoldout(sample);
  assert.equal(split.dev.length, 32);
  assert.equal(split.holdout.length, 8);
  assert.equal(new Set([...split.dev, ...split.holdout]).size, 40);
  assert.equal(split.dev.some((id) => split.holdout.includes(id)), false);

  const byId = new Map(sample.entries.map((entry) => [entry.questionId, entry]));
  const holdoutEntries = split.holdout.map((id) => byId.get(id));
  assert.deepEqual(
    Object.fromEntries(['BASIC', 'MEDIUM', 'HARD'].map((difficulty) => [
      difficulty,
      holdoutEntries.filter((entry) => entry.difficulty === difficulty).length,
    ])),
    { BASIC: 3, MEDIUM: 3, HARD: 2 },
  );
  for (const subject of Object.keys(SUBJECT_KPS)) {
    const subjectHoldout = holdoutEntries.filter((entry) => entry.subject === subject);
    const subjectDev = split.dev.map((id) => byId.get(id)).filter((entry) => entry.subject === subject);
    assert.equal(subjectHoldout.length, 2);
    assert.equal(new Set(subjectHoldout.map((entry) => entry.difficulty)).size, 2);
    assert.equal(new Set(subjectHoldout.map((entry) => entry.knowledgePointIds[0])).size, 2);
    assert.equal(new Set(subjectDev.map((entry) => entry.knowledgePointIds[0])).size, 4);
  }

  const reordered = { ...sample, entries: [...sample.entries].reverse() };
  assert.deepEqual(splitV2FortyDevHoldout(reordered), split);
});

test('V2-40 split manifest is canonical and fails closed on identity or constraint drift', () => {
  const sample = buildFortyManifest();
  const split = splitV2FortyDevHoldout(sample);
  const manifest = buildV2FortySplitManifest({ sampleManifest: sample, split });
  assert.equal(validateV2FortySplitManifest(manifest, sample).ok, true);

  const reordered = buildV2FortySplitManifest({
    sampleManifest: sample,
    split: { dev: [...split.dev].reverse(), holdout: [...split.holdout].reverse() },
  });
  assert.equal(reordered.sha256, manifest.sha256);
  const drifted = { ...manifest, sampleSha256: '0'.repeat(64) };
  const result = validateV2FortySplitManifest(drifted, sample);
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /sampleSha256|sha256/);
});
