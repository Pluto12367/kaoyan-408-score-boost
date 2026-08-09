import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJsonHash } from '../core/canonical.js';
import * as sampleV2Module from '../core/sampleV2.js';
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

function addConcentratedQuestion(snapshot, { subject, number, knowledgePointId, difficulty }) {
  const id = `${subject}-q-${String(number).padStart(3, '0')}`;
  snapshot.questions.push({
    id,
    subject,
    stem: `balanced fixture ${id}`,
    options: ['A', 'B'],
    answer: 'A',
    analysis: `balanced fixture analysis ${id}`,
    difficulty,
    type: 'SINGLE_CHOICE',
    source: 'same-source',
    year: 2026,
    expectedTimeSec: 100,
    contentFingerprint: `fp-${id}`,
    familyId: `family-${id}`,
    versionNumber: 1,
    isCurrent: true,
    chapterName: 'diagnostic-only-chapter',
    sectionName: 'diagnostic-only-section',
  });
  snapshot.questionKnowledgePoints.push({ questionId: id, knowledgePointId });
  snapshot.roles[id] = 'INDEPENDENT_UNIT';
  snapshot.duplicateRepresentative[id] = null;
}

/**
 * Per subject, the historical two-phase sampler deterministically selects:
 * kp-1=1, kp-2=11, kp-3=1, kp-4=12. A joint solution nevertheless exists.
 */
function buildConcentratedFixture() {
  const snapshot = {
    snapshotId: 'snap-v2r-concentrated',
    contentSha256: 'v2r-concentrated-content-sha',
    questions: [],
    knowledgePoints: [],
    questionKnowledgePoints: [],
    nodes: [],
    roles: {},
    duplicateRepresentative: {},
  };

  for (const subject of SUBJECTS) {
    for (let k = 1; k <= 4; k += 1) {
      snapshot.knowledgePoints.push({
        id: kpId(subject, k),
        subject,
        chapter: `${subject}-chapter-${k}`,
        title: `${subject}-title-${k}`,
      });
    }
    const add = (number, kp, difficulty) => addConcentratedQuestion(snapshot, {
      subject,
      number,
      knowledgePointId: kpId(subject, kp),
      difficulty,
    });

    for (let number = 1; number <= 7; number += 1) add(number, 2, 'BASIC');
    add(8, 4, 'BASIC');
    add(9, 1, 'BASIC');
    add(10, 3, 'BASIC');
    for (let number = 11; number <= 14; number += 1) add(number, 2, 'MEDIUM');
    for (let number = 15; number <= 20; number += 1) add(number, 4, 'MEDIUM');
    for (let number = 21; number <= 25; number += 1) add(number, 4, 'HARD');

    add(100, 1, 'BASIC');
    add(101, 1, 'MEDIUM');
    add(102, 1, 'MEDIUM');
    add(103, 1, 'MEDIUM');
    add(104, 1, 'HARD');
    add(105, 3, 'BASIC');
    add(106, 3, 'MEDIUM');
    add(107, 3, 'MEDIUM');
    add(108, 3, 'MEDIUM');
    add(109, 3, 'HARD');
    add(110, 4, 'BASIC');
    add(111, 4, 'BASIC');
  }

  return {
    snapshot,
    oldGold: { ids: new Set(), fingerprints: new Set(), families: new Set() },
  };
}

function kpDifficultyMatrix(snapshot, ids) {
  const byId = new Map(snapshot.questions.map((question) => [question.id, question]));
  const kpByQuestion = new Map(snapshot.questionKnowledgePoints.map((relation) => [relation.questionId, relation.knowledgePointId]));
  const matrix = {};
  for (const id of ids) {
    const question = byId.get(id);
    const kp = kpByQuestion.get(id);
    matrix[question.subject] ??= {};
    matrix[question.subject][kp] ??= { BASIC: 0, MEDIUM: 0, HARD: 0, total: 0 };
    matrix[question.subject][kp][question.difficulty] += 1;
    matrix[question.subject][kp].total += 1;
  }
  return matrix;
}

