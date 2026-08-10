import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildGoldManifest } from '../core/sample.js';
import { buildV2R2SampleManifest } from '../core/sampleV2.js';
import { selectV2FortyEntries } from '../core/sampleV2Forty.js';
import { createGoldSetV2 } from '../core/gold.js';
import { prepareV2FortyArtifacts } from '../scripts/prepare-v2-40.mjs';

const SUBJECTS = ['DS', 'CO', 'OS', 'CN'];
const MATRIX = [
  { BASIC: 3, MEDIUM: 3, HARD: 1 },
  { BASIC: 2, MEDIUM: 3, HARD: 1 },
  { BASIC: 2, MEDIUM: 2, HARD: 2 },
  { BASIC: 3, MEDIUM: 2, HARD: 1 },
];

function buildFixture() {
  const entries = [];
  for (const subject of SUBJECTS) {
    for (let kpIndex = 0; kpIndex < 4; kpIndex += 1) {
      const kpId = `${subject.toLowerCase()}-kp-${kpIndex}`;
      for (const difficulty of ['BASIC', 'MEDIUM', 'HARD']) {
        for (let index = 0; index < MATRIX[kpIndex][difficulty]; index += 1) {
          const questionId = `${subject}-${kpIndex}-${difficulty}-${index}`;
          entries.push({
            questionId,
            contentFingerprint: `fp-${questionId}`,
            subject,
            difficulty,
            source: 'synthetic',
            year: 2026,
            knowledgePointIds: [kpId],
          });
        }
      }
    }
  }
  const parentSample = buildV2R2SampleManifest({
    snapshotId: 'snap-prepare-v2-40',
    contentSha256: '3'.repeat(64),
    entries,
  });
  const snapshot = {
    snapshotId: parentSample.snapshotId,
    questions: entries.map((entry) => ({
      id: entry.questionId,
      subject: entry.subject,
      contentFingerprint: entry.contentFingerprint,
      isCurrent: true,
    })),
    nodes: SUBJECTS.map((subject) => ({
      id: `${subject}-atomic`,
      subject,
      nodeType: 'atomicPoint',
      isActive: true,
    })),
  };
  const sourceFrozen = [];
  for (const subject of SUBJECTS) {
    entries.filter((entry) => entry.subject === subject)
      .sort((left, right) => left.questionId.localeCompare(right.questionId))
      .forEach((entry, index) => sourceFrozen.push({
        questionId: entry.questionId,
        contentFingerprint: entry.contentFingerprint,
        subject,
        split: index < 18 ? 'DEV' : 'HOLDOUT',
      }));
  }
  const sourceFrozenManifest = buildGoldManifest({
    goldVersion: 'gold-sample-v2r2',
    snapshotId: snapshot.snapshotId,
    entries: sourceFrozen.map((entry) => ({
      questionId: entry.questionId,
      contentFingerprint: entry.contentFingerprint,
      primaryNodeId: null,
      secondaryNodeIds: [],
      split: entry.split,
    })),
  });
  const sourceGoldSet = createGoldSetV2({
    snapshotId: snapshot.snapshotId,
    frozen: sourceFrozen,
    frozenManifestSha256: sourceFrozenManifest.sha256,
  });
  const selected = selectV2FortyEntries(parentSample);
  for (const subject of SUBJECTS) {
    for (const entry of selected.filter((candidate) => candidate.subject === subject).slice(0, 3)) {
      sourceGoldSet.authoring[entry.questionId] = {
        status: 'confirmed',
        primaryNodeId: `${subject}-atomic`,
        secondaryNodeIds: [],
      };
    }
  }
  return { parentSample, sourceGoldSet, snapshot };
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

test('V2-40 preparation creates three isolated artifacts, migrates confirmed labels and is idempotent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prepare-v2-40-'));
  const fixture = buildFixture();
  const parentSamplePath = join(dir, 'gold-sample-v2r2.json');
  const sourceGoldSetPath = join(dir, 'gold-set-v2.json');
  const snapshotPath = join(dir, 'snapshot.json');
  writeJson(parentSamplePath, fixture.parentSample);
  writeJson(sourceGoldSetPath, fixture.sourceGoldSet);
  writeJson(snapshotPath, fixture.snapshot);
  const sourceBefore = readFileSync(sourceGoldSetPath, 'utf8');
  const lines = [];
  const options = {
    parentSamplePath,
    sourceGoldSetPath,
    snapshotPath,
    outputDir: dir,
    acceptedParentSha256: fixture.parentSample.sha256,
    logger: (line) => lines.push(line),
  };

  const first = prepareV2FortyArtifacts(options);
  assert.equal(first.total, 40);
  assert.equal(first.dev, 32);
  assert.equal(first.holdout, 8);
  assert.equal(first.confirmed, 12);
  assert.equal(first.draft, 0);
  assert.equal(first.unstarted, 28);
  assert.equal('holdoutIds' in first, false);
  assert.equal(existsSync(join(dir, 'gold-sample-v2r2-40.json')), true);
  assert.equal(existsSync(join(dir, 'gold-split-v2r2-40.json')), true);
  assert.equal(existsSync(join(dir, 'gold-set-v2r2-40.json')), true);
  assert.equal(existsSync(join(dir, 'gold-truth-manifest-v2r2-40.json')), false);
  assert.equal(readFileSync(sourceGoldSetPath, 'utf8'), sourceBefore);
  const output = lines.join('\n');
  assert.match(output, /confirmed=12/);
  const persistedSplit = JSON.parse(readFileSync(join(dir, 'gold-split-v2r2-40.json'), 'utf8'));
  for (const holdoutId of persistedSplit.split.holdout) assert.doesNotMatch(output, new RegExp(holdoutId));

  const targetBefore = readFileSync(join(dir, 'gold-set-v2r2-40.json'), 'utf8');
  const second = prepareV2FortyArtifacts(options);
  assert.equal(second.goldSetSha256, first.goldSetSha256);
  assert.equal(readFileSync(join(dir, 'gold-set-v2r2-40.json'), 'utf8'), targetBefore);
});

test('V2-40 preparation fails closed instead of overwriting a drifted existing artifact', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prepare-v2-40-drift-'));
  const fixture = buildFixture();
  const parentSamplePath = join(dir, 'gold-sample-v2r2.json');
  const sourceGoldSetPath = join(dir, 'gold-set-v2.json');
  const snapshotPath = join(dir, 'snapshot.json');
  writeJson(parentSamplePath, fixture.parentSample);
  writeJson(sourceGoldSetPath, fixture.sourceGoldSet);
  writeJson(snapshotPath, fixture.snapshot);
  const options = {
    parentSamplePath,
    sourceGoldSetPath,
    snapshotPath,
    outputDir: dir,
    acceptedParentSha256: fixture.parentSample.sha256,
    logger: () => {},
  };
  prepareV2FortyArtifacts(options);
  const samplePath = join(dir, 'gold-sample-v2r2-40.json');
  writeFileSync(samplePath, '{"drifted":true}\n', 'utf8');
  assert.throws(() => prepareV2FortyArtifacts(options), /existing V2-40 sample drift/);
  assert.equal(readFileSync(samplePath, 'utf8'), '{"drifted":true}\n');
});
