import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJsonHash } from '../core/canonical.js';
import {
  V2_GOLD_SAMPLE_VERSION,
  buildV2EligiblePool,
  buildV2SampleManifest,
  computeRequiredV2KpSet,
  sampleV2QuestionIds,
  validateV2SampleManifest,
} from '../core/sampleV2.js';

const SUBJECTS = ['DS', 'CO', 'OS', 'CN'];
const DIFFICULTIES = ['BASIC', 'MEDIUM', 'HARD'];

function kpId(subject, index) {
  return `${subject}-kp-${index}`;
}

/**
 * Synthetic fixture. Per subject: 4 required KPs and 30 eligible current
 * INDEPENDENT_UNIT questions (12 BASIC / 12 MEDIUM / 6 HARD) spread over
 * chapters/sources/years. Plus old-Gold rows, an exact duplicate, a historical
 * row, a version-family row, and two orphan KPs with zero relations.
 */
function buildFixture({ osHardAvailable = 6, kpShortageSubject = null } = {}) {
  const questions = [];
  const knowledgePoints = [];
  const questionKnowledgePoints = [];
  const roles = {};
  const duplicateRepresentative = {};

  for (const subject of SUBJECTS) {
    for (let k = 1; k <= 4; k += 1) {
      knowledgePoints.push({ id: kpId(subject, k), subject, chapter: `${subject}-chapter-${k}`, title: `${subject}-title-${k}` });
    }
    const total = subject === 'OS' && osHardAvailable !== 6 ? 30 - (6 - osHardAvailable) : 30;
    let index = 0;
    for (let difficultyIndex = 0; difficultyIndex < DIFFICULTIES.length; difficultyIndex += 1) {
      const difficulty = DIFFICULTIES[difficultyIndex];
      const count = difficulty === 'HARD' && subject === 'OS' ? osHardAvailable : difficulty === 'HARD' ? 6 : 12;
      for (let i = 0; i < count; i += 1) {
        index += 1;
        const id = `${subject}-q-${String(index).padStart(2, '0')}`;
        questions.push({
          id,
          subject,
          stem: `synthetic stem ${id}`,
          options: ['A', 'B'],
          answer: 'A',
          analysis: `synthetic analysis ${id}`,
          difficulty,
          type: 'SINGLE_CHOICE',
          source: ['src-a', 'src-b', 'src-c'][(index - 1) % 3],
          year: [2024, 2025, 2026][(index - 1) % 3],
          expectedTimeSec: 100,
          contentFingerprint: `fp-${id}`,
          familyId: `f-${id}`,
          versionNumber: 1,
          isCurrent: true,
          chapterName: `${subject}-chapter-${((index - 1) % 4) + 1}`,
          sectionName: `${subject}-section-${((index - 1) % 2) + 1}`,
        });
        questionKnowledgePoints.push({ questionId: id, knowledgePointId: kpId(subject, ((index - 1) % 4) + 1) });
        roles[id] = 'INDEPENDENT_UNIT';
        duplicateRepresentative[id] = null;
      }
    }

    // old Gold row for this subject (eligible but excluded by lineage)
    const oldId = `${subject}-old-gold`;
    questions.push({
      id: oldId,
      subject,
      stem: `synthetic stem ${oldId}`,
      options: ['A', 'B'],
      answer: 'A',
      analysis: `synthetic analysis ${oldId}`,
      difficulty: 'BASIC',
      type: 'SINGLE_CHOICE',
      source: 'src-a',
      year: 2026,
      expectedTimeSec: 100,
      contentFingerprint: `fp-${oldId}`,
      familyId: `f-${oldId}`,
      versionNumber: 1,
      isCurrent: true,
      chapterName: `${subject}-chapter-1`,
      sectionName: `${subject}-section-1`,
    });
    questionKnowledgePoints.push({ questionId: oldId, knowledgePointId: kpId(subject, 1) });
    roles[oldId] = 'INDEPENDENT_UNIT';
    duplicateRepresentative[oldId] = null;

    // exact duplicate copy (same fingerprint as an eligible question, role copy)
    const copyId = `${subject}-copy`;
    questions.push({
      id: copyId,
      subject,
      stem: `synthetic stem ${copyId}`,
      options: ['A', 'B'],
      answer: 'A',
      analysis: `synthetic analysis ${copyId}`,
      difficulty: 'MEDIUM',
      type: 'SINGLE_CHOICE',
      source: 'src-b',
      year: 2026,
      expectedTimeSec: 100,
      contentFingerprint: `fp-${subject}-q-01`,
      familyId: `f-${copyId}`,
      versionNumber: 1,
      isCurrent: true,
      chapterName: `${subject}-chapter-1`,
      sectionName: `${subject}-section-1`,
    });
    questionKnowledgePoints.push({ questionId: copyId, knowledgePointId: kpId(subject, 1) });
    roles[copyId] = 'EXACT_DUPLICATE_COPY';
    duplicateRepresentative[copyId] = `${subject}-q-01`;

    // historical non-current row
    const historicalId = `${subject}-historical`;
    questions.push({
      id: historicalId,
      subject,
      stem: `synthetic stem ${historicalId}`,
      options: ['A', 'B'],
      answer: 'A',
      analysis: `synthetic analysis ${historicalId}`,
      difficulty: 'HARD',
      type: 'SINGLE_CHOICE',
      source: 'src-c',
      year: 2022,
      expectedTimeSec: 100,
      contentFingerprint: `fp-${historicalId}`,
      familyId: `f-${historicalId}`,
      versionNumber: 1,
      isCurrent: false,
      chapterName: `${subject}-chapter-1`,
      sectionName: `${subject}-section-1`,
    });
    questionKnowledgePoints.push({ questionId: historicalId, knowledgePointId: kpId(subject, 1) });
    roles[historicalId] = 'HISTORICAL_ONLY';
    duplicateRepresentative[historicalId] = null;

    // version-family row: same family as the old gold row but different fingerprint
    const versionId = `${subject}-version`;
    questions.push({
      id: versionId,
      subject,
      stem: `synthetic stem ${versionId}`,
      options: ['A', 'B'],
      answer: 'A',
      analysis: `synthetic analysis ${versionId}`,
      difficulty: 'MEDIUM',
      type: 'SINGLE_CHOICE',
      source: 'src-a',
      year: 2026,
      expectedTimeSec: 100,
      contentFingerprint: `fp-${versionId}`,
      familyId: `f-${oldId}`,
      versionNumber: 2,
      isCurrent: true,
      chapterName: `${subject}-chapter-1`,
      sectionName: `${subject}-section-1`,
    });
    questionKnowledgePoints.push({ questionId: versionId, knowledgePointId: kpId(subject, 1) });
    roles[versionId] = 'INDEPENDENT_UNIT';
    duplicateRepresentative[versionId] = null;
  }

  // two orphan KPs with zero relations
  knowledgePoints.push({ id: 'os-kp-orphan-1', subject: 'OS', chapter: 'OS-chapter-9', title: 'orphan 1' });
  knowledgePoints.push({ id: 'os-kp-orphan-2', subject: 'OS', chapter: 'OS-chapter-9', title: 'orphan 2' });

  const snapshot = {
    snapshotId: 'snap-v2-fixture',
    contentSha256: 'fixture-content-sha',
    questions,
    knowledgePoints,
    questionKnowledgePoints,
    nodes: [],
    roles,
    duplicateRepresentative,
  };
  const oldGold = {
    ids: new Set(SUBJECTS.map((subject) => `${subject}-old-gold`)),
    fingerprints: new Set(SUBJECTS.map((subject) => `fp-${subject}-old-gold`)),
    families: new Set(SUBJECTS.map((subject) => `f-${subject}-old-gold`)),
  };
  return { snapshot, oldGold };
}