function runV2RSampler(snapshot, oldGold) {
  const sampler = sampleV2Module.sampleV2RQuestionIds ?? sampleV2QuestionIds;
  return sampler(snapshot, oldGold);
}

function buildNoJointSolutionFixture() {
  const fixture = buildConcentratedFixture();
  const { snapshot } = fixture;
  const questionById = new Map(snapshot.questions.map((question) => [question.id, question]));
  snapshot.questionKnowledgePoints = snapshot.questionKnowledgePoints.map((relation) => {
    const question = questionById.get(relation.questionId);
    if (question.subject === 'DS' && question.difficulty === 'BASIC') {
      return { ...relation, knowledgePointId: kpId('DS', 1) };
    }
    return relation;
  });
  for (let number = 900; number <= 902; number += 1) {
    addConcentratedQuestion(snapshot, { subject: 'DS', number, knowledgePointId: kpId('DS', 2), difficulty: 'MEDIUM' });
  }
  for (let number = 903; number <= 905; number += 1) {
    addConcentratedQuestion(snapshot, { subject: 'DS', number, knowledgePointId: kpId('DS', 3), difficulty: 'MEDIUM' });
  }
  return fixture;
}

test('V2-1R R1 — behavior regression replaces historical 1/11/1/12 with KP counts 6/7 only', () => {
  const { snapshot, oldGold } = buildConcentratedFixture();
  const ids = runV2RSampler(snapshot, oldGold);
  const matrix = kpDifficultyMatrix(snapshot, ids);
  for (const subject of SUBJECTS) {
    const counts = Object.values(matrix[subject]).map((row) => row.total).sort((a, b) => a - b);
    assert.deepEqual(counts, [6, 6, 6, 7], `${subject} actual KP counts=${counts.join('/')}`);
  }
});

test('V2-1R R2 — joint KP and difficulty quotas hold simultaneously', () => {
  const { snapshot, oldGold } = buildConcentratedFixture();
  const matrix = kpDifficultyMatrix(snapshot, runV2RSampler(snapshot, oldGold));
  for (const subject of SUBJECTS) {
    const rows = Object.values(matrix[subject]);
    assert.deepEqual(rows.map((row) => row.total).sort((a, b) => a - b), [6, 6, 6, 7]);
    assert.deepEqual(
      rows.reduce((sum, row) => ({
        BASIC: sum.BASIC + row.BASIC,
        MEDIUM: sum.MEDIUM + row.MEDIUM,
        HARD: sum.HARD + row.HARD,
      }), { BASIC: 0, MEDIUM: 0, HARD: 0 }),
      { BASIC: 10, MEDIUM: 10, HARD: 5 },
    );
  }
});

test('V2-1R R3 — exactly one KP per subject receives the seventh question', () => {
  const { snapshot, oldGold } = buildConcentratedFixture();
  const matrix = kpDifficultyMatrix(snapshot, runV2RSampler(snapshot, oldGold));
  for (const subject of SUBJECTS) {
    assert.equal(Object.values(matrix[subject]).filter((row) => row.total === 7).length, 1);
  }
});

test('V2-1R R4 — KP range is exactly min 6 max 7', () => {
  const { snapshot, oldGold } = buildConcentratedFixture();
  const matrix = kpDifficultyMatrix(snapshot, runV2RSampler(snapshot, oldGold));
  for (const subject of SUBJECTS) {
    const counts = Object.values(matrix[subject]).map((row) => row.total);
    assert.equal(Math.min(...counts), 6);
    assert.equal(Math.max(...counts), 7);
  }
});

