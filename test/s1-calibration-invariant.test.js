import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// S1-I0 / P0-1 — calibration semantic hardening (INV-1, INV-2, T-1).
//
// The defect: the shared `buildScoreCalibration` legacy branch guarded only
// `totalScore != null && totalScore !== 150`, so a pair with `totalScore == null`
// fell through and computed `actualScore - predictedBest`. The audit reproduced
// the exact historical absurdity that way: actualScore=96, totalScore=null,
// predictedBest=26 → error=70, a number that means nothing.
//
// The rule now: an error may only be produced when the evidence's 150-scale
// equivalence is PROVEN. Unproven scale is excluded, never coerced, and never
// rendered as 0.

const SHARED = new URL('../packages/shared/dist/index.js', import.meta.url);
const { buildScoreCalibration } = await import(SHARED.href);

const API_SERVICE = new URL('../apps/api/src/score-anchor/score-anchor.service.ts', import.meta.url);
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function pair(overrides = {}) {
  return {
    sessionId: 's-1',
    assessedAt: '2026-09-01T00:00:00.000Z',
    predictedBest: 26,
    predictedMin: 20,
    predictedMax: 32,
    predictedAt: '2026-08-30T00:00:00.000Z',
    actualScore: 96,
    totalScore: null,
    evidenceSampleSize: 6,
    evidenceBasis: 'test',
    ...overrides,
  };
}

// ------------------------------------------------------- T-1 the named case

test('P0-1/T-1: actualScore=96, totalScore=null, predictedBest=26 is excluded, not 70', () => {
  const result = buildScoreCalibration([pair()]);
  assert.equal(result.rows.length, 0, 'an unproven scale must not produce a calibration row');
  assert.equal(result.exclusions.length, 1);
  assert.equal(result.exclusions[0].sessionId, 's-1');
  assert.ok(
    !result.rows.some((row) => row.error === 70),
    'the meaningless error=70 must be unreachable',
  );
  // null is not 0: below the sample floor the summary stays absent.
  assert.equal(result.summary.meanAbsoluteError, null);
  assert.equal(result.summary.bias, null);
  assert.equal(result.summary.confidence, 'insufficient_data');
});

test('P0-1: an explicit non-150 total scale is excluded (150 vs 100 mismatch)', () => {
  const result = buildScoreCalibration([pair({ totalScore: 100 })]);
  assert.equal(result.rows.length, 0);
  assert.equal(result.exclusions.length, 1);
  assert.match(result.exclusions[0].reason, /量纲|scale/);
});

test('P0-1: a proven 150 total scale still produces a legitimate error', () => {
  const result = buildScoreCalibration([pair({ totalScore: 150 })]);
  assert.equal(result.rows.length, 1, '96 vs 26 on the same scale is a legal comparison');
  assert.equal(result.rows[0].error, 70);
  assert.equal(result.rows[0].scalePair, '150/150');
});

// ------------------------------------------------- strict path was tautological

test('P0-1: the strict path must prove the scale instead of assuming 150', () => {
  const unproven = buildScoreCalibration([pair({ actualNormalizedScore: 96, actualSource: 'TEACHER_GRADED' })]);
  assert.equal(unproven.rows.length, 0, 'a normalized value without its scale is unproven');
  assert.equal(unproven.exclusions.length, 1);

  const proven = buildScoreCalibration([pair({
    actualNormalizedScore: 96,
    actualNormalizedScale: 150,
    actualSemantic: 'exam_total',
    actualSource: 'TEACHER_GRADED',
  })]);
  assert.equal(proven.rows.length, 1);
  assert.equal(proven.rows[0].error, 70);
  assert.equal(proven.rows[0].scalePair, '150/150');

  const wrongScale = buildScoreCalibration([pair({
    actualNormalizedScore: 96,
    actualNormalizedScale: 100,
    actualSemantic: 'exam_total',
    actualSource: 'TEACHER_GRADED',
  })]);
  assert.equal(wrongScale.rows.length, 0, 'a proven but different scale is a mismatch');
});

test('P0-1: an accuracy-rate semantic never pairs with an exam-total prediction', () => {
  const strict = buildScoreCalibration([pair({
    actualNormalizedScore: 96,
    actualNormalizedScale: 150,
    actualSemantic: 'accuracy_rate',
    actualSource: 'MOCK',
  })]);
  assert.equal(strict.rows.length, 0, 'accuracy_rate is structurally barred on the strict path');

  const legacy = buildScoreCalibration([pair({ totalScore: 150, actualSemantic: 'accuracy_rate' })]);
  assert.equal(legacy.rows.length, 0, 'and on the legacy path too');
});

test('P0-1: an unknown provenance never calibrates', () => {
  const result = buildScoreCalibration([pair({
    actualNormalizedScore: 96,
    actualNormalizedScale: 150,
    actualSemantic: 'exam_total',
    actualSource: 'UNKNOWN',
  })]);
  assert.equal(result.rows.length, 0);
  assert.equal(result.rows.length, 0);
  assert.match(result.exclusions[0].reason, /provenance|来源/i);
});

test('P0-1: a prediction that postdates the evidence never calibrates', () => {
  const result = buildScoreCalibration([pair({
    totalScore: 150,
    predictedAt: '2026-09-02T00:00:00.000Z',
    assessedAt: '2026-09-01T00:00:00.000Z',
  })]);
  assert.equal(result.rows.length, 0);
});

// ------------------------------------------------------- null is never zero

test('P0-1: no exclusion path fabricates a zero-valued row', () => {
  const cases = [
    pair(),
    pair({ totalScore: 100 }),
    pair({ actualNormalizedScore: 96 }),
    pair({ actualScore: null, totalScore: 150 }),
  ];
  for (const input of cases) {
    const result = buildScoreCalibration([input]);
    for (const row of result.rows) {
      assert.notEqual(row.error, 0, 'an excluded/invalid pair must never become a zero-error row');
    }
  }
  const mixed = buildScoreCalibration(cases);
  assert.equal(mixed.rows.length, 0);
  assert.equal(mixed.summary.meanAbsoluteError, null);
});

// ------------------------------------------- source level: the constant is gone

test('P0-1/INV-2: the observation builder reads the row scale, not a constant', async () => {
  const source = stripComments(readFileSync(API_SERVICE, 'utf8'));
  const index = source.indexOf('const evidenceRef = {');
  assert.ok(index > 0, 'the evidenceRef construction must exist');
  const block = source.slice(index, index + 400);
  assert.doesNotMatch(
    block,
    /normalizedTotalScale:\s*SCORE_NORMALIZED_TOTAL_SCALE/,
    'hardcoding the scale makes the compatibility check tautological',
  );
  assert.match(block, /normalizedTotalScale:\s*evidence\.normalizedTotalScale/);
  assert.match(block, /semantic:\s*evidence\.semantic/, 'the stored semantic must be used, not assumed');
});
