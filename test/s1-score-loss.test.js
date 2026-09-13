import test from 'node:test';
import assert from 'node:assert/strict';

// S1-I0 / P1 — Score Loss Evidence (INV-8..IL-9, T-10..T-13).
//
// The derivation turns per-question attempt facts (PracticeRecord) plus the
// content-side price (Question.maxScore) into per-question loss rows. The
// rules under test, all from the approved formal design §三:
//
//   IL-1  Σ questionLoss ≤ totalAssessmentLoss (the ledger row's own envelope;
//         accuracy_rate rows have no comparable envelope, so the paper's priced
//         point total is the honest ceiling instead)
//   IL-2  Σ nodeAttributedLoss ≤ Σ questionLoss
//   IL-3  each question's loss lands on exactly ONE node (exclusive PRIMARY)
//   IL-4  0 ≤ lostScore ≤ maxScore; a stored 0 is a real observation
//   IL-5  unpriced lost questions are COUNTED, never silently zeroed
//   IL-6  observedLoss and proxyLoss are reported separately, never merged
//   IL-7  every output carries its kind and grading basis
//   IL-9  no pricing data → coverage 0 / loss null, not a fabricated number
//
// A conservation violation REFUSES to emit (拒绝出数) — it is never clipped.

const SHARED = new URL('../packages/shared/dist/index.js', import.meta.url);
const { deriveScoreLossItems, buildScoreLossProjection } = await import(SHARED.href);

const fact = (overrides = {}) => ({
  questionId: 'q-1',
  correct: false,
  gradingMethod: 'exact_match',
  selfScore: null,
  rubricEarnedScore: null,
  maxScore: 2,
  nodeId: 'node-1',
  ...overrides,
});

const derive = (facts, overrides = {}) => deriveScoreLossItems({
  facts,
  entrySemantic: 'accuracy_rate',
  entryRawScore: 60,
  entryRawTotalScale: 100,
  sessionPricedTotalPoints: 150,
  ...overrides,
});

// ------------------------------------------------------------ the derivation

test('P1: an objective lost question loses exactly its maxScore (OBSERVED)', () => {
  const result = derive([fact()]);
  assert.equal(result.ok, true);
  assert.equal(result.items.length, 1);
  const row = result.items[0];
  assert.equal(row.lostScore, 2);
  assert.equal(row.earnedScore, 0);
  assert.equal(row.maxScore, 2);
  assert.equal(row.lossKind, 'OBSERVED');
  assert.equal(row.gradingMethod, 'exact_match');
  assert.equal(row.nodeId, 'node-1');
});

test('P1: an objective correct question produces no loss row', () => {
  const result = derive([fact({ correct: true })]);
  assert.equal(result.items.length, 0);
  assert.equal(result.summary.lostQuestions, 0);
  assert.equal(result.summary.pricedCoverage, null, 'nothing lost — there is no coverage to report');
});

test('P1/T-13: self-reported loss is PROXY and never merged into observed loss', () => {
  const result = derive([
    fact({ questionId: 'obj', gradingMethod: 'exact_match', maxScore: 2 }),
    fact({ questionId: 'subj', gradingMethod: 'self_report', selfScore: 0.5, maxScore: 10, correct: true }),
  ]);
  const subj = result.items.find((item) => item.questionId === 'subj');
  assert.equal(subj.lossKind, 'PROXY');
  assert.equal(subj.earnedScore, 5);
  assert.equal(subj.lostScore, 5);

  assert.equal(result.summary.observedLoss, 2);
  assert.equal(result.summary.proxyLoss, 5);
  assert.ok(!('totalLoss' in result.summary), 'the two classes must not be pre-merged into one number');

  // selfScore = 1 claims full credit: nothing lost, no row.
  const full = derive([fact({ questionId: 'subj', gradingMethod: 'self_report', selfScore: 1, maxScore: 10, correct: true })]);
  assert.equal(full.items.length, 0);
});

test('P1: rubric-graded loss is OBSERVED with its earned points', () => {
  const result = derive([fact({ gradingMethod: 'rubric', rubricEarnedScore: 3, maxScore: 10 })]);
  const row = result.items[0];
  assert.equal(row.lossKind, 'OBSERVED');
  assert.equal(row.earnedScore, 3);
  assert.equal(row.lostScore, 7);
});

// ------------------------------------------------------------- unpriced (T-11)

test('P1/T-11/IL-5: unpriced lost questions are counted, never zeroed, never scaled up', () => {
  const result = derive([
    fact({ questionId: 'priced', maxScore: 2 }),
    fact({ questionId: 'unpriced', maxScore: null }),
    fact({ questionId: 'unpriced-2', maxScore: null, nodeId: 'node-2' }),
  ]);
  assert.equal(result.summary.lostQuestions, 3);
  assert.equal(result.summary.pricedLostQuestions, 1);
  assert.equal(result.summary.unpricedLostQuestions, 2, 'missing price is a count, not a zero');
  assert.ok(Math.abs((result.summary.pricedCoverage ?? 0) - 1 / 3) < 1e-3, 'round3 precision');
  const unpriced = result.items.filter((item) => item.maxScore === null);
  assert.equal(unpriced.length, 2);
  for (const row of unpriced) {
    assert.equal(row.lostScore, null, 'no price → no number; null is not 0');
    assert.equal(row.earnedScore, null);
  }
  // The priced row keeps its real value — no proportional inflation to cover the gap.
  assert.equal(result.items.find((item) => item.questionId === 'priced').lostScore, 2);
});

