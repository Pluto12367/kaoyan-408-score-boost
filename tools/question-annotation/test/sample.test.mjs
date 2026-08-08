import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotContentHash } from '../core/snapshot.js';
import {
  buildGoldManifest,
  sampleGoldQuestionIds,
  splitDevHoldout,
  validateGoldManifest,
} from '../core/sample.js';

const SUBJECTS = ['DS', 'CO', 'OS', 'CN'];
const DIFFICULTIES = ['BASIC', 'MEDIUM', 'HARD'];
const SOURCES = ['fixture-basic', 'fixture-variant', 'fixture-exam'];
const YEARS = [2024, 2025, 2026];

/**
 * Synthetic-only fixture. Every question is synthetic; no production question
 * text is used. Per subject: 12 INDEPENDENT_UNIT questions spread over 3
 * knowledge points (rotating difficulty/source/year), plus one exact
 * duplicate copy and one historical row. `insufficientSubject` reduces that
 * subject to 9 INDEPENDENT_UNIT questions (below the quota of 10).
 */
function buildFixtureSnapshot({ insufficientSubject = null } = {}) {
  const questions = [];
  const knowledgePoints = [];
  const questionKnowledgePoints = [];
  const roles = {};
  const duplicateRepresentative = {};

  for (const subject of SUBJECTS) {
    const kpCount = insufficientSubject === subject ? 1 : 3;
    const kpIds = [];
    for (let k = 1; k <= kpCount; k += 1) {
      const kpId = `${subject}-kp-${k}`;
      kpIds.push(kpId);
      knowledgePoints.push({ id: kpId, subject, chapter: `${subject}-chapter-${k}`, title: `${subject}-title-${k}` });
    }
    const eligibleCount = insufficientSubject === subject ? 9 : 12;
    for (let i = 1; i <= eligibleCount; i += 1) {
      const id = `${subject}-q-${String(i).padStart(2, '0')}`;
      const kpId = kpIds[(i - 1) % kpIds.length];
      questions.push({
        id,
        subject,
        stem: `synthetic stem ${id}`,
        options: ['A', 'B'],
        answer: 'A',
        analysis: `synthetic analysis ${id}`,
        difficulty: DIFFICULTIES[(i - 1) % DIFFICULTIES.length],
        type: 'SINGLE_CHOICE',
        source: SOURCES[(i - 1) % SOURCES.length],
        year: YEARS[(i - 1) % YEARS.length],
        expectedTimeSec: 100,
        contentFingerprint: `fp-${id}`,
        familyId: `f-${id}`,
        versionNumber: 1,
        isCurrent: true,
      });
      questionKnowledgePoints.push({ questionId: id, knowledgePointId: kpId });
      roles[id] = 'INDEPENDENT_UNIT';
      duplicateRepresentative[id] = null;
    }

    if (insufficientSubject !== subject) {
      const representativeId = `${subject}-q-01`;
      const copyId = `${subject}-q-copy`;
      questions.push({
        id: copyId,
        subject,
        stem: `synthetic stem ${copyId}`,
        options: ['A', 'B'],
        answer: 'A',
        analysis: `synthetic analysis ${copyId}`,
        difficulty: 'MEDIUM',
        type: 'SINGLE_CHOICE',
        source: 'fixture-basic',
        year: 2026,
        expectedTimeSec: 100,
        contentFingerprint: `fp-${representativeId}`,
        familyId: `f-${copyId}`,
        versionNumber: 1,
        isCurrent: true,
      });
      questionKnowledgePoints.push({ questionId: copyId, knowledgePointId: kpIds[0] });
      roles[copyId] = 'EXACT_DUPLICATE_COPY';
      duplicateRepresentative[copyId] = representativeId;

      const historicalId = `${subject}-q-historical`;
      questions.push({
        id: historicalId,
        subject,
        stem: `synthetic stem ${historicalId}`,
        options: ['A', 'B'],
        answer: 'A',
        analysis: `synthetic analysis ${historicalId}`,
        difficulty: 'HARD',
        type: 'SINGLE_CHOICE',
        source: 'fixture-variant',
        year: 2022,
        expectedTimeSec: 100,
        contentFingerprint: `fp-${historicalId}`,
        familyId: `f-${historicalId}`,
        versionNumber: 1,
        isCurrent: false,
      });
      questionKnowledgePoints.push({ questionId: historicalId, knowledgePointId: kpIds[0] });
      roles[historicalId] = 'HISTORICAL_ONLY';
      duplicateRepresentative[historicalId] = null;
    }
  }

  const snapshot = {
    snapshotId: 'snap-fixture',
    schemaVersion: 'annotation-snapshot-v1',
    generatedAt: '2026-08-08T00:00:00.000Z',
    sourceCommit: 'deadbeef',
    counts: {
      totalRows: questions.length,
      currentRows: questions.filter((question) => question.isCurrent).length,
      nonCurrentRows: questions.filter((question) => !question.isCurrent).length,
    },
    contentSha256: '',
    questions,
    knowledgePoints,
    questionKnowledgePoints,
    nodes: [],
    roles,
    duplicateRepresentative,
  };
  snapshot.contentSha256 = snapshotContentHash(snapshot);
  return snapshot;
}

