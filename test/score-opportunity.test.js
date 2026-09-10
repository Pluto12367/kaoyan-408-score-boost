/**
 * V12-M4 — Score Opportunity shadow (pure contract).
 *
 * Mission rule: "公式不是事实。必须验证每个变量是否有真实数据支撑."
 *
 * So the model is not judged by whether its ranking looks sensible, but by
 * whether every factor names the real table/field behind it, and whether a
 * factor with no data is EXCLUDED and stated rather than quietly set to 0 or
 * replaced by a plausible-looking guess. A score that cannot be explained must
 * not be produced at all.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildScoreOpportunity,
  SCORE_OPPORTUNITY_WEIGHTS,
  SCORE_OPPORTUNITY_FACTORS,
  REQUIRED_OPPORTUNITY_FACTORS,
} from '../packages/shared/dist/index.js';

const full = {
  nodeId: 'node-1',
  title: '线性表的顺序存储',
  weakness: 0.72,
  examImportance: 0.61,
  evidenceConfidence: 'HIGH',
  daysToExam: 40,
  retentionNow: 0.42,
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
  const total = REQUIRED_OPPORTUNITY_FACTORS
    .concat(['recoverability', 'evidenceConfidence', 'urgency'])
    .reduce((sum, key) => sum + SCORE_OPPORTUNITY_WEIGHTS[key], 0);
  assert.ok(Math.abs(total - 1) < 1e-9, 'weights must be a normalised, inspectable formula');
});

test('a fully measured point produces a score with every factor itemised', () => {
  const row = buildScoreOpportunity(full);

  assert.ok(row.score != null && row.score > 0);
  assert.equal(row.authoritative, false, 'shadow output is never authoritative');
  assert.equal(row.factors.length, 6, 'all six factors are reported');
  for (const factor of row.factors) {
    assert.ok(factor.basis.length > 0, `${factor.key} must explain itself`);
    assert.ok(factor.source.length > 0, `${factor.key} must cite its source`);
    assert.equal(factor.value != null, true, `${factor.key} should be measurable here`);
  }
  assert.equal(row.exclusions.length, 0);
});

test('recoverability is declared as a proxy, never presented as a measurement', () => {
  const row = buildScoreOpportunity(full);
  const recoverability = row.factors.find((factor) => factor.key === 'recoverability');
  assert.ok(recoverability);
  assert.equal(
    recoverability.confidence,
    'low',
    'there is no direct measurement of recoverability in this system',
  );
  assert.match(recoverability.basis, /代理|近似/);
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
  assert.ok(excluded.includes('recoverability'));
  const recoverability = row.factors.find((factor) => factor.key === 'recoverability');
  assert.equal(recoverability.value, null);
  assert.equal(recoverability.confidence, 'none');
  assert.notEqual(row.confidence, 'high', 'losing a factor must lower stated confidence');
  assert.match(row.basis, /排除|未纳入/);
});

test('absent exam-frequency evidence is excluded rather than treated as zero importance', () => {
  const row = buildScoreOpportunity({ ...full, examImportance: null });

  assert.equal(row.score, null);
  assert.ok(row.blockedBy.includes('examImportance'));
  assert.match(row.basis, /考频|examImportance/);
});

test('a point the student never attempted is not credited with recoverability', () => {
  const row = buildScoreOpportunity({ ...full, everSucceeded: false });
  const recoverability = row.factors.find((factor) => factor.key === 'recoverability');
  assert.ok(recoverability.value != null);
  assert.ok(recoverability.value < 0.5, 'never succeeding is weak recoverability evidence');
});

test('urgency rises as the exam approaches, all else equal', () => {
  const far = buildScoreOpportunity({ ...full, daysToExam: 200 });
  const near = buildScoreOpportunity({ ...full, daysToExam: 20 });
  const urgencyOf = (row) => row.factors.find((factor) => factor.key === 'urgency').value;
  assert.ok(urgencyOf(near) > urgencyOf(far));
});

test('the reason line explains the top contributors in words', () => {
  const row = buildScoreOpportunity(full);
  assert.ok(row.reason.length > 0);
  assert.match(row.reason, /薄弱|考频|紧迫|恢复|成本/);
});

test('expected benefit is a range with a stated basis, never a single confident number', () => {
  const row = buildScoreOpportunity(full);
  assert.ok(row.expectedBenefit.length > 0);
  assert.equal(row.expectedBenefitIsEstimate, true);
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