test('P1/IL-9: no pricing data at all → coverage 0 and null losses, honestly', () => {
  const result = derive([fact({ maxScore: null }), fact({ questionId: 'q-2', maxScore: null })], { sessionPricedTotalPoints: null });
  assert.equal(result.summary.pricedCoverage, 0);
  assert.equal(result.summary.observedLoss, null, 'no number exists — null, not 0');
  assert.equal(result.summary.proxyLoss, null);
});

// ------------------------------------------------------- attribution (T-12/IL-3)

test('P1/T-12/IL-3: one question attributes its loss to exactly ONE node', () => {
  // Even though the real question may carry several node LABELS, the resolver
  // hands the derivation exactly one PRIMARY node; the sum stays per-node.
  const result = derive([
    fact({ questionId: 'a', nodeId: 'node-1', maxScore: 2 }),
    fact({ questionId: 'b', nodeId: 'node-1', maxScore: 3 }),
    fact({ questionId: 'c', nodeId: 'node-2', maxScore: 4 }),
  ]);
  assert.deepEqual(result.summary.nodeAttributedLoss, { 'node-1': 5, 'node-2': 4 });
  const total = Object.values(result.summary.nodeAttributedLoss).reduce((sum, value) => sum + value, 0);
  assert.ok(total <= 9, 'IL-2: attributed loss can never exceed question loss');
});

test('P1: an unattributed lost question stays counted with a null node, not dropped', () => {
  const result = derive([fact({ nodeId: null, maxScore: 2 })]);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].nodeId, null);
  assert.equal(result.summary.unattributedLostQuestions, 1);
  assert.deepEqual(result.summary.nodeAttributedLoss, {});
});

// --------------------------------------------------------- conservation (T-10)

test('P1/T-10/IL-1: loss can undershoot the assessment envelope but never exceed it', () => {
  const under = derive([fact({ maxScore: 2 })], {
    entrySemantic: 'exam_total', entryRawScore: 100, entryRawTotalScale: 150,
  });
  assert.equal(under.ok, true);
  assert.equal(under.summary.conservationBasis, 'exam_total_row');
  assert.equal(under.summary.conservationTotal, 50);

  const violated = derive(
    [fact({ maxScore: 60 }), fact({ questionId: 'q-2', maxScore: 60 }), fact({ questionId: 'q-3', maxScore: 40 })],
    { entrySemantic: 'exam_total', entryRawScore: 100, entryRawTotalScale: 150 },
  );
  assert.equal(violated.ok, false, '180 lost points from a 50-point loss is a data defect');
  assert.match(violated.rejectionReason, /守恒|conservation/);
  assert.equal(violated.items.length, 0, 'a violating derivation refuses to emit rows (拒绝出数，不裁剪)');
});

test('P1/IL-1: accuracy_rate entries use the paper point envelope, never a percentage mix', () => {
  // 40% lost on a 100-scale row would "allow" 40 points if the two semantics
  // were mixed — the honest envelope is the paper's priced point total.
  const result = derive(
    [fact({ maxScore: 80 })],
    { entrySemantic: 'accuracy_rate', entryRawScore: 60, entryRawTotalScale: 100, sessionPricedTotalPoints: 150 },
  );
  assert.equal(result.ok, true);
  assert.equal(result.summary.conservationBasis, 'paper_points_envelope');
  assert.equal(result.summary.conservationTotal, 150);

  const violated = derive(
    [fact({ maxScore: 90 }), fact({ questionId: 'q-2', maxScore: 70 })],
    { entrySemantic: 'accuracy_rate', entryRawScore: 60, entryRawTotalScale: 100, sessionPricedTotalPoints: 150 },
  );
  assert.equal(violated.ok, false, '160 points lost from a 150-point paper is impossible');
});

// ------------------------------------------------------------- the projection

test('P1: the read projection groups by entry and keeps the classes separate', () => {
  const projection = buildScoreLossProjection({
    entries: [
      {
        scoreEntryKind: 'assessment',
        scoreEntryId: 'a-1',
        semantic: 'accuracy_rate',
        rawScore: 60,
        rawTotalScale: 100,
        title: '模拟卷',
        recordedAt: '2026-09-13T00:00:00.000Z',
        items: [
          { questionId: 'q1', nodeId: 'node-1', maxScore: 2, earnedScore: 0, lostScore: 2, lossKind: 'OBSERVED', gradingMethod: 'exact_match' },
          { questionId: 'q2', nodeId: 'node-1', maxScore: 10, earnedScore: 5, lostScore: 5, lossKind: 'PROXY', gradingMethod: 'self_report' },
          { questionId: 'q3', nodeId: null, maxScore: null, earnedScore: null, lostScore: null, lossKind: 'OBSERVED', gradingMethod: 'exact_match' },
        ],
      },
    ],
  });
  assert.equal(projection.entries.length, 1);
  const entry = projection.entries[0];
  assert.equal(entry.observedLoss, 2);
  assert.equal(entry.proxyLoss, 5);
  assert.deepEqual(entry.nodeAttributedLoss, { 'node-1': 7 });
  assert.equal(entry.lostQuestions, 3);
  assert.ok(Math.abs((entry.pricedCoverage ?? 0) - 2 / 3) < 1e-3, 'round3 precision');
  assert.deepEqual(entry.coverageGap, {
    unpricedLostQuestions: 1,
    unpricedNodeIds: [null],
  }, 'the coverage gap is reported, never scaled away');
  assert.equal(entry.kind, 'DERIVED', 'the projection is a derived read model, not an observation');
});