/**
 * Variant of the synthetic fixture where a subject has eligible questions that
 * are NOT linked to any knowledge point of the same subject. The sampler must
 * still return exactly 10 per subject (fill the remaining quota deterministically)
 * and must never overfill a subject past its quota.
 */
function buildFixtureSnapshotWithUnlinkedQuestions({ subject = 'DS', unlinkedCount = 4 } = {}) {
  const snapshot = buildFixtureSnapshot();
  const unlinked = snapshot.questions
    .filter((question) => question.subject === subject && snapshot.roles[question.id] === 'INDEPENDENT_UNIT')
    .slice(-unlinkedCount)
    .map((question) => question.id);
  const unlinkedSet = new Set(unlinked);
  snapshot.questionKnowledgePoints = snapshot.questionKnowledgePoints.filter(
    (relation) => !(relation.questionId.startsWith(`${subject}-q-`) && unlinkedSet.has(relation.questionId)),
  );
  return { snapshot, unlinked };
}

function questionById(snapshot) {
  return new Map(snapshot.questions.map((question) => [question.id, question]));
}

function subjectCounts(ids, byId) {
  const counts = { DS: 0, CO: 0, OS: 0, CN: 0 };
  for (const id of ids) counts[byId.get(id).subject] += 1;
  return counts;
}

function buildEntries(ids, snapshot, { dev, holdout }) {
  const byId = questionById(snapshot);
  return ids.map((id) => ({
    questionId: id,
    contentFingerprint: byId.get(id).contentFingerprint,
    primaryNodeId: null,
    secondaryNodeIds: [],
    split: holdout.includes(id) ? 'HOLDOUT' : 'DEV',
  }));
}

function buildManifest(ids, snapshot) {
  const { dev, holdout } = splitDevHoldout(ids);
  const entries = buildEntries(ids, snapshot, { dev, holdout });
  return buildGoldManifest({ goldVersion: 'gold-sample-v1', snapshotId: snapshot.snapshotId, entries });
}

test('sampleGoldQuestionIds returns 40 deterministic ids, 10 per subject, only INDEPENDENT_UNIT', () => {
  const snapshot = buildFixtureSnapshot();
  const ids = sampleGoldQuestionIds(snapshot);
  assert.equal(ids.length, 40);
  const byId = questionById(snapshot);
  assert.deepEqual(subjectCounts(ids, byId), { DS: 10, CO: 10, OS: 10, CN: 10 });
  for (const id of ids) {
    assert.equal(snapshot.roles[id], 'INDEPENDENT_UNIT');
    assert.ok(byId.get(id).isCurrent);
  }
  assert.deepEqual(sampleGoldQuestionIds(snapshot), ids);
});

test('splitDevHoldout freezes 24/16 deterministically', () => {
  const snapshot = buildFixtureSnapshot();
  const ids = sampleGoldQuestionIds(snapshot);
  const { dev, holdout } = splitDevHoldout(ids);
  assert.equal(dev.length, 24);
  assert.equal(holdout.length, 16);
  assert.deepEqual(splitDevHoldout(ids), { dev, holdout });
});

test('A: only INDEPENDENT_UNIT questions are ever selected', () => {
  const snapshot = buildFixtureSnapshot();
  const selected = new Set(sampleGoldQuestionIds(snapshot));
  for (const question of snapshot.questions) {
    if (snapshot.roles[question.id] === 'INDEPENDENT_UNIT') continue;
    assert.equal(selected.has(question.id), false, `${question.id} (${snapshot.roles[question.id]}) must never be sampled`);
  }
});

test('B: subject quotas are exact and never borrow across subjects', () => {
  const snapshot = buildFixtureSnapshot();
  const ids = sampleGoldQuestionIds(snapshot);
  const byId = questionById(snapshot);
  assert.deepEqual(subjectCounts(ids, byId), { DS: 10, CO: 10, OS: 10, CN: 10 });
  assert.equal(new Set(ids).size, 40);
});