test('V2-1R R5 — multiple feasible extra-7 owners resolve to the deterministic kp-2 owner', () => {
  const { snapshot, oldGold } = buildConcentratedFixture();
  const matrix = kpDifficultyMatrix(snapshot, runV2RSampler(snapshot, oldGold));
  for (const subject of SUBJECTS) {
    const owner = Object.entries(matrix[subject]).find(([, row]) => row.total === 7)?.[0];
    assert.equal(owner, kpId(subject, 2));
  }
});

test('V2-1R R6 — matrix winner is induced by the lexicographically first feasible question set', () => {
  const { snapshot, oldGold } = buildConcentratedFixture();
  const matrix = kpDifficultyMatrix(snapshot, runV2RSampler(snapshot, oldGold));
  for (const subject of SUBJECTS) {
    assert.deepEqual(matrix[subject][kpId(subject, 1)], { BASIC: 2, MEDIUM: 3, HARD: 1, total: 6 });
    assert.deepEqual(matrix[subject][kpId(subject, 2)], { BASIC: 6, MEDIUM: 1, HARD: 0, total: 7 });
    assert.deepEqual(matrix[subject][kpId(subject, 3)], { BASIC: 2, MEDIUM: 3, HARD: 1, total: 6 });
    assert.deepEqual(matrix[subject][kpId(subject, 4)], { BASIC: 0, MEDIUM: 3, HARD: 3, total: 6 });
  }
});

test('V2-1R R7 — joint solver escapes the historical greedy trap', () => {
  const { snapshot, oldGold } = buildConcentratedFixture();
  const historical = kpDifficultyMatrix(snapshot, sampleV2QuestionIds(snapshot, oldGold));
  const replacement = kpDifficultyMatrix(snapshot, runV2RSampler(snapshot, oldGold));
  for (const subject of SUBJECTS) {
    assert.deepEqual(
      [1, 2, 3, 4].map((index) => historical[subject][kpId(subject, index)].total),
      [1, 11, 1, 12],
    );
    assert.deepEqual(Object.values(replacement[subject]).map((row) => row.total).sort((a, b) => a - b), [6, 6, 6, 7]);
  }
});

test('V2-1R R8 — no joint solution fails closed without relaxing KP or difficulty quotas', () => {
  const { snapshot, oldGold } = buildNoJointSolutionFixture();
  assert.equal(typeof sampleV2Module.auditV2RSamplingFeasibility, 'function');
  const audit = sampleV2Module.auditV2RSamplingFeasibility(snapshot, oldGold);
  assert.equal(audit.feasible, false);
  assert.match(audit.errors.join('\n'), /SAMPLING DESIGN BLOCKED.*DS/s);
  assert.throws(() => runV2RSampler(snapshot, oldGold), /SAMPLING DESIGN BLOCKED.*DS/s);
});

test('V2-1R R9 — replacement version and manifest cannot overwrite the rejected contract', () => {
  assert.equal(sampleV2Module.V2R_GOLD_SAMPLE_VERSION, 'gold-sample-v2r');
  assert.equal(
    sampleV2Module.V2_REJECTED_PRE_SPLIT_SAMPLE_SHA256,
    '439f3527666784bb6a5ebe73ab44871e732846f59a0482b4543036eb8492a2fc',
  );
  assert.equal(typeof sampleV2Module.buildV2RSampleManifest, 'function');
  assert.equal(typeof sampleV2Module.validateV2RSampleManifest, 'function');
  const { snapshot, oldGold } = buildConcentratedFixture();
  const ids = runV2RSampler(snapshot, oldGold);
  const manifest = sampleV2Module.buildV2RSampleManifest({
    snapshotId: snapshot.snapshotId,
    contentSha256: snapshot.contentSha256,
    entries: sampleEntries(snapshot, ids),
  });
  assert.equal(manifest.goldVersion, 'gold-sample-v2r');
  assert.notEqual(manifest.goldVersion, V2_GOLD_SAMPLE_VERSION);
  assert.equal(sampleV2Module.validateV2RSampleManifest(manifest, snapshot, oldGold).ok, true);
  const rejected = { ...manifest, goldVersion: V2_GOLD_SAMPLE_VERSION, sha256: sampleV2Module.V2_REJECTED_PRE_SPLIT_SAMPLE_SHA256 };
  assert.match(sampleV2Module.validateV2RSampleManifest(rejected, snapshot, oldGold).errors.join('\n'), /REJECTED_PRE_SPLIT_SAMPLE/);
});

