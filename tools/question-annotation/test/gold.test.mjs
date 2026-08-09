import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildGoldManifest, validateGoldManifest } from '../core/sample.js';
import {
  GOLD_SET_VERSION,
  createGoldSet,
  freezeGoldManifest,
  loadGoldSet,
  saveGoldSet,
  validateGoldEntry,
} from '../core/gold.js';

const SUBJECTS = ['DS', 'CO', 'OS', 'CN'];

function nextSubject(subject) {
  return SUBJECTS[(SUBJECTS.indexOf(subject) + 1) % SUBJECTS.length];
}

/**
 * Synthetic-only fixture: 40 gold questions (10 per subject) and a node tree
 * per subject with active atomic points, one inactive atomic point, one
 * cross-subject atomic point and a chapter node (for negative cases). No
 * production question text is used anywhere.
 */
function buildSyntheticFixture() {
  const snapshot = { snapshotId: 'snap-gold-fixture', questions: [], nodes: [], roles: {}, duplicateRepresentative: {} };
  for (const subject of SUBJECTS) {
    const chapterId = `${subject}-ch-1`;
    snapshot.nodes.push({ id: chapterId, parentId: null, subject, nodeType: 'chapter', name: `${subject} chapter 1`, isActive: true });
    for (let section = 1; section <= 2; section += 1) {
      const sectionId = `${subject}-sec-${section}`;
      snapshot.nodes.push({ id: sectionId, parentId: chapterId, subject, nodeType: 'section', name: `${subject} section ${section}`, isActive: true });
      for (let point = 1; point <= 4; point += 1) {
        snapshot.nodes.push({
          id: `${subject}-point-${section}-${point}`,
          parentId: sectionId,
          subject,
          nodeType: 'atomicPoint',
          name: `${subject} atomic point ${section}.${point}`,
          isActive: true,
        });
      }
    }
    snapshot.nodes.push({ id: `${subject}-point-inactive`, parentId: `${subject}-sec-1`, subject, nodeType: 'atomicPoint', name: `${subject} inactive point`, isActive: false });
    snapshot.nodes.push({ id: `${subject}-point-cross`, parentId: `${subject}-sec-1`, subject: nextSubject(subject), nodeType: 'atomicPoint', name: `${subject} cross point`, isActive: true });
    for (let index = 1; index <= 10; index += 1) {
      const id = `${subject}-g-${String(index).padStart(2, '0')}`;
      snapshot.questions.push({
        id,
        subject,
        stem: `synthetic stem ${id}`,
        options: ['A', 'B'],
        answer: 'A',
        analysis: `synthetic analysis ${id}`,
        contentFingerprint: `fp-${id}`,
        isCurrent: true,
        familyId: `f-${id}`,
        versionNumber: 1,
      });
      snapshot.roles[id] = 'INDEPENDENT_UNIT';
      snapshot.duplicateRepresentative[id] = null;
    }
  }

  const frozenEntries = [];
  for (const subject of SUBJECTS) {
    const questions = snapshot.questions.filter((question) => question.subject === subject).sort((a, b) => a.id.localeCompare(b.id));
    questions.forEach((question, index) => {
      frozenEntries.push({
        questionId: question.id,
        contentFingerprint: question.contentFingerprint,
        subject,
        split: [1, 4, 7, 9].includes(index) ? 'HOLDOUT' : 'DEV',
      });
    });
  }
  const frozenManifest = buildGoldManifest({
    goldVersion: 'gold-sample-v1',
    snapshotId: snapshot.snapshotId,
    entries: frozenEntries.map((entry) => ({
      questionId: entry.questionId,
      contentFingerprint: entry.contentFingerprint,
      primaryNodeId: null,
      secondaryNodeIds: [],
      split: entry.split,
    })),
  });
  return { snapshot, frozen: { entries: frozenEntries, sha256: frozenManifest.sha256 } };
}

