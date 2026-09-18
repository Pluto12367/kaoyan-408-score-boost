// PHASE 9 — Score Recovery projection contract tests.
//
// "失分有没有被追回来": for each question that carries loss evidence, the
// projection asks whether the student RE-ATTEMPTED it afterwards and what the
// latest outcome was. Recovery is claimed ONLY from a real correct re-attempt
// on that question — never from mastery, never from prediction.
//
// Honesty rules pinned here:
//   • OBSERVED and PROXY loss stay in separate fields; recovery amounts too.
//   • A question whose loss is unpriced (lostScore null) is counted, never
//     priced by inference (NULL ≠ 0).
//   • status: recovered (latest re-attempt correct) / not_recovered (latest
//     wrong) / awaiting_reattempt (none yet) — no other claims.
//   • window: loss evidence and re-attempts are filtered to the window.
//   • deterministic ordering + ranks; EMPTY when nothing to report.
//   • read-only by construction; the field name states evidence, not score
//     gain (RULE-11: nothing here may be called a verified score gain).

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScoreRecovery } from '../packages/shared/dist/index.js';

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

const loss = (over = {}) => ({
  questionId: 'q-1', nodeId: 'node-pv', lostScore: 2, lossKind: 'OBSERVED', recordedAt: new Date(NOW - 5 * DAY).toISOString(), ...over,
});
const retry = (over = {}) => ({
  questionId: 'q-1', correct: true, occurredAt: new Date(NOW - 2 * DAY).toISOString(), source: 'practice', ...over,
});

function build(lossFacts, reattempts, windowDays = 30) {
  return buildScoreRecovery({ now: new Date(NOW).toISOString(), windowDays, lossFacts, reattempts });
}

test('P9 #1/#2/#3 statuses: correct reattempt → recovered; latest wrong → not_recovered; none → awaiting', () => {
  const recovered = build([loss()], [retry()]);
  assert.equal(recovered.rows[0].status, 'recovered');
  assert.equal(recovered.rows[0].reattemptCount, 1);
  assert.equal(recovered.summary.recoveredQuestions, 1);

  const notRecovered = build([loss()], [retry({ correct: false })]);
  assert.equal(notRecovered.rows[0].status, 'not_recovered');
  assert.equal(notRecovered.summary.notRecoveredQuestions, 1);

  const awaiting = build([loss()], []);
  assert.equal(awaiting.rows[0].status, 'awaiting_reattempt');
  assert.equal(awaiting.summary.awaitingQuestions, 1);
});

test('P9 #4 latest outcome decides (correct then wrong = relapse, not recovered)', () => {
  const result = build([loss()], [
    retry({ occurredAt: new Date(NOW - 3 * DAY).toISOString(), correct: true }),
    retry({ occurredAt: new Date(NOW - 1 * DAY).toISOString(), correct: false }),
  ]);
  assert.equal(result.rows[0].status, 'not_recovered');
  assert.equal(result.rows[0].reattemptCount, 2);
  assert.equal(result.rows[0].latestReattemptCorrect, false);
});

test('P9 #5/#6 OBSERVED/PROXY/unpriced amounts: separate fields, unpriced counted never priced', () => {
  const result = build(
    [
      loss({ questionId: 'q-obs', lostScore: 2, lossKind: 'OBSERVED' }),
      loss({ questionId: 'q-proxy', lostScore: 6, lossKind: 'PROXY' }),
      loss({ questionId: 'q-free', lostScore: null, lossKind: 'OBSERVED' }),
    ],
    [retry({ questionId: 'q-obs' }), retry({ questionId: 'q-proxy' }), retry({ questionId: 'q-free' })],
  );
  const obs = result.rows.find((row) => row.questionId === 'q-obs');
  const proxy = result.rows.find((row) => row.questionId === 'q-proxy');
  const free = result.rows.find((row) => row.questionId === 'q-free');
  assert.equal(obs.observedLossWithReattemptSuccess, 2, 'observed loss with recovery evidence');
  assert.equal(obs.proxyLossWithReattemptSuccess, 0);
  assert.equal(proxy.observedLossWithReattemptSuccess, 0, 'proxy never leaks into observed fields');
  assert.equal(proxy.proxyLossWithReattemptSuccess, 6);
  assert.equal(free.priced, false, 'null loss = unpriced, counted only');
  assert.equal(free.observedLossWithReattemptSuccess, 0);
  assert.equal(result.summary.observedLossWithReattemptSuccess, 2);
  assert.equal(result.summary.proxyLossWithReattemptSuccess, 6);
  assert.equal(result.summary.unpricedQuestions, 1);
});

test('P9 #7 empty state EMPTY; #8 window filters loss facts and re-attempts', () => {
  const empty = build([], [retry({ questionId: 'ghost' })]);
  assert.equal(empty.dataStatus, 'EMPTY');
  assert.deepEqual(empty.rows, []);

  const outOfWindowLoss = build([loss({ recordedAt: new Date(NOW - 60 * DAY).toISOString() })], [retry()], 30);
  assert.equal(outOfWindowLoss.dataStatus, 'EMPTY', 'loss older than the window is not counted');
  const outOfWindowRetry = build([loss()], [retry({ occurredAt: new Date(NOW - 40 * DAY).toISOString() })], 30);
  assert.equal(outOfWindowRetry.rows[0].status, 'awaiting_reattempt', 're-attempts outside the window do not count');
});

test('P9 node rollup + deterministic ordering: outstanding observed loss first, then nodeId', () => {
  const result = build(
    [
      loss({ questionId: 'q-a', nodeId: 'node-b', lostScore: 3 }),
      loss({ questionId: 'q-b', nodeId: 'node-a', lostScore: 4 }),
      loss({ questionId: 'q-c', nodeId: 'node-a', lostScore: 2 }),
    ],
    [retry({ questionId: 'q-b' })], // node-a: one recovered (4), one awaiting (2)
  );
  assert.equal(result.nodes.length, 2);
  const nodeA = result.nodes.find((row) => row.nodeId === 'node-a');
  assert.equal(nodeA.observedLostScore, 6);
  assert.equal(nodeA.observedLossWithReattemptSuccess, 4);
  assert.equal(nodeA.observedLossOutstanding, 2, 'awaiting evidence counts as outstanding');
  assert.equal(result.rows[0].questionId, 'q-a', 'node with the most outstanding loss ranks first');
  assert.deepEqual(result.rows.map((row) => row.priorityRank), result.rows.map((_, index) => index + 1));
});

test('P9 determinism + re-attempts before the loss do not count', () => {
  const a = build([loss()], [retry()]);
  const b = build([loss()], [retry()]);
  assert.deepEqual(a, b);
  const beforeLoss = build([loss()], [retry({ occurredAt: new Date(NOW - 10 * DAY).toISOString() })]);
  assert.equal(beforeLoss.rows[0].status, 'awaiting_reattempt', 'only re-attempts AFTER the loss baseline count');
});
