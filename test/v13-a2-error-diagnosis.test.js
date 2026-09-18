// V13-A2 — ErrorPattern → Diagnosis contract tests (task §20 checklist).
//
// Diagnosis = stable problem units interpreted from error-pattern FACTS:
//   key = (subject, knowledgeNode, questionSubtype, errorReason)
// Every finding is traceable (sample question ids + sources + window) and
// carries evidence-based confidence — never an ability claim.
//
// Invariants pinned here (task §20):
//   1 single error → finding          2 aggregation       3 subtype split
//   4 node split                      5 reason split      6 time window
//   7 trend                           8 repeated (cross-half rule)
//   9 observed loss                  10 proxy separation  11 empty state
//  12 unknown subtype                13 unknown reason    14 legacy reason
//  15/16 no mastery / recommendation mutation → structural (pure signature;
//      no such inputs exist) and covered by upstream regression suites.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildErrorDiagnosis } from '../packages/shared/dist/index.js';

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

function attempt(overrides = {}) {
  return {
    source: 'auto',
    subject: 'OS',
    nodeId: 'node-pv',
    questionId: 'q-1',
    questionType: 'SINGLE_CHOICE',
    questionSubtype: 'OS_PV',
    reasonRaw: 'calculation_error',
    occurredAt: new Date(NOW - DAY).toISOString(),
    ...overrides,
  };
}

function diagnose(attempts, lossByQuestion = {}, windowDays = 7) {
  return buildErrorDiagnosis({
    now: new Date(NOW).toISOString(),
    windowDays,
    attempts,
    lossByQuestion,
  });
}

test('A2 #1/#2 single error becomes a finding; same-key errors aggregate; confidence follows sample size', () => {
  const single = diagnose([attempt({ questionId: 'q-a' })]);
  assert.equal(single.findings.length, 1);
  assert.equal(single.findings[0].count, 1);
  assert.equal(single.findings[0].confidence, 'low');
  assert.match(single.findings[0].finding, /近 7 天/);
  assert.match(single.findings[0].finding, /calculation_error|计算错误/);
  assert.equal(single.dataStatus, 'OK');

  const aggregated = diagnose([
    attempt({ questionId: 'q-a' }),
    attempt({ questionId: 'q-b' }),
    attempt({ questionId: 'q-c' }),
    attempt({ questionId: 'q-d' }),
    attempt({ questionId: 'q-e' }),
  ]);
  assert.equal(aggregated.findings.length, 1);
  assert.equal(aggregated.findings[0].count, 5);
  assert.equal(aggregated.findings[0].confidence, 'high', 'count>=5 → high sample confidence');
  const medium = diagnose([attempt({}), attempt({}), attempt({})]).findings[0];
  assert.equal(medium.confidence, 'medium', 'count>=3 → medium');
});

test('A2 #3/#4/#5 different subtype, node, or reason each produce separate findings', () => {
  const result = diagnose([
    attempt({ questionId: 'q-1', questionSubtype: 'OS_PV', reasonRaw: 'calculation_error' }),
    attempt({ questionId: 'q-2', questionSubtype: 'ALGORITHM', reasonRaw: 'calculation_error' }),
    attempt({ questionId: 'q-3', questionSubtype: 'OS_PV', reasonRaw: 'concept_confusion' }),
    attempt({ nodeId: 'node-mem', subject: 'DS', questionSubtype: 'OS_PV', reasonRaw: 'calculation_error' }),
  ]);
  assert.equal(result.findings.length, 4, '4-part key splits every dimension');
  const keys = result.findings.map((row) => `${row.nodeId}|${row.questionSubtype}|${row.reasonCode}`).sort();
  assert.equal(new Set(keys).size, 4);
});

test('A2 #6/#7 time window filters; recentCount/trend keep recent semantics', () => {
  const inWindow = diagnose([
    attempt({ occurredAt: new Date(NOW - DAY).toISOString() }),
    attempt({ occurredAt: new Date(NOW - 2 * DAY).toISOString() }),
  ], {}, 7);
  assert.equal(inWindow.findings[0].count, 2);
  const outside = diagnose([attempt({ occurredAt: new Date(NOW - 30 * DAY).toISOString() })], {}, 7);
  assert.equal(outside.dataStatus, 'EMPTY');
  assert.deepEqual(outside.findings, []);

  const older = diagnose([
    attempt({ occurredAt: new Date(NOW - 10 * DAY).toISOString() }),
    attempt({ occurredAt: new Date(NOW - 11 * DAY).toISOString() }),
    attempt({ occurredAt: new Date(NOW - 2 * DAY).toISOString() }),
  ], {}, 14);
  const row = older.findings[0];
  assert.equal(row.count, 3);
  assert.equal(row.recentCount, 1, 'recentCount = newer half of the window');
  assert.equal(row.trend, 'down');
});