test('C: same logical input in different order yields same 40 ids, order and split', () => {
  const snapshot = buildFixtureSnapshot();
  const ids = sampleGoldQuestionIds(snapshot);
  const shuffled = {
    ...snapshot,
    questions: [...snapshot.questions].reverse(),
    questionKnowledgePoints: [...snapshot.questionKnowledgePoints].reverse(),
  };
  const idsShuffled = sampleGoldQuestionIds(shuffled);
  assert.deepEqual(idsShuffled, ids);
  assert.deepEqual(splitDevHoldout(idsShuffled), splitDevHoldout(ids));
});

test('D: every referenced knowledge point is covered by the gold sample', () => {
  const snapshot = buildFixtureSnapshot();
  const selected = new Set(sampleGoldQuestionIds(snapshot));
  const eligible = new Set(
    snapshot.questions.filter((question) => snapshot.roles[question.id] === 'INDEPENDENT_UNIT').map((question) => question.id),
  );
  const referenced = new Set();
  for (const relation of snapshot.questionKnowledgePoints) {
    if (eligible.has(relation.questionId)) referenced.add(relation.knowledgePointId);
  }
  const covered = new Set();
  for (const relation of snapshot.questionKnowledgePoints) {
    if (selected.has(relation.questionId)) covered.add(relation.knowledgePointId);
  }
  assert.equal(referenced.size, 12, 'fixture should reference 3 KPs per subject');
  for (const kpId of referenced) {
    assert.ok(covered.has(kpId), `referenced KP ${kpId} is not covered by the gold sample`);
  }
  assert.equal(covered.size, referenced.size);
});

test('E: exact duplicate copies never enter gold even when the representative is selected', () => {
  const snapshot = buildFixtureSnapshot();
  const selected = new Set(sampleGoldQuestionIds(snapshot));
  for (const question of snapshot.questions) {
    if (snapshot.roles[question.id] === 'EXACT_DUPLICATE_COPY') {
      assert.equal(selected.has(question.id), false, `${question.id} is an exact duplicate copy and must not be sampled`);
    }
  }
  // representative DS-q-01 is eligible; confirm at most one member per fingerprint group is sampled
  const fingerprintGroups = new Map();
  for (const question of snapshot.questions) {
    if (!question.isCurrent || question.contentFingerprint == null) continue;
    const ids = fingerprintGroups.get(question.contentFingerprint) ?? [];
    ids.push(question.id);
    fingerprintGroups.set(question.contentFingerprint, ids);
  }
  for (const ids of fingerprintGroups.values()) {
    const sampled = ids.filter((id) => selected.has(id));
    assert.ok(sampled.length <= 1, `fingerprint group ${ids.join(',')} sampled ${sampled.length} members`);
  }
});

test('F: dev/holdout split is exactly 24/16 with 6/4 per subject', () => {
  const snapshot = buildFixtureSnapshot();
  const ids = sampleGoldQuestionIds(snapshot);
  const { dev, holdout } = splitDevHoldout(ids);
  assert.equal(dev.length, 24);
  assert.equal(holdout.length, 16);
  const byId = questionById(snapshot);
  assert.deepEqual(subjectCounts(dev, byId), { DS: 6, CO: 6, OS: 6, CN: 6 });
  assert.deepEqual(subjectCounts(holdout, byId), { DS: 4, CO: 4, OS: 4, CN: 4 });
  assert.equal(new Set([...dev, ...holdout]).size, 40);
  assert.equal(new Set(dev).size, 24);
  assert.equal(new Set(holdout).size, 16);
  const overlap = dev.filter((id) => holdout.includes(id));
  assert.deepEqual(overlap, []);
});

test('G: gold manifest binds to the snapshot identity and validates', () => {
  const snapshot = buildFixtureSnapshot();
  const ids = sampleGoldQuestionIds(snapshot);
  const manifest = buildManifest(ids, snapshot);
  assert.equal(manifest.goldVersion, 'gold-sample-v1');
  assert.equal(manifest.snapshotId, snapshot.snapshotId);
  assert.match(manifest.sha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.entries.length, 40);
  const result = validateGoldManifest(manifest, snapshot);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.errors, []);
});

test('H: stale or tampered manifest is rejected fail-closed', () => {
  const snapshot = buildFixtureSnapshot();
  const ids = sampleGoldQuestionIds(snapshot);
  const manifest = buildManifest(ids, snapshot);

  const wrongSnapshot = { ...manifest, snapshotId: 'snap-other' };
  assert.equal(validateGoldManifest(wrongSnapshot, snapshot).ok, false, 'snapshotId change must invalidate');

  const changedFingerprint = {
    ...manifest,
    entries: manifest.entries.map((entry) => (entry.questionId === ids[0] ? { ...entry, contentFingerprint: 'changed-fp' } : entry)),
  };
  assert.equal(validateGoldManifest(changedFingerprint, snapshot).ok, false, 'fingerprint change must invalidate');

  const missingSplit = {
    ...manifest,
    entries: manifest.entries.map(({ split, ...rest }) => rest),
  };
  assert.equal(validateGoldManifest(missingSplit, snapshot).ok, false, 'missing explicit split must invalidate');

  const firstHoldoutIndex = manifest.entries.findIndex((entry) => entry.split === 'HOLDOUT');
  const wrongSplit = {
    ...manifest,
    entries: manifest.entries.map((entry, index) => (index === firstHoldoutIndex ? { ...entry, split: 'DEV' } : entry)),
  };
  assert.equal(validateGoldManifest(wrongSplit, snapshot).ok, false, 'split drift must invalidate');

  const tamperedHash = { ...manifest, sha256: '0'.repeat(64) };
  assert.equal(validateGoldManifest(tamperedHash, snapshot).ok, false, 'hash tamper must invalidate');
});