function buildMaps(snapshot, frozen) {
  return {
    nodeIds: new Set(snapshot.nodes.map((node) => node.id)),
    nodeSubject: new Map(snapshot.nodes.map((node) => [node.id, node.subject])),
    nodeActive: new Set(snapshot.nodes.filter((node) => node.isActive).map((node) => node.id)),
    nodeAtomic: new Set(snapshot.nodes.filter((node) => node.nodeType === 'atomicPoint').map((node) => node.id)),
    byQuestion: new Map(snapshot.questions.map((question) => [question.id, { subject: question.subject }])),
    fingerprintByQuestion: new Map(snapshot.questions.map((question) => [question.id, question.contentFingerprint])),
    splitByQuestion: new Map(frozen.entries.map((entry) => [entry.questionId, entry.split])),
    frozenQuestionIds: new Set(frozen.entries.map((entry) => entry.questionId)),
  };
}

function validEntry(overrides = {}) {
  return {
    questionId: 'DS-g-01',
    primaryNodeId: 'DS-point-1-1',
    secondaryNodeIds: [],
    contentFingerprint: 'fp-DS-g-01',
    split: 'DEV',
    ...overrides,
  };
}

function goldContext(maps) {
  return {
    nodeActive: maps.nodeActive,
    nodeAtomic: maps.nodeAtomic,
    frozenQuestionIds: maps.frozenQuestionIds,
    contentFingerprintByQuestion: maps.fingerprintByQuestion,
    splitByQuestion: maps.splitByQuestion,
  };
}

function makeGoldSet(snapshot, frozen, { confirmedCount = 40, primary = (f) => `${f.subject}-point-1-1` } = {}) {
  const goldSet = createGoldSet({
    snapshotId: snapshot.snapshotId,
    frozen: frozen.entries,
    frozenManifestSha256: frozen.sha256,
  });
  [...frozen.entries]
    .sort((a, b) => a.questionId.localeCompare(b.questionId))
    .forEach((entry, index) => {
      goldSet.authoring[entry.questionId] = {
        status: index < confirmedCount ? 'confirmed' : 'draft',
        primaryNodeId: primary(entry),
        secondaryNodeIds: [],
      };
    });
  return goldSet;
}

test('validateGoldEntry enforces PRIMARY exactly 1 and SECONDARY <= 2 with subject match', () => {
  const nodeIds = new Set(['n1', 'n2', 'n3']);
  const byQuestion = new Map([['q1', { subject: 'DS' }]]);
  const nodeSubject = new Map([['n1', 'DS'], ['n2', 'CO'], ['n3', 'DS']]);
  assert.equal(validateGoldEntry({ questionId: 'q1', primaryNodeId: 'n1', secondaryNodeIds: ['n3'] }, nodeIds, byQuestion, nodeSubject).ok, true);
  assert.equal(validateGoldEntry({ questionId: 'q1', primaryNodeId: 'n2', secondaryNodeIds: [] }, nodeIds, byQuestion, nodeSubject).ok, false); // 跨科
  assert.equal(validateGoldEntry({ questionId: 'q1', primaryNodeId: 'n1', secondaryNodeIds: ['n1'] }, nodeIds, byQuestion, nodeSubject).ok, false); // PRIMARY == SECONDARY
  assert.equal(validateGoldEntry({ questionId: 'q1', primaryNodeId: null, secondaryNodeIds: [] }, nodeIds, byQuestion, nodeSubject).ok, false); // PRIMARY null
});

test('A: valid PRIMARY with 0 SECONDARY passes', () => {
  const { snapshot, frozen } = buildSyntheticFixture();
  const maps = buildMaps(snapshot, frozen);
  const result = validateGoldEntry(validEntry(), maps.nodeIds, maps.byQuestion, maps.nodeSubject, goldContext(maps));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.errors, []);
});