function sampleEntries(snapshot, ids) {
  const byId = new Map(snapshot.questions.map((question) => [question.id, question]));
  const kpsByQuestion = new Map();
  for (const relation of snapshot.questionKnowledgePoints) {
    const list = kpsByQuestion.get(relation.questionId) ?? new Set();
    list.add(relation.knowledgePointId);
    kpsByQuestion.set(relation.questionId, list);
  }
  return ids.map((id) => {
    const question = byId.get(id);
    return {
      questionId: id,
      contentFingerprint: question.contentFingerprint,
      subject: question.subject,
      difficulty: question.difficulty,
      source: question.source,
      year: question.year,
      knowledgePointIds: [...(kpsByQuestion.get(id) ?? [])].sort(),
    };
  });
}

test('V2-1: required KP set is the canonical 16 and ignores orphan rows', () => {
  const { snapshot } = buildFixture();
  const required = computeRequiredV2KpSet(snapshot);
  assert.equal(required.size, 16);
  for (const subject of SUBJECTS) {
    for (let k = 1; k <= 4; k += 1) assert.ok(required.has(kpId(subject, k)));
  }
  assert.ok(!required.has('os-kp-orphan-1'));
  assert.ok(!required.has('os-kp-orphan-2'));
});

test('TEST A — old V1 gold ids are excluded', () => {
  const { snapshot, oldGold } = buildFixture();
  const ids = sampleV2QuestionIds(snapshot, oldGold);
  assert.equal(ids.filter((id) => oldGold.ids.has(id)).length, 0);
});

