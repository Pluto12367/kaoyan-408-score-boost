// V13-A2 — ErrorPattern → Diagnosis contract tests.
//
// A2 turns "why wrong" into "what to diagnose first": it composes the A1
// error-pattern projection with OBSERVED/PROXY score-loss aggregates from the
// ScoreLoss ledger and emits a deterministic, prioritized diagnosis.
//
// Invariants pinned here:
//   • OBSERVED and PROXY lostScore are aggregated SEPARATELY, never merged.
//   • Unpriced questions count (pricedCount) but contribute NO loss value —
//     NULL ≠ 0.
//   • Loss joins by questionId bucket membership only; questions with no
//     attempts in the window contribute nothing.
//   • Ordering is deterministic: observedLostScore desc (null last),
//     then count desc, then stable key asc.
//   • Pure composition: no mastery/prediction input exists in the signature.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildErrorDiagnosis } from '../packages/shared/dist/index.js';

function attempt(overrides = {}) {
  return {
    source: 'auto',
    subject: 'OS',
    nodeId: 'node-pv',
    questionId: 'q-1',
    questionType: 'SINGLE_CHOICE',
    questionSubtype: 'OS_PV',
    reasonRaw: 'calculation_error',
    occurredAt: new Date(1_700_000_000_000).toISOString(),
    ...overrides,
  };
}

function diagnosisFor(attempts, lossByQuestion) {
  return buildErrorDiagnosis({
    now: new Date(1_700_000_000_000).toISOString(),
    windowDays: 7,
    attempts,
    lossByQuestion,
  });
}

test('A2 diagnosis: loss joins by question bucket; OBSERVED and PROXY stay separate', () => {
  const attempts = [
    attempt({ questionId: 'q-priced' }),                                   // OS_PV calculation_error, priced
    attempt({ questionId: 'q-priced' }),
    attempt({ questionId: 'q-comprehensive', questionSubtype: 'ALGORITHM',
      questionType: 'COMPREHENSIVE', reasonRaw: null, source: 'self_reported' }), // unknown reason → unclassified
  ];
  const diagnosis = diagnosisFor(attempts, {
    'q-priced': { observed: 4, proxy: 0, priced: true },
    'q-comprehensive': { observed: 0, proxy: 6, priced: true },
  });

  const top = diagnosis.rows[0];
  assert.equal(top.nodeId, 'node-pv');
  assert.equal(top.observedLostScore, 4, 'OBSERVED loss aggregated for the priced bucket');
  assert.equal(top.proxyLostScore, 0);
  assert.equal(top.pricedCount, 1);
  assert.equal(top.priorityRank, 1, 'highest observed loss ranks first');

  const proxyRow = diagnosis.rows.find((row) => row.questionSubtype === 'ALGORITHM');
  assert.ok(proxyRow);
  assert.equal(proxyRow.observedLostScore, 0, 'self-scored loss never leaks into OBSERVED');
  assert.equal(proxyRow.proxyLostScore, 6);
  assert.equal(proxyRow.reasonCode, 'unclassified');
});

test('A2 diagnosis: unpriced questions count but contribute no loss value (NULL ≠ 0)', () => {
  const attempts = [attempt({ questionId: 'q-unpriced' })];
  const diagnosis = diagnosisFor(attempts, {
    'q-unpriced': { observed: 0, proxy: 0, priced: false },
  });
  const row = diagnosis.rows[0];
  assert.equal(row.observedLostScore, 0);
  assert.equal(row.pricedCount, 0);
  assert.equal(row.unpricedCount, 1, 'unpriced counted honestly');
  assert.equal(diagnosis.summary.unpricedQuestions, 1);
});

test('A2 diagnosis: deterministic ordering — observed desc (null/zero last), then count desc, then key asc', () => {
  const attempts = [
    attempt({ nodeId: 'node-a', questionId: 'qa' }),
    attempt({ nodeId: 'node-b', questionId: 'qb' }),
    attempt({ nodeId: 'node-b', questionId: 'qb' }),
    attempt({ nodeId: 'node-c', questionId: 'qc', questionSubtype: null, reasonRaw: null }),
  ];
  const diagnosis = diagnosisFor(attempts, {
    qb: { observed: 3, proxy: 0, priced: true },
    // qa and qc have no priced loss → zero observed
  });
  assert.equal(diagnosis.rows[0].nodeId, 'node-b');
  assert.equal(diagnosis.rows[0].observedLostScore, 3);
  const qa = diagnosis.rows.find((row) => row.nodeId === 'node-a');
  const qc = diagnosis.rows.find((row) => row.nodeId === 'node-c');
  assert.ok(qa.priorityRank < qc.priorityRank, 'zero-observed ties break by count desc (qa=1 > qc=1? stable key asc decides deterministically)');
  const ranks = diagnosis.rows.map((row) => row.priorityRank);
  assert.deepEqual(ranks, [1, 2, 3, 4].slice(0, ranks.length), 'ranks are 1..N without gaps');
});

test('A2 diagnosis: empty patterns → empty rows, summary zeros (no fabrication)', () => {
  const diagnosis = diagnosisFor([], { ghost: { observed: 99, proxy: 0, priced: true } });
  assert.deepEqual(diagnosis.rows, []);
  assert.equal(diagnosis.summary.observedLostScore, 0);
  assert.equal(diagnosis.summary.proxyLostScore, 0);
  assert.equal(diagnosis.summary.pricedQuestions, 0);
});