test('B: valid PRIMARY with 2 SECONDARY passes', () => {
  const { snapshot, frozen } = buildSyntheticFixture();
  const maps = buildMaps(snapshot, frozen);
  const entry = validEntry({ secondaryNodeIds: ['DS-point-1-2', 'DS-point-2-1'] });
  const result = validateGoldEntry(entry, maps.nodeIds, maps.byQuestion, maps.nodeSubject, goldContext(maps));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test('C: 0 PRIMARY cannot confirm', () => {
  const { snapshot, frozen } = buildSyntheticFixture();
  const maps = buildMaps(snapshot, frozen);
  const result = validateGoldEntry(validEntry({ primaryNodeId: null }), maps.nodeIds, maps.byQuestion, maps.nodeSubject, goldContext(maps));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('PRIMARY')));
});

test('D: SECONDARY > 2 rejected', () => {
  const { snapshot, frozen } = buildSyntheticFixture();
  const maps = buildMaps(snapshot, frozen);
  const result = validateGoldEntry(
    validEntry({ secondaryNodeIds: ['DS-point-1-2', 'DS-point-1-3', 'DS-point-2-1'] }),
    maps.nodeIds,
    maps.byQuestion,
    maps.nodeSubject,
    goldContext(maps),
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('SECONDARY')));
});

test('E: PRIMARY also SECONDARY rejected', () => {
  const { snapshot, frozen } = buildSyntheticFixture();
  const maps = buildMaps(snapshot, frozen);
  const result = validateGoldEntry(
    validEntry({ secondaryNodeIds: ['DS-point-1-1'] }),
    maps.nodeIds,
    maps.byQuestion,
    maps.nodeSubject,
    goldContext(maps),
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('PRIMARY') && error.includes('SECONDARY')));
});

test('F: duplicate SECONDARY rejected', () => {
  const { snapshot, frozen } = buildSyntheticFixture();
  const maps = buildMaps(snapshot, frozen);
  const result = validateGoldEntry(
    validEntry({ secondaryNodeIds: ['DS-point-1-2', 'DS-point-1-2'] }),
    maps.nodeIds,
    maps.byQuestion,
    maps.nodeSubject,
    goldContext(maps),
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('duplicate')));
});

test('G: cross-subject node rejected', () => {
  const { snapshot, frozen } = buildSyntheticFixture();
  const maps = buildMaps(snapshot, frozen);
  const primaryCross = validateGoldEntry(
    validEntry({ primaryNodeId: 'DS-point-cross' }),
    maps.nodeIds,
    maps.byQuestion,
    maps.nodeSubject,
    goldContext(maps),
  );
  assert.equal(primaryCross.ok, false);
  assert.ok(primaryCross.errors.some((error) => error.includes('cross-subject')));
  const secondaryCross = validateGoldEntry(
    validEntry({ secondaryNodeIds: ['DS-point-cross'] }),
    maps.nodeIds,
    maps.byQuestion,
    maps.nodeSubject,
    goldContext(maps),
  );
  assert.equal(secondaryCross.ok, false);
});

test('H: inactive node rejected', () => {
  const { snapshot, frozen } = buildSyntheticFixture();
  const maps = buildMaps(snapshot, frozen);
  const result = validateGoldEntry(
    validEntry({ primaryNodeId: 'DS-point-inactive' }),
    maps.nodeIds,
    maps.byQuestion,
    maps.nodeSubject,
    goldContext(maps),
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('inactive')));
});

test('I: non-atomic node rejected', () => {
  const { snapshot, frozen } = buildSyntheticFixture();
  const maps = buildMaps(snapshot, frozen);
  const result = validateGoldEntry(
    validEntry({ primaryNodeId: 'DS-ch-1' }),
    maps.nodeIds,
    maps.byQuestion,
    maps.nodeSubject,
    goldContext(maps),
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('non-atomic')));
});

test('J: nonexistent node rejected', () => {
  const { snapshot, frozen } = buildSyntheticFixture();
  const maps = buildMaps(snapshot, frozen);
  const result = validateGoldEntry(
    validEntry({ primaryNodeId: 'DS-point-9-9' }),
    maps.nodeIds,
    maps.byQuestion,
    maps.nodeSubject,
    goldContext(maps),
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('nonexistent')));
});

