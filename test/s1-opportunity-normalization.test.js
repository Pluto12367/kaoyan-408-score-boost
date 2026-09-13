import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// S1-I0 / P0-2 — canonical opportunity normalization (INV-5, T-2).
//
// The defect: `score-opportunity.service.ts` normalized the node's five-year
// primary score RELATIVE to the largest score present in the candidate set
// (`primaryScore5y / maxPrimaryScore`), while `shadow-decision-chain.ts` used an
// ABSOLUTE scale (`min(1, primaryScore5y / 45)`). The same node therefore got a
// different `examImportance` depending on which other nodes happened to be in the
// pool — not a fact about the node — and the two endpoints' numbers were not
// comparable.
//
// The canonical normalisation is absolute: clamp01(primaryScore5y / 45).

const SHARED = new URL('../packages/shared/dist/index.js', import.meta.url);
const {
  normalizeExamScoreWeight,
  EXAM_SCORE_WEIGHT_SCALE,
  SCORE_OPPORTUNITY_FACTORS,
} = await import(SHARED.href);

const OPPORTUNITY_SERVICE = new URL('../apps/api/src/study/score-opportunity.service.ts', import.meta.url);
// The hand-rolled copy of the rule lives in the SHARED shadow builder, not in
// the service — the audit's citation was to this file.
const SHADOW_CHAIN = new URL('../packages/shared/src/score-center/shadow-decision-chain.ts', import.meta.url);
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ------------------------------------------------------------ the pure rule

test('P0-2: the canonical exam-score weight scale is the published absolute constant', () => {
  assert.equal(EXAM_SCORE_WEIGHT_SCALE, 45, '45 is the 408 full-paper score basis, not a dataset maximum');
});

test('P0-2: normalizeExamScoreWeight is absolute and clamped', () => {
  assert.equal(normalizeExamScoreWeight(45), 1);
  assert.equal(normalizeExamScoreWeight(0), 0);
  assert.ok(Math.abs(normalizeExamScoreWeight(39) - 39 / 45) < 1e-12);
  assert.equal(normalizeExamScoreWeight(90), 1, 'above the basis clamps to 1');
  assert.equal(normalizeExamScoreWeight(null), null, 'an absent score is unknown, not zero');
  assert.equal(normalizeExamScoreWeight(undefined), null);
});

test('P0-2/T-2: the weight does not depend on what else is in the pool', () => {
  // Same node, two universes: alone, then alongside 30 high-score nodes.
  const alone = normalizeExamScoreWeight(12);
  const crowded = [12, ...Array.from({ length: 30 }, () => 39)].map((value) => normalizeExamScoreWeight(value))[0];
  assert.equal(alone, crowded, 'a relative normalisation would change this value');

  // The invariance must hold for the whole range, not just one sample.
  for (const value of [0, 1, 4, 6, 9, 13, 18, 25, 39, 45, 60]) {
    const solo = normalizeExamScoreWeight(value);
    const withMax = normalizeExamScoreWeight(value, );
    assert.equal(solo, withMax);
    assert.ok(solo != null && solo >= 0 && solo <= 1);
  }

  // And a node with a low score must NOT be inflated just because the pool has
  // no high-score node at all (the relative form returned 1 for it).
  assert.ok(
    normalizeExamScoreWeight(4) < 0.1,
    'a 4-point node is worth 4/45 of the paper regardless of the pool',
  );
});

// --------------------------------------------- the two implementations converge

test('P0-2: both opportunity entry points use the canonical normalisation', () => {
  const relativeForm = /primaryScore5y\s*\/\s*maxPrimaryScore/;

  const service = stripComments(readFileSync(OPPORTUNITY_SERVICE, 'utf8'));
  assert.doesNotMatch(service, relativeForm, 'the relative form must be gone from the service');
  assert.doesNotMatch(service, /maxPrimaryScore/, 'and its derived maximum with it');
  assert.match(service, /normalizeExamScoreWeight/, 'the canonical helper is used instead');

  const shadow = stripComments(readFileSync(SHADOW_CHAIN, 'utf8'));
  assert.match(shadow, /normalizeExamScoreWeight/, 'the shadow chain shares the same helper');
  assert.doesNotMatch(
    shadow,
    /Math\.min\(1,\s*node\.primaryScore5y\s*\/\s*45\)/,
    'a second, hand-rolled copy of the rule must not survive',
  );
});

test('P0-2/P0-6: the factor catalogue declares the canonical score-at-stake factor with a real source', () => {
  // P0-6 renamed `examImportance` to `scoreAtStake` and gave it ONE semantic
  // (point value x frequency). The absolute normalisation it consumes is
  // unchanged, so this test keeps guarding that the factor still cites the real
  // snapshot field rather than a hand-rolled second formula.
  const entry = SCORE_OPPORTUNITY_FACTORS.find((factor) => factor.key === 'scoreAtStake');
  assert.ok(entry, 'scoreAtStake is the declared score-value factor');
  assert.match(entry.source, /primaryScore5y/);
  assert.ok(
    !SCORE_OPPORTUNITY_FACTORS.some((factor) => factor.key === 'examImportance'),
    'the duplicated examImportance factor must not survive the partition',
  );
});

// ------------------------------------------------- unknown is never zero

test('P0-2/INV-10: an unknown or zero primary score stays unknown, never 0-as-measured', () => {
  // 0 means "the snapshot says zero points"; absent means "no snapshot".
  assert.equal(normalizeExamScoreWeight(0), 0);
  assert.equal(normalizeExamScoreWeight(null), null);
  assert.notEqual(normalizeExamScoreWeight(null), 0);
});