test('TEST B — exact fingerprint overlap is excluded even with different ids', () => {
  const { snapshot, oldGold } = buildFixture();
  const ids = sampleV2QuestionIds(snapshot, oldGold);
  const byId = new Map(snapshot.questions.map((question) => [question.id, question]));
  const selectedFps = new Set(ids.map((id) => byId.get(id).contentFingerprint));
  assert.equal([...selectedFps].filter((fp) => oldGold.fingerprints.has(fp)).length, 0);
  // the version-family row (different fingerprint, same family) is also absent
  for (const subject of SUBJECTS) {
    assert.ok(!ids.includes(`${subject}-version`), `${subject}-version must be excluded by family lineage`);
  }
});

test('TEST C — version-family overlap is excluded (familyId lineage, not concept family)', () => {
  const { snapshot, oldGold } = buildFixture();
  const ids = sampleV2QuestionIds(snapshot, oldGold);
  const byId = new Map(snapshot.questions.map((question) => [question.id, question]));
  for (const id of ids) {
    assert.ok(!oldGold.families.has(byId.get(id).familyId), `${id} shares a V1 family lineage`);
  }
});

test('TEST D — exact duplicate copy, historical and non-current are never selected', () => {
  const { snapshot, oldGold } = buildFixture();
  const ids = sampleV2QuestionIds(snapshot, oldGold);
  const byId = new Map(snapshot.questions.map((question) => [question.id, question]));
  for (const id of ids) {
    const question = byId.get(id);
    assert.equal(question.isCurrent, true);
    assert.equal(snapshot.roles[id], 'INDEPENDENT_UNIT');
  }
  for (const subject of SUBJECTS) {
    assert.ok(!ids.includes(`${subject}-copy`));
    assert.ok(!ids.includes(`${subject}-historical`));
  }
});

test('TEST E — exact subject quota 25 per subject', () => {
  const { snapshot, oldGold } = buildFixture();
  const ids = sampleV2QuestionIds(snapshot, oldGold);
  const byId = new Map(snapshot.questions.map((question) => [question.id, question]));
  const counts = { DS: 0, CO: 0, OS: 0, CN: 0 };
  for (const id of ids) counts[byId.get(id).subject] += 1;
  assert.deepEqual(counts, { DS: 25, CO: 25, OS: 25, CN: 25 });
  assert.equal(new Set(ids).size, 100);
});

test('TEST F — exact difficulty quota 10/10/5 per subject and 40/40/20 global', () => {
  const { snapshot, oldGold } = buildFixture();
  const ids = sampleV2QuestionIds(snapshot, oldGold);
  const byId = new Map(snapshot.questions.map((question) => [question.id, question]));
  const perSubject = {};
  const global = { BASIC: 0, MEDIUM: 0, HARD: 0 };
  for (const id of ids) {
    const question = byId.get(id);
    perSubject[question.subject] ??= { BASIC: 0, MEDIUM: 0, HARD: 0 };
    perSubject[question.subject][question.difficulty] += 1;
    global[question.difficulty] += 1;
  }
  for (const subject of SUBJECTS) {
    assert.deepEqual(perSubject[subject], { BASIC: 10, MEDIUM: 10, HARD: 5 }, subject);
  }
  assert.deepEqual(global, { BASIC: 40, MEDIUM: 40, HARD: 20 });
});

test('TEST G — all 16 required KPs are covered by the sample', () => {
  const { snapshot, oldGold } = buildFixture();
  const ids = sampleV2QuestionIds(snapshot, oldGold);
  const kpsByQuestion = new Map();
  for (const relation of snapshot.questionKnowledgePoints) {
    const list = kpsByQuestion.get(relation.questionId) ?? new Set();
    list.add(relation.knowledgePointId);
    kpsByQuestion.set(relation.questionId, list);
  }
  const covered = new Set();
  for (const id of ids) for (const kp of kpsByQuestion.get(id) ?? []) covered.add(kp);
  const required = computeRequiredV2KpSet(snapshot);
  assert.equal(required.size, 16);
  for (const kp of required) assert.ok(covered.has(kp), `required KP ${kp} not covered`);
});

test('TEST H — KP shortage fails closed', () => {
  // one required KP of DS is referenced only by the old-gold question (excluded)
  const { snapshot, oldGold } = buildFixture();
  // remove all DS relations to kp 4 except via the old-gold row
  snapshot.questionKnowledgePoints = snapshot.questionKnowledgePoints.filter(
    (relation) => !(relation.questionId.startsWith('DS-q-') && relation.knowledgePointId === 'DS-kp-4'),
  );
  assert.throws(() => sampleV2QuestionIds(snapshot, oldGold), /DS-kp-4|blocked/);
});