test('K: question fingerprint drift rejected', () => {
  const { snapshot, frozen } = buildSyntheticFixture();
  const maps = buildMaps(snapshot, frozen);
  const result = validateGoldEntry(
    validEntry({ contentFingerprint: 'drifted-fingerprint' }),
    maps.nodeIds,
    maps.byQuestion,
    maps.nodeSubject,
    goldContext(maps),
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.toLowerCase().includes('fingerprint')));
});

test('L: snapshot drift fails closed at freeze', () => {
  const { snapshot, frozen } = buildSyntheticFixture();
  const goldSet = makeGoldSet(snapshot, frozen);
  goldSet.snapshotId = 'snap-other';
  const result = freezeGoldManifest({ goldVersion: 'gold-truth-v1', goldSet, snapshot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('snapshot')));
});

test('M: split drift rejected', () => {
  const { snapshot, frozen } = buildSyntheticFixture();
  const maps = buildMaps(snapshot, frozen);
  const result = validateGoldEntry(
    validEntry({ split: 'HOLDOUT' }),
    maps.nodeIds,
    maps.byQuestion,
    maps.nodeSubject,
    goldContext(maps),
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('split')));
  const goldSet = makeGoldSet(snapshot, frozen);
  goldSet.frozen[0].split = 'HOLDOUT';
  const freeze = freezeGoldManifest({ goldVersion: 'gold-truth-v1', goldSet, snapshot });
  assert.equal(freeze.ok, false);
});

test('N: draft is never treated as confirmed', () => {
  const { snapshot, frozen } = buildSyntheticFixture();
  const goldSet = makeGoldSet(snapshot, frozen, { confirmedCount: 39 });
  const result = freezeGoldManifest({ goldVersion: 'gold-truth-v1', goldSet, snapshot });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes('confirmed')));
  assert.equal(result.manifest, undefined);
});

test('O: close/reopen preserves authoring progress', () => {
  const { snapshot, frozen } = buildSyntheticFixture();
  const dir = mkdtempSync(join(tmpdir(), 'gold-'));
  const path = join(dir, 'gold-set-v1.json');
  const goldSet = makeGoldSet(snapshot, frozen, { confirmedCount: 5 });
  goldSet.authoring['DS-g-01'].primaryNodeId = 'DS-point-2-2';
  goldSet.authoring['DS-g-01'].secondaryNodeIds = ['DS-point-1-3'];
  saveGoldSet(path, goldSet);
  const reloaded = loadGoldSet(path);
  assert.deepEqual(reloaded, goldSet);
  assert.equal(reloaded.authoring['DS-g-01'].primaryNodeId, 'DS-point-2-2');
  assert.deepEqual(reloaded.authoring['DS-g-01'].secondaryNodeIds, ['DS-point-1-3']);
  assert.equal(reloaded.authoring['DS-g-02'].status, 'draft');
});

test('P: 39/40 confirmed cannot freeze the final manifest', () => {
  const { snapshot, frozen } = buildSyntheticFixture();
  const goldSet = makeGoldSet(snapshot, frozen, { confirmedCount: 39 });
  const result = freezeGoldManifest({ goldVersion: 'gold-truth-v1', goldSet, snapshot });
  assert.equal(result.ok, false);
  assert.equal(result.manifest, undefined);
});

test('Q: 40/40 valid confirmed can freeze a valid manifest', () => {
  const { snapshot, frozen } = buildSyntheticFixture();
  const goldSet = makeGoldSet(snapshot, frozen, { confirmedCount: 40 });
  const result = freezeGoldManifest({ goldVersion: 'gold-truth-v1', goldSet, snapshot });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.ok(result.manifest);
  assert.equal(result.manifest.entries.length, 40);
  const dsEntry = result.manifest.entries.find((entry) => entry.questionId === 'DS-g-01');
  assert.equal(dsEntry.primaryNodeId, 'DS-point-1-1');
  const structural = validateGoldManifest(result.manifest, snapshot);
  assert.equal(structural.ok, true, JSON.stringify(structural.errors));
});

