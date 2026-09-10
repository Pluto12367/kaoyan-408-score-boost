/**
 * V12-M5 — Real score calibration (pure contract).
 *
 * EB-4: the estimated score was never compared with a recorded outcome.
 *
 * The mission's constraint is the whole design:
 *   prediction / evidence / actual outcome must stay THREE separate concepts.
 * So this module never merges them, and it refuses to report a calibration
 * figure when there is nothing to calibrate against — "no error" and "no data"
 * are different statements.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScoreCalibration,
  CALIBRATION_MIN_SAMPLE,
  PREDICTION_IS_NOT_ACTUAL,
} from '../packages/shared/dist/index.js';

function pair(overrides = {}) {
  return {
    sessionId: 's1',
    assessedAt: '2026-09-01T00:00:00.000Z',
    predictedBest: 100,
    predictedMin: 90,
    predictedMax: 110,
    actualScore: 96,
    totalScore: 150,
    evidenceSampleSize: 40,
    evidenceBasis: '评估前 40 次已判分作答与 12 个节点快照',
    ...overrides,
  };
}

test('the prediction-is-not-actual disclaimer is published, not buried in prose', () => {
  assert.ok(PREDICTION_IS_NOT_ACTUAL.length > 0);
  assert.match(PREDICTION_IS_NOT_ACTUAL, /预测|估算/);
  assert.match(PREDICTION_IS_NOT_ACTUAL, /真实|实际/);
});

test('a paired prediction and outcome yields a separated, itemised error', () => {
  const result = buildScoreCalibration([pair()]);

  const row = result.rows[0];
  assert.equal(row.predicted, 100);
  assert.equal(row.actual, 96);
  assert.equal(row.error, -4, 'error = actual - predicted, and the sign is meaningful');
  assert.equal(row.direction, 'actual_below_prediction');
  assert.equal(row.withinRange, true, '96 falls inside the stated 90-110 range');
  assert.ok(row.evidence.basis.length > 0, 'the evidence behind the prediction is kept');
  assert.ok(row.basis.length > 0);
  assert.equal(result.authoritative, false);
  assert.equal(result.disclaimer, PREDICTION_IS_NOT_ACTUAL);
});

test('an outcome outside the predicted range is flagged rather than excused', () => {
  const result = buildScoreCalibration([pair({ actualScore: 130 })]);
  assert.equal(result.rows[0].withinRange, false);
  assert.equal(result.rows[0].direction, 'actual_above_prediction');
  assert.equal(result.rows[0].error, 30);
});

test('below the sample floor no calibration claim is made', () => {
  const rows = Array.from({ length: CALIBRATION_MIN_SAMPLE - 1 }, (_, index) =>
    pair({ sessionId: `s${index}` }),
  );
  const result = buildScoreCalibration(rows);

  assert.equal(result.summary.confidence, 'insufficient_data');
  assert.equal(result.summary.meanAbsoluteError, null, 'a mean over too few pairs is not a calibration');
  assert.equal(result.summary.bias, null);
  assert.match(result.summary.basis, /样本|不足/);
});

test('at the sample floor the calibration reports MAE and signed bias separately', () => {
  // One-sided: every actual is 10 above the prediction.
  const oneSided = Array.from({ length: CALIBRATION_MIN_SAMPLE }, (_, index) =>
    pair({ sessionId: `s${index}`, predictedBest: 100, actualScore: 110 }),
  );
  const result = buildScoreCalibration(oneSided);

  assert.equal(result.summary.confidence, 'sufficient');
  assert.equal(result.summary.meanAbsoluteError, 10);
  assert.equal(result.summary.bias, 10);
  assert.equal(
    result.summary.meanAbsoluteError,
    Math.abs(result.summary.bias ?? 0),
    'a fully one-sided error makes MAE and |bias| equal',
  );
  assert.ok(result.summary.withinRangeRate != null);
});

test('MAE is never below |bias|, and exceeds it when errors point both ways', () => {
  const mixed = [
    pair({ sessionId: 's1', predictedBest: 100, actualScore: 90 }),
    pair({ sessionId: 's2', predictedBest: 100, actualScore: 90 }),
    pair({ sessionId: 's3', predictedBest: 100, actualScore: 110 }),
    pair({ sessionId: 's4', predictedBest: 100, actualScore: 110 }),
    pair({ sessionId: 's5', predictedBest: 100, actualScore: 100 }),
  ];
  const result = buildScoreCalibration(mixed);

  const mae = result.summary.meanAbsoluteError ?? 0;
  const bias = result.summary.bias ?? 0;
  assert.equal(mae, 8, '(10+10+10+10+0)/5');
  assert.equal(bias, 0, 'the two directions cancel');
  assert.ok(mae >= Math.abs(bias), 'MAE is a lower bound on |bias| by construction');
  assert.ok(result.summary.withinRangeRate != null);
});

test('an assessment with no reconstructed prediction is excluded, never calibrated as zero error', () => {
  const result = buildScoreCalibration([
    pair(),
    pair({ sessionId: 's2', predictedBest: null, predictedMin: null, predictedMax: null }),
  ]);

  assert.equal(result.rows.filter((row) => row.error != null).length, 1);
  const skipped = result.exclusions.find((item) => item.sessionId === 's2');
  assert.ok(skipped, 'the unpaired assessment must be listed');
  assert.match(skipped.reason, /预测|快照|证据/);
  assert.equal(result.summary.excludedCount, 1);
});

test('an outcome with no recorded score is excluded too', () => {
  const result = buildScoreCalibration([pair({ actualScore: null })]);

  assert.equal(result.rows.filter((row) => row.error != null).length, 0);
  assert.match(result.exclusions[0].reason, /成绩|分数/);
});

test('no assessments at all yields an honest empty calibration', () => {
  const result = buildScoreCalibration([]);

  assert.equal(result.rows.length, 0);
  assert.equal(result.summary.pairedCount, 0);
  assert.equal(result.summary.meanAbsoluteError, null);
  assert.equal(result.summary.confidence, 'insufficient_data');
  assert.match(result.summary.basis, /没有|无/);
});

test('predicted improvement and actual improvement are compared as separate series', () => {
  const result = buildScoreCalibration([
    pair({ sessionId: 'a', assessedAt: '2026-08-01T00:00:00.000Z', predictedBest: 90, actualScore: 88 }),
    pair({ sessionId: 'b', assessedAt: '2026-09-01T00:00:00.000Z', predictedBest: 105, actualScore: 99 }),
  ]);

  assert.equal(result.improvement.predictedDelta, 15);
  assert.equal(result.improvement.actualDelta, 11);
  assert.equal(result.improvement.gap, -4, 'predicted improvement outran the measured one');
  assert.ok(result.improvement.basis.length > 0);
});

test('a single assessment cannot produce an improvement comparison', () => {
  const result = buildScoreCalibration([pair()]);
  assert.equal(result.improvement.predictedDelta, null);
  assert.equal(result.improvement.actualDelta, null);
  assert.equal(result.improvement.gap, null);
  assert.match(result.improvement.basis, /至少|不足/);
});

test('mastery is never converted into a score claim', () => {
  const result = buildScoreCalibration([pair()]);
  const source = buildScoreCalibration.toString();
  assert.ok(!source.includes('mastery'), 'the calibration must not derive scores from mastery');
  assert.ok(result.summary.basis.length > 0);
});

test('the calibration is deterministic', () => {
  const a = buildScoreCalibration([pair()]);
  const b = buildScoreCalibration([pair()]);
  assert.equal(a.summary.meanAbsoluteError, b.summary.meanAbsoluteError);
  assert.deepEqual(a.rows.map((row) => row.error), b.rows.map((row) => row.error));
});