test('V2-1R R10 — repeated and reordered input yields identical ids and SHA; diagnostics do not affect selection', () => {
  const { snapshot, oldGold } = buildConcentratedFixture();
  const first = runV2RSampler(snapshot, oldGold);
  const reordered = {
    ...snapshot,
    questions: [...snapshot.questions].reverse(),
    questionKnowledgePoints: [...snapshot.questionKnowledgePoints].reverse(),
  };
  const second = runV2RSampler(reordered, oldGold);
  assert.deepEqual(second, first);
  assert.equal(typeof sampleV2Module.buildV2RSampleManifest, 'function');
  const firstManifest = sampleV2Module.buildV2RSampleManifest({
    snapshotId: snapshot.snapshotId,
    contentSha256: snapshot.contentSha256,
    entries: sampleEntries(snapshot, first),
  });
  const secondManifest = sampleV2Module.buildV2RSampleManifest({
    snapshotId: reordered.snapshotId,
    contentSha256: reordered.contentSha256,
    entries: sampleEntries(reordered, second),
  });
  assert.equal(secondManifest.sha256, firstManifest.sha256);

  const diagnosticsChanged = {
    ...snapshot,
    questions: snapshot.questions.map((question, index) => ({
      ...question,
      source: `diagnostic-source-${index}`,
      year: 1900 + index,
      chapterName: `diagnostic-chapter-${index}`,
    })),
  };
  assert.deepEqual(runV2RSampler(diagnosticsChanged, oldGold), first);
});

function buildHardConcentrationFixture() {
  const snapshot = {
    snapshotId: 'snap-v2r2-hard-concentration',
    contentSha256: 'v2r2-hard-concentration-content-sha',
    questions: [],
    knowledgePoints: [],
    questionKnowledgePoints: [],
    nodes: [],
    roles: {},
    duplicateRepresentative: {},
  };

  for (const subject of SUBJECTS) {
    for (let k = 1; k <= 4; k += 1) {
      snapshot.knowledgePoints.push({
        id: kpId(subject, k),
        subject,
        chapter: `${subject}-chapter-${k}`,
        title: `${subject}-title-${k}`,
      });
    }
    let number = 0;
    const addMany = (kp, difficulty, count) => {
      for (let index = 0; index < count; index += 1) {
        number += 1;
        addConcentratedQuestion(snapshot, {
          subject,
          number,
          knowledgePointId: kpId(subject, kp),
          difficulty,
        });
      }
    };

    // The lexicographically first 25 questions form the rejected 4/1/0/0
    // HARD allocation. Later ids make a 2/1/1/1 allocation feasible.
    addMany(1, 'BASIC', 2);
    addMany(1, 'MEDIUM', 1);
    addMany(1, 'HARD', 4);
    addMany(2, 'BASIC', 2);
    addMany(2, 'MEDIUM', 3);
    addMany(2, 'HARD', 1);
    addMany(3, 'BASIC', 3);
    addMany(3, 'MEDIUM', 3);
    addMany(4, 'BASIC', 3);
    addMany(4, 'MEDIUM', 3);

    addMany(1, 'BASIC', 1);
    addMany(1, 'MEDIUM', 1);
    addMany(3, 'HARD', 1);
    addMany(4, 'HARD', 1);
  }

  return {
    snapshot,
    oldGold: { ids: new Set(), fingerprints: new Set(), families: new Set() },
  };
}