test('A2 #8 repeated = cross-half persistence, not just count>1 (explicit time semantics)', () => {
  const burst = diagnose([
    attempt({ occurredAt: new Date(NOW - DAY).toISOString() }),
    attempt({ occurredAt: new Date(NOW - 2 * DAY).toISOString() }),
  ]);
  assert.equal(burst.findings[0].repeated, false, 'same-half burst is NOT repeated');

  const persistent = diagnose([
    attempt({ occurredAt: new Date(NOW - 2 * DAY).toISOString() }),
    attempt({ occurredAt: new Date(NOW - 10 * DAY).toISOString() }),
  ], {}, 14);
  assert.equal(persistent.findings[0].repeated, true, 'present in both halves = repeated');
  assert.match(persistent.findings[0].finding, /重复出现/);
});

test('A2 #9/#10 OBSERVED and PROXY loss stay separate; proxy is labelled in the finding', () => {
  const result = diagnose(
    [
      attempt({ questionId: 'q-priced', reasonRaw: 'calculation_error' }),
      attempt({ questionId: 'q-self', reasonRaw: null, questionSubtype: 'ALGORITHM', source: 'self_reported' }),
    ],
    {
      'q-priced': { observed: 2, proxy: 0, priced: true },
      'q-self': { observed: 0, proxy: 6, priced: true },
    },
  );
  const observedRow = result.findings.find((row) => row.reasonCode === 'calculation_error');
  assert.equal(observedRow.observedLostScore, 2);
  assert.equal(observedRow.proxyLostScore, 0);
  const proxyRow = result.findings.find((row) => row.questionSubtype === 'ALGORITHM');
  assert.equal(proxyRow.observedLostScore, 0);
  assert.equal(proxyRow.proxyLostScore, 6);
  assert.match(proxyRow.finding, /PROXY/);
  assert.doesNotMatch(observedRow.finding, /PROXY/);
});

test('A2 #11 empty state: dataStatus EMPTY with zero findings (no fake weak points)', () => {
  const empty = diagnose([], { ghost: { observed: 99, proxy: 0, priced: true } });
  assert.equal(empty.dataStatus, 'EMPTY');
  assert.deepEqual(empty.findings, []);
  assert.equal(empty.summary.wrongCount, 0);
  assert.equal(empty.summary.observedLostScore, 0, 'loss facts for untouched questions are ignored');
});

test('A2 #12/#13/#14 unknown subtype and unknown reason get explicit buckets; legacy reason normalizes', () => {
  const result = diagnose([
    attempt({ questionId: 'q-1', questionSubtype: null, reasonRaw: null }),
    attempt({ questionId: 'q-2', reasonRaw: '概念不清' }),
    attempt({ questionId: 'q-3', reasonRaw: 'stale free text' }),
  ]);
  const unknownSubtype = result.findings.find((row) => row.questionSubtype === 'unknown');
  assert.ok(unknownSubtype, 'unknown subtype gets its own explicit bucket');
  const concept = result.findings.find((row) => row.reasonCode === 'concept_confusion');
  assert.ok(concept && concept.count === 1, 'legacy 概念不清 normalizes into concept_confusion');
  const unclassified = result.findings.filter((row) => row.reasonCode === 'unclassified');
  assert.equal(unclassified.reduce((sum, row) => sum + row.count, 0), 2, 'null and free text stay unclassified');
});

test('A2 evidence traceability: findings carry bounded sample question ids and sources', () => {
  const result = diagnose([
    attempt({ questionId: 'q-a' }),
    attempt({ questionId: 'q-b' }),
    attempt({ questionId: 'q-c' }),
    attempt({ questionId: 'q-d' }),
    attempt({ questionId: 'q-e' }),
    attempt({ questionId: 'q-f' }),
    attempt({ questionId: 'q-g' }),
  ]);
  const row = result.findings[0];
  assert.ok(row.sampleQuestionIds.length > 0 && row.sampleQuestionIds.length <= 5, 'sample ids bounded to 5');
  assert.ok(row.sampleQuestionIds.every((id) => ['q-a', 'q-b', 'q-c', 'q-d', 'q-e', 'q-f', 'q-g'].includes(id)));
  assert.deepEqual(row.sources, ['auto']);
});
