/**
 * V12-M4 — Score Opportunity shadow (pure contract).
 * S1-I0 (P0-5 / P0-6 / INV-6 / INV-7 / INV-15) — factor partition + PROXY labelling.
 *
 * Mission rule: "公式不是事实。必须验证每个变量是否有真实数据支撑."
 *
 * So the model is not judged by whether its ranking looks sensible, but by
 * whether every factor names the real table/field behind it, whether each
 * underlying fact is counted in exactly ONE factor, whether a factor with no
 * data is EXCLUDED and stated rather than quietly set to 0 or replaced by a
 * plausible-looking guess, and whether an uncalibrated estimate is labelled as
 * a proxy instead of being presented as a score gain.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScoreOpportunity,
  SCORE_OPPORTUNITY_WEIGHTS,
  SCORE_OPPORTUNITY_FACTORS,
  REQUIRED_OPPORTUNITY_FACTORS,
  EVIDENCE_GATED_FACTOR,
  evidenceGatePasses,
} from '../packages/shared/dist/index.js';

const full = {
  nodeId: 'node-1',
  title: '线性表的顺序存储',
  learnerWeakness: 0.72,
  scoreAtStake: 0.61,
  recent3Frequency: 1,
  evidenceConfidence: 'HIGH',
  daysToExam: 40,
  everSucceeded: true,
  prerequisiteReadiness: 0.8,
  trainingCostMinutes: 45,
};

test('every declared factor names a real data source', () => {
  for (const factor of SCORE_OPPORTUNITY_FACTORS) {
    assert.ok(factor.source.length > 0, `${factor.key} must name its source table/field`);
    assert.ok(factor.basis.length > 0, `${factor.key} must explain itself`);
    assert.ok(['high', 'medium', 'low'].includes(factor.maxConfidence));
  }
});

test('the formula is published, not hidden', () => {
  const total = SCORE_OPPORTUNITY_FACTORS
    .reduce((sum, factor) => sum + SCORE_OPPORTUNITY_WEIGHTS[factor.key], 0);
  assert.ok(Math.abs(total - 1) < 1e-9, 'weights must be a normalised, inspectable formula');
});

// ---------------------------------------------------------------------------
// P0-6 / INV-6 — the factor partition
// ---------------------------------------------------------------------------

test('P0-6/INV-6: the factor catalogue is the partitioned five, with no duplicated fact', () => {
  const keys = SCORE_OPPORTUNITY_FACTORS.map((factor) => factor.key).sort();
  assert.deepEqual(
    keys,
    ['learnerWeakness', 'recovery', 'scoreAtStake', 'trainingCost', 'urgency'],
    'each factor carries exactly one semantic',
  );
  // `importance` was removed for collinearity with frequency, and
  // `evidenceConfidence` is a gate rather than a weighted value.
  assert.ok(!keys.includes('importance'), 'importance must not be an opportunity factor');
  assert.ok(!keys.includes('evidenceConfidence'), 'confidence must not be a weighted factor');
  assert.ok(!keys.includes('recoverability'), 'recoverability was renamed to recovery');
});

test('P0-6/INV-6: no underlying fact contributes to two factors', () => {
  // `retention` used to enter `urgency` while the engine already modelled
  // forgetting — the same fact counted twice. Urgency is now time-only.
  const far = buildScoreOpportunity({ ...full, daysToExam: 200, prevRetention: 0.1 });
  const near = buildScoreOpportunity({ ...full, daysToExam: 20, prevRetention: 0.9 });
  const urgencyOf = (row) => row.factors.find((factor) => factor.key === 'urgency').value;
  assert.ok(urgencyOf(near) > urgencyOf(far), 'urgency tracks time pressure only');
  assert.equal(
    urgencyOf(near),
    urgencyOf(buildScoreOpportunity({ ...full, daysToExam: 20 })),
    'urgency must not move with retention: that fact belongs to the engine alone',
  );
});

test('P0-6: evidence confidence is a GATE on scoreAtStake, not a weighted contributor', () => {
  assert.equal(evidenceGatePasses('HIGH'), true);
  assert.equal(evidenceGatePasses('MEDIUM'), true);
  assert.equal(evidenceGatePasses('LOW'), false);
  assert.equal(evidenceGatePasses(null), false);
  assert.equal(EVIDENCE_GATED_FACTOR, 'scoreAtStake');

  // A LOW-confidence snapshot must not produce a confident-looking number: the
  // gated factor becomes unmeasurable, which (being required) blocks the score.
  const low = buildScoreOpportunity({ ...full, evidenceConfidence: 'LOW' });
  assert.equal(low.score, null, 'an unconfident fact must not yield a number');
  assert.equal(low.evidenceGatePassed, false);
  const gated = low.factors.find((factor) => factor.key === 'scoreAtStake');
  assert.equal(gated.value, null);
  assert.equal(gated.confidence, 'none');

  // ...and the gate is not a silent zero: the exclusion/blocker is stated.
  assert.ok(low.blockedBy.includes('scoreAtStake'));
});

test('a fully measured point produces a score with every factor itemised', () => {
  const row = buildScoreOpportunity(full);

  assert.ok(row.score != null && row.score > 0);
  assert.equal(row.authoritative, false, 'shadow output is never authoritative');
  assert.equal(row.factors.length, SCORE_OPPORTUNITY_FACTORS.length, 'every factor is reported');
  for (const factor of row.factors) {
    assert.ok(factor.basis.length > 0, `${factor.key} must explain itself`);
    assert.ok(factor.source.length > 0, `${factor.key} must cite its source`);
    assert.equal(factor.value != null, true, `${factor.key} should be measurable here`);
  }
  assert.equal(row.exclusions.length, 0);
});

test('recovery is declared as a proxy, never presented as a measurement', () => {
  const row = buildScoreOpportunity(full);
  const recovery = row.factors.find((factor) => factor.key === 'recovery');
  assert.ok(recovery);
  assert.equal(
    recovery.confidence,
    'low',
    'there is no direct measurement of recoverability in this system',
  );
  assert.match(recovery.basis, /代理|近似/);
});

test('training cost is labelled estimated, not measured', () => {
  const row = buildScoreOpportunity(full);
  const cost = row.factors.find((factor) => factor.key === 'trainingCost');
  assert.ok(cost);
  assert.match(cost.basis, /估算|估计/);
  assert.notEqual(cost.confidence, 'high');
});

test('a missing required factor yields no score at all, with the blocker named', () => {
  const row = buildScoreOpportunity({ ...full, trainingCostMinutes: null });

  assert.equal(row.score, null, 'an unmeasurable cost must not be guessed at');
  assert.match(row.basis, /训练成本|trainingCost/);
  assert.ok(row.blockedBy.includes('trainingCost'));
});

test('a missing optional factor is excluded and stated, and the score is downgraded', () => {
  const row = buildScoreOpportunity({ ...full, prerequisiteReadiness: null, everSucceeded: null });

  assert.ok(row.score != null, 'optional gaps must not block an otherwise measurable point');
  const excluded = row.exclusions.map((item) => item.key);
  assert.ok(excluded.includes('recovery'));
  const recovery = row.factors.find((factor) => factor.key === 'recovery');
  assert.equal(recovery.value, null);
  assert.equal(recovery.confidence, 'none');
  assert.notEqual(row.confidence, 'high', 'losing a factor must lower stated confidence');
  assert.match(row.basis, /排除|未纳入/);
});

test('absent exam-frequency evidence is excluded rather than treated as zero importance', () => {
  const row = buildScoreOpportunity({ ...full, scoreAtStake: null });

  assert.equal(row.score, null);
  assert.ok(row.blockedBy.includes('scoreAtStake'));
  assert.match(row.basis, /scoreAtStake/);
});

test('a point the student never attempted is not credited with recoverability', () => {
  const row = buildScoreOpportunity({ ...full, everSucceeded: false });
  const recovery = row.factors.find((factor) => factor.key === 'recovery');
  assert.ok(recovery.value != null);
  assert.ok(recovery.value < 0.5, 'never succeeding is weak recoverability evidence');
});

test('urgency rises as the exam approaches, all else equal', () => {
  const far = buildScoreOpportunity({ ...full, daysToExam: 200 });
  const near = buildScoreOpportunity({ ...full, daysToExam: 20 });
  const urgencyOf = (row) => row.factors.find((factor) => factor.key === 'urgency').value;
  assert.ok(urgencyOf(near) > urgencyOf(far));
});

test('INV-10: an unknown exam timeline leaves urgency unmeasured, never zero-pressure', () => {
  const row = buildScoreOpportunity({ ...full, daysToExam: null });
  const urgency = row.factors.find((factor) => factor.key === 'urgency');
  assert.equal(urgency.value, null, 'unknown days must not read as "far away" or as 0');
  const excluded = row.exclusions.map((item) => item.key);
  assert.ok(excluded.includes('urgency'));
});

test('INV-10: a zero primary score is a real observation and stays 0, not unknown', () => {
  const row = buildScoreOpportunity({ ...full, scoreAtStake: 0, recent3Frequency: 0 });
  const stake = row.factors.find((factor) => factor.key === 'scoreAtStake');
  assert.equal(stake.value, 0, 'a stored 0 is observed evidence, not missing data');
  assert.notEqual(stake.confidence, 'none');
});

test('the reason line explains the top contributors in words', () => {
  const row = buildScoreOpportunity(full);
  assert.ok(row.reason.length > 0);
  assert.match(row.reason, /缺口|分值|紧迫|恢复|成本/);
});

// ---------------------------------------------------------------------------
// P0-5 / INV-7 / INV-15 — expectedBenefit is a PROXY, never a score gain
// ---------------------------------------------------------------------------

test('P0-5/INV-15: expectedBenefit is a PROXY and explicitly uncalibrated', () => {
  const row = buildScoreOpportunity(full);
  assert.ok(row.expectedBenefit.length > 0);
  assert.equal(row.expectedBenefitIsEstimate, true);
  assert.equal(row.expectedBenefitKind, 'PROXY', 'an uncalibrated band is not DERIVED or OBSERVED');
  assert.equal(row.expectedBenefitCalibrated, false, 'never compared to a real score');
});

test('P0-5/INV-15: the benefit wording never claims a score gain', () => {
  const row = buildScoreOpportunity(full);
  // "提分" / "gain" may appear ONLY with an explicit negation or qualifier.
  assert.doesNotMatch(row.expectedBenefit, /预计能提高|估算提分区间/);
  assert.match(row.expectedBenefit, /未标定|非分数增益|不得表述/);
  assert.match(row.expectedBenefit, /calibrated=false/);
});

test('P0-5: the unmeasurable branch also carries the PROXY label', () => {
  const row = buildScoreOpportunity({ ...full, trainingCostMinutes: null });
  assert.equal(row.score, null);
  assert.equal(row.expectedBenefitKind, 'PROXY');
  assert.equal(row.expectedBenefitCalibrated, false);
});

test('risk is stated explicitly for every point', () => {
  const row = buildScoreOpportunity(full);
  assert.ok(row.risk.length > 0);
});

test('equal inputs produce equal scores (deterministic, no hidden state)', () => {
  const a = buildScoreOpportunity(full);
  const b = buildScoreOpportunity({ ...full });
  assert.equal(a.score, b.score);
});