function allocationMatrix(rows) {
  return Object.fromEntries(rows.map(([id, BASIC, MEDIUM, HARD]) => [id, { BASIC, MEDIUM, HARD }]));
}

function integerDeviation(matrix) {
  return Object.values(matrix).reduce((total, row) => {
    const kpTotal = row.BASIC + row.MEDIUM + row.HARD;
    return total
      + (5 * row.BASIC - 2 * kpTotal) ** 2
      + (5 * row.MEDIUM - 2 * kpTotal) ** 2
      + (5 * row.HARD - kpTotal) ** 2;
  }, 0);
}

function hardCountsForSubject(snapshot, ids, subject) {
  const matrix = kpDifficultyMatrix(snapshot, ids)[subject];
  return Object.fromEntries(
    Object.entries(matrix).map(([id, row]) => [id, row.HARD]),
  );
}

function renameDsKpsToSyntheticIds(snapshot) {
  const replacements = new Map([
    [kpId('DS', 1), 'aa'],
    [kpId('DS', 2), 'bb'],
    [kpId('DS', 3), 'cc'],
    [kpId('DS', 4), 'dd'],
  ]);
  snapshot.knowledgePoints = snapshot.knowledgePoints.map((point) => ({
    ...point,
    id: replacements.get(point.id) ?? point.id,
  }));
  snapshot.questionKnowledgePoints = snapshot.questionKnowledgePoints.map((relation) => ({
    ...relation,
    knowledgePointId: replacements.get(relation.knowledgePointId) ?? relation.knowledgePointId,
  }));
}

function runV2R2Sampler(snapshot, oldGold) {
  assert.equal(typeof sampleV2Module.sampleV2R2QuestionIds, 'function');
  return sampleV2Module.sampleV2R2QuestionIds(snapshot, oldGold);
}

test('V2-1R2 R2-1 — rejected V2R question-set selector concentrates HARD 4/1/0/0; V2R2 minimizes maxHard to 2', () => {
  const { snapshot, oldGold } = buildHardConcentrationFixture();
  const rejectedHard = Object.values(hardCountsForSubject(snapshot, sampleV2Module.sampleV2RQuestionIds(snapshot, oldGold), 'DS'))
    .sort((a, b) => b - a);
  assert.deepEqual(rejectedHard, [4, 1, 0, 0]);

  const replacementHard = Object.values(hardCountsForSubject(snapshot, runV2R2Sampler(snapshot, oldGold), 'DS'))
    .sort((a, b) => b - a);
  assert.deepEqual(replacementHard, [2, 1, 1, 1]);
});

test('V2-1R2 R2-2 — matrix objective 1 minimizes maxHard', () => {
  assert.equal(typeof sampleV2Module.scoreV2R2Matrix, 'function');
  assert.equal(typeof sampleV2Module.compareV2R2MatrixScores, 'function');
  const eligible = new Map([['aa', 20], ['bb', 19], ['cc', 18], ['dd', 17]]);
  const concentrated = allocationMatrix([
    ['aa', 2, 1, 4], ['bb', 2, 3, 1], ['cc', 3, 3, 0], ['dd', 3, 3, 0],
  ]);
  const middle = allocationMatrix([
    ['aa', 2, 2, 3], ['bb', 2, 3, 1], ['cc', 3, 2, 1], ['dd', 3, 3, 0],
  ]);
  const spread = allocationMatrix([
    ['aa', 3, 2, 2], ['bb', 2, 3, 1], ['cc', 2, 3, 1], ['dd', 3, 2, 1],
  ]);
  const scores = [concentrated, middle, spread].map((matrix) => sampleV2Module.scoreV2R2Matrix(matrix, eligible));
  assert.deepEqual(scores.map((score) => score.maxHard), [4, 3, 2]);
  assert.equal(sampleV2Module.compareV2R2MatrixScores(scores[2], scores[1]) < 0, true);
  assert.equal(sampleV2Module.compareV2R2MatrixScores(scores[1], scores[0]) < 0, true);
});