test('R: final frozen manifest contains no stem/options/answer/analysis', () => {
  const { snapshot, frozen } = buildSyntheticFixture();
  const goldSet = makeGoldSet(snapshot, frozen, { confirmedCount: 40 });
  const result = freezeGoldManifest({ goldVersion: 'gold-truth-v1', goldSet, snapshot });
  const json = JSON.stringify(result.manifest);
  assert.ok(!json.includes('"stem"'));
  assert.ok(!json.includes('"options"'));
  assert.ok(!json.includes('"answer"'));
  assert.ok(!json.includes('"analysis"'));
});

test('S: changing PRIMARY or SECONDARY changes the manifest sha256', () => {
  const { snapshot, frozen } = buildSyntheticFixture();
  const base = makeGoldSet(snapshot, frozen, { confirmedCount: 40 });
  const changedPrimary = makeGoldSet(snapshot, frozen, {
    confirmedCount: 40,
    primary: (entry) => (entry.questionId === 'DS-g-01' ? 'DS-point-1-2' : `${entry.subject}-point-1-1`),
  });
  const changedSecondary = makeGoldSet(snapshot, frozen, { confirmedCount: 40 });
  changedSecondary.authoring['DS-g-01'].secondaryNodeIds = ['DS-point-1-2'];
  const first = freezeGoldManifest({ goldVersion: 'gold-truth-v1', goldSet: base, snapshot });
  const second = freezeGoldManifest({ goldVersion: 'gold-truth-v1', goldSet: changedPrimary, snapshot });
  const third = freezeGoldManifest({ goldVersion: 'gold-truth-v1', goldSet: changedSecondary, snapshot });
  assert.equal(first.ok && second.ok && third.ok, true);
  assert.notEqual(second.manifest.sha256, first.manifest.sha256);
  assert.notEqual(third.manifest.sha256, first.manifest.sha256);
});

test('T: authoring cannot change frozen question ids or splits', () => {
  const { snapshot, frozen } = buildSyntheticFixture();
  const extra = makeGoldSet(snapshot, frozen, { confirmedCount: 40 });
  extra.authoring['DS-g-99'] = { status: 'confirmed', primaryNodeId: 'DS-point-1-1', secondaryNodeIds: [] };
  const extraResult = freezeGoldManifest({ goldVersion: 'gold-truth-v1', goldSet: extra, snapshot });
  assert.equal(extraResult.ok, false);
  assert.ok(extraResult.errors.some((error) => error.includes('DS-g-99')));

  const missing = makeGoldSet(snapshot, frozen, { confirmedCount: 40 });
  delete missing.authoring['DS-g-01'];
  const missingResult = freezeGoldManifest({ goldVersion: 'gold-truth-v1', goldSet: missing, snapshot });
  assert.equal(missingResult.ok, false);

  const tampered = makeGoldSet(snapshot, frozen, { confirmedCount: 40 });
  tampered.frozen[0] = { ...tampered.frozen[0], split: 'HOLDOUT' };
  const tamperedResult = freezeGoldManifest({ goldVersion: 'gold-truth-v1', goldSet: tampered, snapshot });
  assert.equal(tamperedResult.ok, false);
});

test('TEST 1 — unchanged frozen sample (canonical Task 4 contract) validates on freeze', () => {
  const { snapshot, frozen } = buildSyntheticFixture();
  const goldSet = makeGoldSet(snapshot, frozen, { confirmedCount: 40 });
  const result = freezeGoldManifest({ goldVersion: 'gold-truth-v1', goldSet, snapshot });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.ok(result.manifest);
  assert.equal(result.manifest.entries.length, 40);
});

