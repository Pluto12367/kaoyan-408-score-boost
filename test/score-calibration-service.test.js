/**
 * V12-M5 — score calibration service.
 *
 * Pins the pairing contract: the prediction for each assessment is rebuilt only
 * from facts dated strictly BEFORE it, an assessment with no reconstructable
 * basis is excluded rather than treated as a perfect prediction, and the first
 * assessment declares that its baseline is an estimate rather than a real prior
 * score.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://stub:stub@127.0.0.1:5432/stub';
require('ts-node/register');

const { ScoreCalibrationService } = require('../apps/api/src/study/score-calibration.service.ts');

const DAY = 86_400_000;
const base = Date.now() - 60 * DAY;

function harness(options = {}) {
  const prisma = {
    user: { findUnique: async () => options.user ?? { targetScore: 120 } },
    assessmentHistoryItem: { findMany: async () => options.assessments ?? [] },
    practiceRecord: { findMany: async () => options.practice ?? [] },
    userMasterySnapshot: { findMany: async () => options.snapshots ?? [] },
  };
  return new ScoreCalibrationService(options.enabled === false ? undefined : prisma);
}

const assessment = (overrides = {}) => ({
  sessionId: 's1',
  submittedAt: new Date(base),
  score: 96,
  totalScore: 150,
  accuracyRate: 60,
  ...overrides,
});

const practice = (atMs, correct) => ({ submittedAt: new Date(atMs), correct });
const snapshot = (atMs, mastery) => ({ snapshotDate: new Date(atMs), mastery });

test('the calibration is honestly absent when the store is unavailable', async () => {
  const service = harness({ enabled: false });
  assert.equal(await service.getCalibration('u1'), null);
});

test('no recorded assessments yields an empty calibration, not a zero-error claim', async () => {
  const service = harness({ assessments: [] });
  const result = await service.getCalibration('u1');
  assert.ok(result);
  assert.equal(result.rows.length, 0);
  assert.equal(result.summary.meanAbsoluteError, null);
  assert.equal(result.authoritative, false);
  assert.match(result.basis, /没有已记录/);
});

test('builds a prediction from facts dated before the assessment and pairs it with the outcome', async () => {
  const service = harness({
    assessments: [assessment()],
    practice: [
      practice(base - 10 * DAY, true),
      practice(base - 9 * DAY, true),
      practice(base - 8 * DAY, false),
      practice(base - 7 * DAY, true),
    ],
    snapshots: [snapshot(base - 20 * DAY, 0.5)],
  });

  const result = await service.getCalibration('u1');
  assert.ok(result);
  assert.equal(result.rows.length, 1);
  const row = result.rows[0];
  assert.ok(row.predicted > 0, 'a prediction was reconstructed');
  assert.equal(row.actual, 96);
  assert.ok(row.evidence.sampleSize > 0);
  assert.match(row.evidence.basis, /正确率 75%/, 'only practice before the assessment counts');
  assert.match(row.evidence.basis, /首次测评/, 'the first baseline is declared as an estimate');
  assert.equal(result.disclaimer.length > 0, true);
});

test('practice recorded after the assessment must not leak into its prediction', async () => {
  const service = harness({
    assessments: [assessment()],
    practice: [
      practice(base - 5 * DAY, true),
      practice(base - 2 * DAY, true),
      // after the assessment — must be ignored
      practice(base + 1 * DAY, false),
      practice(base + 2 * DAY, false),
    ],
    snapshots: [snapshot(base - 3 * DAY, 0.5)],
  });

  const result = await service.getCalibration('u1');
  assert.ok(result);
  // Only the two pre-assessment attempts may count; had the post-assessment
  // wrong answers leaked in, this would read "4 次" with 50% accuracy.
  assert.match(result.rows[0].evidence.basis, /评估前 2 次已判分作答（正确率 100%）/);
});

test('an assessment with no prior evidence is excluded rather than given a zero-error pairing', async () => {
  const service = harness({
    assessments: [assessment()],
    practice: [],
    snapshots: [],
  });

  const result = await service.getCalibration('u1');
  assert.ok(result);
  assert.equal(result.rows.length, 0);
  assert.equal(result.summary.excludedCount, 1);
  assert.match(result.exclusions[0].reason, /预测|快照|证据/);
});

test('a later assessment uses the previous real score as its baseline', async () => {
  const service = harness({
    assessments: [
      assessment({ sessionId: 's1', submittedAt: new Date(base), score: 90 }),
      assessment({ sessionId: 's2', submittedAt: new Date(base + 20 * DAY), score: 105 }),
    ],
    practice: [practice(base - 5 * DAY, true), practice(base + 10 * DAY, true)],
    snapshots: [snapshot(base - 3 * DAY, 0.5), snapshot(base + 12 * DAY, 0.6)],
  });

  const result = await service.getCalibration('u1');
  assert.ok(result);
  assert.equal(result.rows.length, 2);
  assert.match(result.rows[1].evidence.basis, /上一次实测 90 分/);
  assert.ok(result.improvement.actualDelta != null, 'two paired assessments allow an improvement comparison');
});

test('the calibration never fabricates a score from mastery alone', () => {
  const raw = readFileSync(
    fileURLToPath(new URL('../apps/api/src/study/score-calibration.service.ts', import.meta.url)),
    'utf8',
  );
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const primitive of ['.create(', '.update(', '.upsert(', '.delete(', 'saveMastery']) {
    assert.ok(!code.includes(primitive), `the calibration must not contain ${primitive}`);
  }
  assert.ok(code.includes('estimatePredictedScore'), 'it must reuse the production estimator');
});