test('V2-1R2 R2-3 — matrix objective 2 minimizes hardRange after maxHard', () => {
  const eligible = new Map([['aa', 20], ['bb', 19], ['cc', 18], ['dd', 17]]);
  const zeroHard = allocationMatrix([
    ['aa', 3, 2, 2], ['bb', 2, 2, 2], ['cc', 2, 3, 1], ['dd', 3, 3, 0],
  ]);
  const allCovered = allocationMatrix([
    ['aa', 3, 2, 2], ['bb', 2, 3, 1], ['cc', 2, 3, 1], ['dd', 3, 2, 1],
  ]);
  const zeroScore = sampleV2Module.scoreV2R2Matrix(zeroHard, eligible);
  const coveredScore = sampleV2Module.scoreV2R2Matrix(allCovered, eligible);
  assert.equal(zeroScore.maxHard, 2);
  assert.equal(coveredScore.maxHard, 2);
  assert.equal(zeroScore.hardRange, 2);
  assert.equal(coveredScore.hardRange, 1);
  assert.equal(sampleV2Module.compareV2R2MatrixScores(coveredScore, zeroScore) < 0, true);
});

test('V2-1R2 R2-4 — matrix objective 3 uses the locked integer deviation cost', () => {
  const eligible = new Map([['aa', 20], ['bb', 19], ['cc', 18], ['dd', 17]]);
  const balanced = allocationMatrix([
    ['aa', 3, 2, 2], ['bb', 2, 3, 1], ['cc', 2, 3, 1], ['dd', 3, 2, 1],
  ]);
  const skewed = allocationMatrix([
    ['aa', 4, 1, 2], ['bb', 1, 4, 1], ['cc', 2, 3, 1], ['dd', 3, 2, 1],
  ]);
  const balancedScore = sampleV2Module.scoreV2R2Matrix(balanced, eligible);
  const skewedScore = sampleV2Module.scoreV2R2Matrix(skewed, eligible);
  assert.equal(balancedScore.difficultyDeviationCost, integerDeviation(balanced));
  assert.equal(skewedScore.difficultyDeviationCost, integerDeviation(skewed));
  assert.equal(balancedScore.difficultyDeviationCost < skewedScore.difficultyDeviationCost, true);
  assert.equal(sampleV2Module.compareV2R2MatrixScores(balancedScore, skewedScore) < 0, true);
});

test('V2-1R2 R2-5 — extra-7 eligible total cannot outrank a better deviation cost', () => {
  const eligible = new Map([['aa', 10], ['bb', 99], ['cc', 18], ['dd', 17]]);
  const betterDeviation = allocationMatrix([
    ['aa', 3, 2, 2], ['bb', 2, 3, 1], ['cc', 2, 3, 1], ['dd', 3, 2, 1],
  ]);
  const higherEligibleOwner = allocationMatrix([
    ['aa', 4, 1, 1], ['bb', 1, 4, 2], ['cc', 2, 3, 1], ['dd', 3, 2, 1],
  ]);
  const betterScore = sampleV2Module.scoreV2R2Matrix(betterDeviation, eligible);
  const eligibleScore = sampleV2Module.scoreV2R2Matrix(higherEligibleOwner, eligible);
  assert.equal(betterScore.maxHard, eligibleScore.maxHard);
  assert.equal(betterScore.hardRange, eligibleScore.hardRange);
  assert.equal(betterScore.difficultyDeviationCost < eligibleScore.difficultyDeviationCost, true);
  assert.equal(betterScore.extraSevenEligible < eligibleScore.extraSevenEligible, true);
  assert.equal(sampleV2Module.compareV2R2MatrixScores(betterScore, eligibleScore) < 0, true);
});