test('TEST 2 — split drift fails closed on frozen sample identity', () => {
  const { snapshot, frozen } = buildSyntheticFixture();
  const goldSet = makeGoldSet(snapshot, frozen, { confirmedCount: 40 });
  goldSet.frozen[0] = { ...goldSet.frozen[0], split: goldSet.frozen[0].split === 'DEV' ? 'HOLDOUT' : 'DEV' };
  const result = freezeGoldManifest({ goldVersion: 'gold-truth-v1', goldSet, snapshot });
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((error) => error.includes('frozen sample drifted') || error.includes('frozenManifestSha256')),
    `expected frozen identity/split drift, got ${result.errors.join('; ')}`,
  );
});

test('TEST 3 — fingerprint drift fails closed on frozen sample identity', () => {
  const { snapshot, frozen } = buildSyntheticFixture();
  const goldSet = makeGoldSet(snapshot, frozen, { confirmedCount: 40 });
  goldSet.frozen[0] = { ...goldSet.frozen[0], contentFingerprint: 'drifted-fingerprint' };
  const result = freezeGoldManifest({ goldVersion: 'gold-truth-v1', goldSet, snapshot });
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((error) => error.includes('frozen sample drifted') || error.includes('frozenManifestSha256')),
    `expected frozen fingerprint drift, got ${result.errors.join('; ')}`,
  );
});

test('TEST 4 — authoring truth changes never trigger frozen sample sha drift', () => {
  const { snapshot, frozen } = buildSyntheticFixture();
  const goldSet = makeGoldSet(snapshot, frozen, { confirmedCount: 40 });
  goldSet.authoring['DS-g-01'] = { status: 'confirmed', primaryNodeId: 'DS-point-1-2', secondaryNodeIds: ['DS-point-1-3'] };
  const result = freezeGoldManifest({ goldVersion: 'gold-truth-v1', goldSet, snapshot });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.ok(!result.errors.some((error) => error.includes('frozen sample drifted')));
});

test('synthetic full workflow: author, confirm, close, reopen, 40/40, freeze, validate', () => {
  const { snapshot, frozen } = buildSyntheticFixture();
  const dir = mkdtempSync(join(tmpdir(), 'gold-flow-'));
  const path = join(dir, 'gold-set-v1.json');

  let goldSet = createGoldSet({
    snapshotId: snapshot.snapshotId,
    frozen: frozen.entries,
    frozenManifestSha256: frozen.sha256,
  });
  assert.equal(Object.keys(goldSet.authoring).length, 40);
  for (const entry of Object.values(goldSet.authoring)) assert.equal(entry.status, 'unstarted');

  for (const frozenEntry of frozen.entries) {
    goldSet.authoring[frozenEntry.questionId] = {
      status: 'draft',
      primaryNodeId: `${frozenEntry.subject}-point-1-1`,
      secondaryNodeIds: [],
    };
  }
  saveGoldSet(path, goldSet);
  goldSet = loadGoldSet(path);
  for (const frozenEntry of frozen.entries) {
    goldSet.authoring[frozenEntry.questionId].status = 'confirmed';
  }
  saveGoldSet(path, goldSet);
  const reopened = loadGoldSet(path);

  const result = freezeGoldManifest({ goldVersion: 'gold-truth-v1', goldSet: reopened, snapshot });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.manifest.goldVersion, 'gold-truth-v1');
  assert.equal(result.manifest.snapshotId, snapshot.snapshotId);
  assert.match(result.manifest.sha256, /^[a-f0-9]{64}$/);
  const manifestValidation = validateGoldManifest(result.manifest, snapshot);
  assert.equal(manifestValidation.ok, true, JSON.stringify(manifestValidation.errors));
});

test('gold set version is stable and loadGoldSet refuses malformed files', () => {
  assert.equal(GOLD_SET_VERSION, 'gold-set-v1');
  const dir = mkdtempSync(join(tmpdir(), 'gold-bad-'));
  const path = join(dir, 'gold-set-v1.json');
  saveGoldSet(path, { goldVersion: 'gold-set-v1', snapshotId: 's', frozenManifestSha256: '0'.repeat(64), frozen: [], authoring: {} });
  assert.throws(() => loadGoldSet(path), /frozen|40/);
});