test('TEST I — difficulty shortage fails closed with diagnostic', () => {
  const { snapshot, oldGold } = buildFixture({ osHardAvailable: 4 });
  assert.throws(() => sampleV2QuestionIds(snapshot, oldGold), /OS.*HARD|blocked/);
});

test('TEST J — deterministic: same input yields same ids and manifest SHA', () => {
  const { snapshot, oldGold } = buildFixture();
  const first = sampleV2QuestionIds(snapshot, oldGold);
  const second = sampleV2QuestionIds(snapshot, oldGold);
  assert.deepEqual(second, first);
  const m1 = buildV2SampleManifest({ snapshotId: snapshot.snapshotId, contentSha256: snapshot.contentSha256, entries: sampleEntries(snapshot, first) });
  const m2 = buildV2SampleManifest({ snapshotId: snapshot.snapshotId, contentSha256: snapshot.contentSha256, entries: sampleEntries(snapshot, second) });
  assert.equal(m2.sha256, m1.sha256);
});

test('TEST K — input ordering independence', () => {
  const { snapshot, oldGold } = buildFixture();
  const baseline = sampleV2QuestionIds(snapshot, oldGold);
  const reversed = {
    ...snapshot,
    questions: [...snapshot.questions].reverse(),
    questionKnowledgePoints: [...snapshot.questionKnowledgePoints].reverse(),
  };
  assert.deepEqual(sampleV2QuestionIds(reversed, oldGold), baseline);
});

test('TEST L — final tie-break is questionId ASC', () => {
  const { snapshot, oldGold } = buildFixture();
  const ids = sampleV2QuestionIds(snapshot, oldGold);
  const sorted = [...ids].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(ids, sorted);
});

test('TEST M — manifest validator rejects old Gold overlap when lineage provided', () => {
  const { snapshot, oldGold } = buildFixture();
  const ids = sampleV2QuestionIds(snapshot, oldGold);
  const manifest = buildV2SampleManifest({ snapshotId: snapshot.snapshotId, contentSha256: snapshot.contentSha256, entries: sampleEntries(snapshot, ids) });
  assert.equal(validateV2SampleManifest(manifest, snapshot, oldGold).ok, true);
  const polluted = {
    ...manifest,
    entries: [...manifest.entries, { questionId: 'DS-old-gold', contentFingerprint: 'fp-DS-old-gold', subject: 'DS', difficulty: 'BASIC', source: 'src-a', year: 2026, knowledgePointIds: ['DS-kp-1'] }],
  };
  const validation = validateV2SampleManifest(polluted, snapshot, oldGold);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((error) => error.includes('old gold') || error.includes('overlap') || error.includes('100')));
});

test('TEST N — manifest never contains question text fields', () => {
  const { snapshot, oldGold } = buildFixture();
  const ids = sampleV2QuestionIds(snapshot, oldGold);
  const manifest = buildV2SampleManifest({ snapshotId: snapshot.snapshotId, contentSha256: snapshot.contentSha256, entries: sampleEntries(snapshot, ids) });
  const json = JSON.stringify(manifest);
  assert.ok(!json.includes('"stem"'));
  assert.ok(!json.includes('"options"'));
  assert.ok(!json.includes('"answer"'));
  assert.ok(!json.includes('"analysis"'));
  assert.ok(!('split' in manifest));
});

test('V2-1: buildV2EligiblePool excludes copies, historical and V1 lineage', () => {
  const { snapshot, oldGold } = buildFixture();
  const pool = buildV2EligiblePool(snapshot, oldGold);
  for (const question of pool) {
    assert.equal(question.isCurrent, true);
    assert.equal(snapshot.roles[question.id], 'INDEPENDENT_UNIT');
    assert.ok(!oldGold.ids.has(question.id));
    assert.ok(!oldGold.fingerprints.has(question.contentFingerprint));
    assert.ok(!oldGold.families.has(question.familyId));
  }
});

test('V2-1: canonicalJsonHash is key-order independent (shared utility)', () => {
  const a = { b: 1, a: 2, nested: { y: true, x: 'v' } };
  const b = { a: 2, b: 1, nested: { x: 'v', y: true } };
  assert.equal(canonicalJsonHash(a), canonicalJsonHash(b));
  assert.notEqual(canonicalJsonHash(a), canonicalJsonHash({ ...a, b: 2 }));
});

test('V2-1: version constants are locked', () => {
  assert.equal(V2_GOLD_SAMPLE_VERSION, 'gold-sample-v2');
});