test('V2-1R2 R2-6 — objective 4 gives the seventh slot to the higher eligible-total KP', () => {
  const eligible = new Map([['aa', 10], ['bb', 20], ['cc', 18], ['dd', 17]]);
  const extraAa = allocationMatrix([
    ['aa', 3, 2, 2], ['bb', 2, 3, 1], ['cc', 2, 3, 1], ['dd', 3, 2, 1],
  ]);
  const extraBb = allocationMatrix([
    ['aa', 2, 3, 1], ['bb', 3, 2, 2], ['cc', 2, 3, 1], ['dd', 3, 2, 1],
  ]);
  const aaScore = sampleV2Module.scoreV2R2Matrix(extraAa, eligible);
  const bbScore = sampleV2Module.scoreV2R2Matrix(extraBb, eligible);
  assert.equal(aaScore.difficultyDeviationCost, bbScore.difficultyDeviationCost);
  assert.equal(bbScore.extraSevenEligible, 20);
  assert.equal(sampleV2Module.compareV2R2MatrixScores(bbScore, aaScore) < 0, true);
});

test('V2-1R2 R2-7 — objective 4 breaks equal eligible totals by extra-7 kpId ASC', () => {
  const eligible = new Map([['aa', 20], ['bb', 20], ['cc', 18], ['dd', 17]]);
  const extraAa = allocationMatrix([
    ['aa', 3, 2, 2], ['bb', 2, 3, 1], ['cc', 2, 3, 1], ['dd', 3, 2, 1],
  ]);
  const extraBb = allocationMatrix([
    ['aa', 2, 3, 1], ['bb', 3, 2, 2], ['cc', 2, 3, 1], ['dd', 3, 2, 1],
  ]);
  const aaScore = sampleV2Module.scoreV2R2Matrix(extraAa, eligible);
  const bbScore = sampleV2Module.scoreV2R2Matrix(extraBb, eligible);
  assert.equal(aaScore.extraSevenEligible, bbScore.extraSevenEligible);
  assert.equal(sampleV2Module.compareV2R2MatrixScores(aaScore, bbScore) < 0, true);
});

test('V2-1R2 R2-8 — objective 5 uses canonical matrix lexical ASC only as final tie-break', () => {
  const eligible = new Map([['aa', 20], ['bb', 19], ['cc', 18], ['dd', 17]]);
  const lexicalFirst = allocationMatrix([
    ['aa', 3, 2, 2], ['bb', 2, 3, 1], ['cc', 2, 3, 1], ['dd', 3, 2, 1],
  ]);
  const lexicalSecond = allocationMatrix([
    ['aa', 3, 2, 2], ['bb', 3, 2, 1], ['cc', 2, 3, 1], ['dd', 2, 3, 1],
  ]);
  const firstScore = sampleV2Module.scoreV2R2Matrix(lexicalFirst, eligible);
  const secondScore = sampleV2Module.scoreV2R2Matrix(lexicalSecond, eligible);
  assert.deepEqual(
    [firstScore.maxHard, firstScore.hardRange, firstScore.difficultyDeviationCost, firstScore.extraSevenKpId],
    [secondScore.maxHard, secondScore.hardRange, secondScore.difficultyDeviationCost, secondScore.extraSevenKpId],
  );
  assert.equal(sampleV2Module.compareV2R2MatrixScores(firstScore, secondScore) < 0, true);
});

test('V2-1R2 R2-9 — solver has no hardcoded subject or production KP solution', () => {
  const { snapshot, oldGold } = buildHardConcentrationFixture();
  renameDsKpsToSyntheticIds(snapshot);
  const ids = runV2R2Sampler(snapshot, oldGold);
  const hard = hardCountsForSubject(snapshot, ids, 'DS');
  assert.deepEqual(Object.keys(hard).sort(), ['aa', 'bb', 'cc', 'dd']);
  assert.equal(Math.max(...Object.values(hard)), 2);
  assert.equal(Math.max(...Object.values(hard)) - Math.min(...Object.values(hard)), 1);
});

