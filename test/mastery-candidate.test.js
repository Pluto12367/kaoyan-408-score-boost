/**
 * V12-M3 Phase-C precondition — semantic invariants and the candidate model.
 *
 * These tests exist to prove the problem rather than assert it, and then to show
 * that a specific, minimal candidate removes it without introducing a new one.
 * Nothing here changes production: the candidate lives in its own module and is
 * only ever compared.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MASTERY_INVARIANTS,
  MASTERY_EPSILON,
  masteryTargetProfile,
  auditMasteryTransition,
  auditPairDeterminism,
  updateMasteryAfterAttempt,
  updateMasteryDirectionPreserving,
  effectiveTargetFor,
  compareMasteryModels,
  MASTERY_BANDS,
} from '../packages/shared/dist/index.js';

function state(mastery, overrides = {}) {
  return {
    mastery,
    accuracy: mastery,
    recentAccuracy: mastery,
    attempts: 4,
    correctCount: Math.round(4 * mastery),
    wrongCount: 4 - Math.round(4 * mastery),
    confidence: 0.3,
    ...overrides,
  };
}

const primary = (isCorrect, difficulty) => ({ isCorrect, difficulty, role: 'PRIMARY' });

// ---------------------------------------------------------------------------
// The invariant catalogue is published, not implied
// ---------------------------------------------------------------------------

test('all four invariants are published with a statement', () => {
  assert.equal(MASTERY_INVARIANTS.length, 4);
  assert.deepEqual(MASTERY_INVARIANTS.map((entry) => entry.id), ['A', 'B', 'C', 'D']);
  for (const entry of MASTERY_INVARIANTS) {
    assert.ok(entry.name.length > 0);
    assert.ok(entry.statement.length > 0);
  }
});

// ---------------------------------------------------------------------------
// Invariant A — a failed review must not raise mastery (PROVEN VIOLATED)
// ---------------------------------------------------------------------------

test('the production wrong-answer target is a positive floor, which is the root cause', () => {
  for (const difficulty of [1, 2, 3, 4, 5]) {
    const profile = masteryTargetProfile(difficulty);
    assert.ok(
      profile.wrongTarget > 0,
      `difficulty ${difficulty} still has a positive wrong-target floor`,
    );
    assert.equal(profile.wrongRaisesBelow, profile.wrongTarget);
  }
  assert.equal(masteryTargetProfile(1).wrongTarget, 0.38, 'easy questions have the highest floor');
  assert.equal(masteryTargetProfile(5).wrongTarget, 0.2);
});

test('INVARIANT A IS VIOLATED: a wrong answer raises mastery below the floor', () => {
  const audit = auditMasteryTransition({
    model: 'production',
    state: state(0.22),
    signal: primary(false, 1),
  });

  const invariantA = audit.invariants.find((entry) => entry.id === 'A');
  assert.equal(invariantA.holds, false, 'the production model must fail invariant A here');
  assert.equal(audit.suspicious, true);
  assert.equal(audit.primaryViolation, 'A');
  assert.equal(audit.direction, 'up');
  assert.ok(audit.after > audit.before, `${audit.before} → ${audit.after} is an increase on failure`);
  assert.match(audit.basis, /不变量 A 被违反/);
});

test('the violation zone is wide for easy questions', () => {
  // Below the wrong-target floor, failure increases mastery.
  for (const [difficulty, floor] of [[1, 0.38], [2, 0.335], [3, 0.29], [4, 0.245], [5, 0.2]]) {
    const below = auditMasteryTransition({
      model: 'production',
      state: state(Math.max(0.01, floor - 0.05)),
      signal: primary(false, difficulty),
    });
    assert.ok(below.after > below.before, `difficulty ${difficulty}: below the floor must rise`);

    const above = auditMasteryTransition({
      model: 'production',
      state: state(Math.min(0.99, floor + 0.15)),
      signal: primary(false, difficulty),
    });
    assert.ok(above.after < above.before, `difficulty ${difficulty}: above the floor must fall`);
  }
});

// ---------------------------------------------------------------------------
// Invariant B — a correct review must not lower mastery (PROVEN VIOLATED)
// ---------------------------------------------------------------------------

test('INVARIANT B IS VIOLATED: a correct answer lowers mastery above the ceiling', () => {
  const difficulty = 1; // correct target 0.775
  const audit = auditMasteryTransition({
    model: 'production',
    state: state(0.95),
    signal: primary(true, difficulty),
  });

  const invariantB = audit.invariants.find((entry) => entry.id === 'B');
  assert.equal(invariantB.holds, false, 'the production model must fail invariant B here');
  assert.equal(audit.primaryViolation, 'B');
  assert.equal(audit.direction, 'down');
  assert.ok(audit.after < audit.before);
});

// ---------------------------------------------------------------------------
// Invariant C — a failed review must not reduce weakness
// ---------------------------------------------------------------------------

test('INVARIANT C IS VIOLATED wherever A is, because weakness is 1 - mastery', () => {
  const audit = auditMasteryTransition({
    model: 'production',
    state: state(0.2),
    signal: primary(false, 3),
  });

  const invariantC = audit.invariants.find((entry) => entry.id === 'C');
  assert.equal(invariantC.holds, false);
  assert.match(invariantC.detail, /weakness/);
});

// ---------------------------------------------------------------------------
// Invariant D — the difference must be bounded and deterministic
// ---------------------------------------------------------------------------

test('INVARIANT D HOLDS for the production model: single-step change is bounded by alpha', () => {
  for (const difficulty of [1, 3, 5]) {
    for (const mastery of [0, 0.25, 0.5, 0.75, 1]) {
      for (const isCorrect of [true, false]) {
        const audit = auditMasteryTransition({ model: 'production', state: state(mastery), signal: primary(isCorrect, difficulty) });
        const bounded = audit.invariants.find((entry) => entry.id === 'D');
        assert.equal(bounded.holds, true, `|Δ| must stay within alpha at mastery ${mastery}, d${difficulty}`);
        assert.ok(Math.abs(audit.delta) <= 0.18 + MASTERY_EPSILON);
      }
    }
  }
});

test('INVARIANT D holds across models: deterministic and within one alpha', () => {
  const verdict = auditPairDeterminism({
    state: state(0.22),
    signal: primary(false, 1),
    candidateAfter: updateMasteryDirectionPreserving(state(0.22), primary(false, 1)).mastery,
  });
  assert.equal(verdict.holds, true);
  assert.match(verdict.detail, /有界且确定/);
});

// ---------------------------------------------------------------------------
// The candidate removes A, B and C
// ---------------------------------------------------------------------------

test('the candidate never raises mastery on failure, at any band or difficulty', () => {
  for (const band of MASTERY_BANDS) {
    for (const difficulty of [1, 2, 3, 4, 5]) {
      const before = state(band.mastery);
      const after = updateMasteryDirectionPreserving(before, primary(false, difficulty));
      assert.ok(
        after.mastery <= before.mastery + MASTERY_EPSILON,
        `candidate raised mastery on failure at ${band.label} d${difficulty}: ${before.mastery} → ${after.mastery}`,
      );
      const audit = auditMasteryTransition({
        model: 'direction_preserving',
        state: before,
        signal: primary(false, difficulty),
        after: after.mastery,
        effectiveTarget: effectiveTargetFor('direction_preserving', before, primary(false, difficulty)),
      });
      assert.equal(audit.invariants.find((entry) => entry.id === 'A').holds, true);
      assert.equal(audit.invariants.find((entry) => entry.id === 'C').holds, true);
    }
  }
});

test('the candidate never lowers mastery on success, at any band or difficulty', () => {
  for (const band of MASTERY_BANDS) {
    for (const difficulty of [1, 2, 3, 4, 5]) {
      const before = state(band.mastery);
      const after = updateMasteryDirectionPreserving(before, primary(true, difficulty));
      assert.ok(
        after.mastery >= before.mastery - MASTERY_EPSILON,
        `candidate lowered mastery on success at ${band.label} d${difficulty}: ${before.mastery} → ${after.mastery}`,
      );
    }
  }
});

test('the candidate leaves every other field identical to production', () => {
  const before = state(0.22);
  const signal = primary(false, 3);
  const candidate = updateMasteryDirectionPreserving(before, signal);
  const production = updateMasteryAfterAttempt(before, signal);

  for (const field of ['accuracy', 'recentAccuracy', 'attempts', 'correctCount', 'wrongCount', 'confidence']) {
    assert.equal(candidate[field], production[field], `${field} must be untouched by the candidate`);
  }
});

test('the candidate preserves the production equilibrium (same fixed point)', () => {
  // Away from the clamp, repeated identical outcomes must converge to the same
  // target the production model converges to — the candidate changes the path,
  // not the destination.
  const difficulty = 3;
  let candidateState = state(0.3);
  let productionState = state(0.3);
  const signal = primary(true, difficulty);
  for (let index = 0; index < 60; index += 1) {
    candidateState = updateMasteryDirectionPreserving(candidateState, signal);
    productionState = updateMasteryAfterAttempt(productionState, signal);
  }
  assert.ok(
    Math.abs(candidateState.mastery - productionState.mastery) < 1e-6,
    `both models must converge to the same target, got ${candidateState.mastery} vs ${productionState.mastery}`,
  );
  assert.ok(Math.abs(candidateState.mastery - masteryTargetProfile(difficulty).correctTarget) < 0.01);
});

test('the candidate is bit-identical to production on every in-band state', () => {
  // This is the property that makes the migration safe: whenever mastery is
  // already on the outcome's side of its target the clamp is inactive, so the
  // two models must agree EXACTLY — not approximately. A rounded result would
  // manufacture differences the migration does not actually cause.
  let checked = 0;
  for (let step = 0; step <= 200; step += 1) {
    const m = Math.round((step / 200) * 1000) / 1000;
    for (const difficulty of [1, 2, 3, 4, 5]) {
      const profile = masteryTargetProfile(difficulty);
      for (const isCorrect of [true, false]) {
        const inBand = isCorrect ? m <= profile.correctTarget : m >= profile.wrongTarget;
        if (!inBand) continue;
        const signal = primary(isCorrect, difficulty);
        const candidate = updateMasteryDirectionPreserving(state(m), signal);
        const production = updateMasteryAfterAttempt(state(m), signal);
        assert.ok(
          Object.is(candidate.mastery, production.mastery),
          `in-band state must be bit-identical: mastery ${m}, d${difficulty}, correct=${isCorrect} gave ${candidate.mastery} vs ${production.mastery}`,
        );
        checked += 1;
      }
    }
  }
  assert.ok(checked > 1000, `expected to check a broad in-band grid, checked ${checked}`);
});

test('the candidate is deterministic', () => {
  const before = state(0.4);
  const signal = primary(false, 2);
  const first = updateMasteryDirectionPreserving(before, signal).mastery;
  const second = updateMasteryDirectionPreserving(before, signal).mastery;
  assert.equal(first, second);
});

// ---------------------------------------------------------------------------
// The sweep over bands × outcomes × difficulty × repeats
// ---------------------------------------------------------------------------

test('the sweep reports the old model violating and the candidate clearing', () => {
  const comparison = compareMasteryModels();

  assert.ok(comparison.rows.length > 0);
  assert.ok(comparison.summary.oldViolationRows > 0, 'the production model must violate somewhere in the grid');
  assert.equal(comparison.summary.candidateViolationRows, 0, 'the candidate must violate nowhere in the grid');
  assert.equal(comparison.summary.candidateFixedAll, true);
  assert.equal(comparison.summary.rowsDeterministic, comparison.rows.length, 'every cell must be deterministic');
  assert.equal(comparison.summary.rowsWithBoundedDelta, comparison.rows.length, 'every cell must be bounded');
  assert.equal(comparison.summary.authoritative, false);
  assert.match(comparison.summary.basis, /非权威/);
});

test('the sweep covers all five bands, both outcomes, several difficulties and repeats', () => {
  const comparison = compareMasteryModels();
  const bands = new Set(comparison.rows.map((row) => row.band));
  assert.deepEqual([...bands].sort(), MASTERY_BANDS.map((band) => band.label).sort());
  assert.deepEqual([...new Set(comparison.rows.map((row) => row.outcome))].sort(), ['correct', 'incorrect']);
  assert.ok(new Set(comparison.rows.map((row) => row.difficulty)).size >= 3);
  assert.ok(new Set(comparison.rows.map((row) => row.repeats)).size >= 2);
});

test('every sweep row explains itself and reports its own violations', () => {
  const comparison = compareMasteryModels();
  for (const row of comparison.rows) {
    assert.ok(row.basis.length > 0);
    if (row.candidateViolations.length > 0) {
      assert.fail(`candidate leaked a violation: ${row.basis}`);
    }
    if (row.oldViolations.length > 0) {
      assert.match(row.basis, /旧模型违反/);
    }
  }
});

test('the candidate only ever differs where the old model was wrong', () => {
  const comparison = compareMasteryModels();
  const changed = comparison.rows.filter((row) => row.masteryDelta !== 0);
  assert.ok(changed.length > 0, 'the candidate must actually change something');
  for (const row of changed) {
    assert.ok(
      row.oldViolations.length > 0,
      `the candidate changed a cell where the old model was correct: ${row.basis}`,
    );
    assert.ok(
      comparison.summary.maxAbsDelta <= 0.18 + MASTERY_EPSILON,
      'no single cell may diverge beyond one alpha',
    );
  }
});

test('the module applies nothing and touches no authoritative table', () => {
  const source = readFileSync(
    new URL('../packages/shared/src/score-center/mastery-candidate.ts', import.meta.url),
    'utf8',
  );
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const forbidden of ['prisma', 'userKnowledgeMastery', 'applyAttempts', 'applyReview', 'saveMastery', 'fetch(']) {
    assert.ok(!code.includes(forbidden), `the candidate module must not contain ${forbidden}`);
  }
  // The candidate must not fork the production transition; it composes it.
  assert.match(code, /updateMasteryAfterAttempt/, 'the candidate must build on the production transition');
});

test('the auditor can judge a candidate without importing its implementation', () => {
  const source = readFileSync(
    new URL('../packages/shared/src/score-center/mastery-semantics.ts', import.meta.url),
    'utf8',
  );
  assert.ok(
    !source.includes('mastery-candidate'),
    'the auditor must stay independent of the candidate so it cannot be tuned to pass',
  );
});