test('I: a subject with fewer than 10 INDEPENDENT_UNIT questions fails closed', () => {
  const snapshot = buildFixtureSnapshot({ insufficientSubject: 'DS' });
  assert.throws(() => sampleGoldQuestionIds(snapshot), /DS/);
});

test('I2: unlinked eligible questions never overfill a subject past its quota', () => {
  const { snapshot } = buildFixtureSnapshotWithUnlinkedQuestions({ subject: 'DS', unlinkedCount: 4 });
  const ids = sampleGoldQuestionIds(snapshot);
  const byId = questionById(snapshot);
  assert.deepEqual(subjectCounts(ids, byId), { DS: 10, CO: 10, OS: 10, CN: 10 });
  assert.equal(new Set(ids).size, 40);
});

test('I3: unlinked eligible questions are filled deterministically by questionId', () => {
  const { snapshot, unlinked } = buildFixtureSnapshotWithUnlinkedQuestions({ subject: 'DS', unlinkedCount: 4 });
  const first = sampleGoldQuestionIds(snapshot);
  const reversed = {
    ...snapshot,
    questions: [...snapshot.questions].reverse(),
    questionKnowledgePoints: [...snapshot.questionKnowledgePoints].reverse(),
  };
  const second = sampleGoldQuestionIds(reversed);
  assert.deepEqual(second, first);
  // The unlinked questions may fill the tail of the DS block (after KP-linked
  // candidates are exhausted); at least the sampler must not exceed 10 per subject.
  const dsSelected = first.filter((id) => id.startsWith('DS-'));
  assert.equal(dsSelected.length, 10);
  assert.ok(unlinked.length > 0);
});

test('J: sampler and manifest builder never mutate their inputs', () => {
  const snapshot = buildFixtureSnapshot();
  const beforeSnapshot = JSON.stringify(snapshot);
  const ids = sampleGoldQuestionIds(snapshot);
  const { dev, holdout } = splitDevHoldout(ids);
  const input = {
    goldVersion: 'gold-sample-v1',
    snapshotId: snapshot.snapshotId,
    entries: buildEntries(ids, snapshot, { dev, holdout }),
  };
  const beforeInput = JSON.stringify(input);
  buildGoldManifest(input);
  assert.equal(JSON.stringify(snapshot), beforeSnapshot);
  assert.equal(JSON.stringify(input), beforeInput);
});

test('gold sample keeps difficulty/source/year diversity when the data allows it', () => {
  const snapshot = buildFixtureSnapshot();
  const ids = sampleGoldQuestionIds(snapshot);
  const byId = questionById(snapshot);
  const selected = ids.map((id) => byId.get(id));
  assert.ok(new Set(selected.map((question) => question.difficulty)).size >= 2, 'difficulty diversity');
  assert.ok(new Set(selected.map((question) => question.source)).size >= 2, 'source diversity');
  assert.ok(new Set(selected.map((question) => question.year)).size >= 2, 'year diversity');
});

test('gold manifest never contains question body fields', () => {
  const snapshot = buildFixtureSnapshot();
  const ids = sampleGoldQuestionIds(snapshot);
  const manifest = buildManifest(ids, snapshot);
  const json = JSON.stringify(manifest);
  assert.ok(!json.includes('"stem"'), 'manifest must not contain stem');
  assert.ok(!json.includes('"options"'), 'manifest must not contain options');
  assert.ok(!json.includes('"answer"'), 'manifest must not contain answer');
  assert.ok(!json.includes('"analysis"'), 'manifest must not contain analysis');
});

test('manifest sha256 is canonical: same input always yields the same hash', () => {
  const snapshot = buildFixtureSnapshot();
  const ids = sampleGoldQuestionIds(snapshot);
  const first = buildManifest(ids, snapshot);
  const second = buildManifest(sampleGoldQuestionIds(snapshot), snapshot);
  assert.deepEqual(second, first);
  assert.equal(second.sha256, first.sha256);
});