test('V2-1R2 R2-10 — impossible 7/6/6/6 + 10/10/5 allocation throws without relaxation', () => {
  const { snapshot, oldGold } = buildNoJointSolutionFixture();
  assert.throws(() => runV2R2Sampler(snapshot, oldGold), /SAMPLING DESIGN BLOCKED.*DS/s);
});

test('V2-1R2 R2-11 — validator rejects V2 and V2R versions as accepted V2R2 contracts', () => {
  const { snapshot, oldGold } = buildHardConcentrationFixture();
  const ids = runV2R2Sampler(snapshot, oldGold);
  const valid = sampleV2Module.buildV2R2SampleManifest({
    snapshotId: snapshot.snapshotId,
    contentSha256: snapshot.contentSha256,
    entries: sampleEntries(snapshot, ids),
  });
  for (const rejectedVersion of ['gold-sample-v2', 'gold-sample-v2r']) {
    const rejected = buildV2SampleManifest({
      snapshotId: snapshot.snapshotId,
      contentSha256: snapshot.contentSha256,
      goldVersion: rejectedVersion,
      entries: valid.entries,
    });
    assert.equal(sampleV2Module.validateV2R2SampleManifest(rejected, snapshot, oldGold).ok, false);
  }
});

test('V2-1R2 R2-12 — validator accepts the canonical gold-sample-v2r2 contract', () => {
  const { snapshot, oldGold } = buildHardConcentrationFixture();
  const ids = runV2R2Sampler(snapshot, oldGold);
  const manifest = sampleV2Module.buildV2R2SampleManifest({
    snapshotId: snapshot.snapshotId,
    contentSha256: snapshot.contentSha256,
    entries: sampleEntries(snapshot, ids),
  });
  assert.equal(sampleV2Module.V2R2_GOLD_SAMPLE_VERSION, 'gold-sample-v2r2');
  assert.equal(manifest.goldVersion, 'gold-sample-v2r2');
  assert.deepEqual(sampleV2Module.validateV2R2SampleManifest(manifest, snapshot, oldGold), { ok: true, errors: [] });
});

test('V2-1R2 — repeated and reordered input yields identical ids and manifest SHA', () => {
  const { snapshot, oldGold } = buildHardConcentrationFixture();
  const first = runV2R2Sampler(snapshot, oldGold);
  const reordered = {
    ...snapshot,
    questions: [...snapshot.questions].reverse(),
    knowledgePoints: [...snapshot.knowledgePoints].reverse(),
    questionKnowledgePoints: [...snapshot.questionKnowledgePoints].reverse(),
  };
  const second = runV2R2Sampler(reordered, oldGold);
  assert.deepEqual(second, first);
  const firstManifest = sampleV2Module.buildV2R2SampleManifest({
    snapshotId: snapshot.snapshotId,
    contentSha256: snapshot.contentSha256,
    entries: sampleEntries(snapshot, first),
  });
  const secondManifest = sampleV2Module.buildV2R2SampleManifest({
    snapshotId: reordered.snapshotId,
    contentSha256: reordered.contentSha256,
    entries: sampleEntries(reordered, second),
  });
  assert.equal(secondManifest.sha256, firstManifest.sha256);
});

test('V2-1R2 — validator rejects a hard-feasible but objectively inferior sample', () => {
  const { snapshot, oldGold } = buildHardConcentrationFixture();
  const rejectedIds = sampleV2Module.sampleV2RQuestionIds(snapshot, oldGold);
  const inferior = buildV2SampleManifest({
    snapshotId: snapshot.snapshotId,
    contentSha256: snapshot.contentSha256,
    goldVersion: 'gold-sample-v2r2',
    entries: sampleEntries(snapshot, rejectedIds),
  });
  const validation = sampleV2Module.validateV2R2SampleManifest(inferior, snapshot, oldGold);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join('\n'), /canonical V2R2 selection/);
});
