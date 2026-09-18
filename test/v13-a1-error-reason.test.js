// V13-A1 Error Reason Foundation — shared contract tests.
//
// Scope (task §11/§12):
//   • controlled error-reason vocabulary (Owner 14 codes + guessing + unclassified)
//   • three-layer normalization (English code <-> canonical Chinese label <-> legacy labels)
//   • classifyMistake fallback removal: UNKNOWN != CONCEPT_CONFUSION (task §6)
//   • buildErrorPatterns pure projection: aggregation, windows, determinism,
//     honest absence, OBSERVED count == eligible evidence count (no PROXY).
//
// These tests run against the BUILT shared bundle (packages/shared/dist), same
// as every other contract test in this repo. RED = module absent / assertions
// unmet before implementation.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyMistake,
  ERROR_REASON_CODES,
  ERROR_REASON_LABELS,
  OWNER_ERROR_REASON_CODES,
  SELF_REPORTABLE_ERROR_REASON_CODES,
  normalizeErrorReason,
  resolveControlledReasonInput,
  buildErrorPatterns,
} from '../packages/shared/dist/index.js';

const DAY = 86_400_000;

// ---------------------------------------------------------------- vocabulary

test('A1 vocabulary: Owner 14 codes + guessing + unclassified are all defined with unique Chinese labels', () => {
  const owner = [
    'knowledge_gap', 'concept_confusion', 'formula_gap', 'calculation_error',
    'method_error', 'reasoning_error', 'reading_error', 'careless_error',
    'time_insufficient', 'missing_step', 'boundary_condition', 'answer_structure',
    'forgetting', 'large_question_scoring_loss',
  ];
  for (const code of owner) assert.ok(ERROR_REASON_CODES.includes(code), `missing owner code ${code}`);
  assert.ok(ERROR_REASON_CODES.includes('guessing'), 'guessing (蒙题) kept for legacy read compat');
  assert.ok(ERROR_REASON_CODES.includes('unclassified'), 'unclassified explicit unknown state (task §6)');
  assert.equal(ERROR_REASON_CODES.length, new Set(ERROR_REASON_CODES).size, 'codes must be unique');
  for (const code of ERROR_REASON_CODES) {
    assert.equal(typeof ERROR_REASON_LABELS[code], 'string');
    assert.ok(ERROR_REASON_LABELS[code].length > 0, `label missing for ${code}`);
  }
  assert.equal(new Set(Object.values(ERROR_REASON_LABELS)).size, ERROR_REASON_CODES.length, 'labels must be unique');
  assert.deepEqual([...OWNER_ERROR_REASON_CODES].sort(), [...owner].sort());
});

test('A1 normalization: English codes, canonical Chinese labels and legacy labels all resolve; free text does not', () => {
  // canonical Chinese (8 legacy-stored values)
  assert.equal(normalizeErrorReason('知识点没学过'), 'knowledge_gap');
  assert.equal(normalizeErrorReason('概念混淆'), 'concept_confusion');
  assert.equal(normalizeErrorReason('公式记错'), 'formula_gap');
  assert.equal(normalizeErrorReason('计算错误'), 'calculation_error');
  assert.equal(normalizeErrorReason('审题错误'), 'reading_error');
  assert.equal(normalizeErrorReason('推理过程错误'), 'reasoning_error');
  assert.equal(normalizeErrorReason('时间不足'), 'time_insufficient');
  assert.equal(normalizeErrorReason('蒙题'), 'guessing');
  // legacy historical labels
  assert.equal(normalizeErrorReason('概念不清'), 'concept_confusion');
  assert.equal(normalizeErrorReason('知识点混淆'), 'concept_confusion');
  assert.equal(normalizeErrorReason('审题问题'), 'reading_error');
  assert.equal(normalizeErrorReason('计算失误'), 'calculation_error');
  assert.equal(normalizeErrorReason('速度偏慢'), 'time_insufficient');
  // english codes pass through
  assert.equal(normalizeErrorReason('method_error'), 'method_error');
  assert.equal(normalizeErrorReason('large_question_scoring_loss'), 'large_question_scoring_loss');
  // free text / null / empty: NOT controlled (never silently mapped into a real type)
  assert.equal(normalizeErrorReason('stale reason'), null);
  assert.equal(normalizeErrorReason('concept unclear'), null);
  assert.equal(normalizeErrorReason('定义没记牢'), null);
  assert.equal(normalizeErrorReason(''), null);
  assert.equal(normalizeErrorReason(null), null);
  assert.equal(normalizeErrorReason(undefined), null);
});

test('A1 strict input: controlledReason accepts codes/canonical labels, rejects legacy labels, guessing, unclassified', () => {
  assert.equal(resolveControlledReasonInput('method_error'), 'method_error');
  assert.equal(resolveControlledReasonInput('方法错误'), 'method_error');
  assert.equal(resolveControlledReasonInput('knowledge_gap'), 'knowledge_gap');
  // legacy labels are NOT valid controlled input (strict enum, task §7)
  assert.equal(resolveControlledReasonInput('审题问题'), null);
  assert.equal(resolveControlledReasonInput('concept unclear'), null);
  // guessing is a correct-answer state, unclassified is server-internal: neither is submittable
  assert.equal(resolveControlledReasonInput('guessing'), null);
  assert.equal(resolveControlledReasonInput('unclassified'), null);
  assert.equal(resolveControlledReasonInput('蒙题'), null);
  assert.equal(resolveControlledReasonInput('待归因'), null);
  // the self-reportable set = exactly the Owner 14
  assert.equal(SELF_REPORTABLE_ERROR_REASON_CODES.length, 14);
  assert.ok(!SELF_REPORTABLE_ERROR_REASON_CODES.includes('guessing'));
  assert.ok(!SELF_REPORTABLE_ERROR_REASON_CODES.includes('unclassified'));
});

// ------------------------------------------------- classifyMistake fallback

test('A1 classifyMistake: normal-speed wrong answer without signal stays UNKNOWN (null), never 概念混淆', () => {
  const reason = classifyMistake({ correct: false, selectedAnswer: 'A', correctAnswer: 'C', timeSpentSec: 95, expectedTimeSec: 100 });
  assert.equal(reason, null);
  assert.notEqual(reason, '概念混淆');
  // the slow branch keeps its observable signal (>=145% expected time)
  assert.equal(classifyMistake({ correct: false, selectedAnswer: 'A', correctAnswer: 'C', timeSpentSec: 180, expectedTimeSec: 90 }), '概念混淆');
});

// ----------------------------------------------------- buildErrorPatterns

function attempt(overrides = {}) {
  return {
    source: 'auto',
    subject: 'OS',
    nodeId: 'node-pv',
    questionId: 'q-1',
    questionType: 'SINGLE_CHOICE',
    reasonRaw: '概念混淆',
    occurredAt: new Date(1_700_000_000_000).toISOString(),
    ...overrides,
  };
}

test('A1 patterns Case 5+7+8: aggregation by (subject,node,reason); different reasons and nodes never merge', () => {
  const base = 1_700_000_000_000;
  const result = buildErrorPatterns({
    now: new Date(base).toISOString(),
    windowDays: 14,
    attempts: [
      attempt({ questionId: 'q-1', reasonRaw: '概念混淆', occurredAt: new Date(base - DAY).toISOString() }),
      attempt({ questionId: 'q-2', reasonRaw: 'concept_confusion', nodeId: 'node-pv', occurredAt: new Date(base - 2 * DAY).toISOString() }),
      attempt({ questionId: 'q-3', reasonRaw: 'calculation_error', nodeId: 'node-pv', occurredAt: new Date(base - 3 * DAY).toISOString() }),
      attempt({ questionId: 'q-4', reasonRaw: '概念混淆', nodeId: 'node-mem', subject: 'CO', occurredAt: new Date(base - 4 * DAY).toISOString() }),
    ],
  });
  // 4 rows: (OS,pv,concept_confusion) x2 merged, (OS,pv,calculation_error), (CO,mem,concept_confusion)
  assert.equal(result.patterns.length, 3);
  const merged = result.patterns.find((p) => p.nodeId === 'node-pv' && p.reasonCode === 'concept_confusion');
  assert.ok(merged, 'same user/node/reason aggregates (Case 5)');
  assert.equal(merged.count, 2);
  assert.equal(merged.subject, 'OS');
  const otherReason = result.patterns.find((p) => p.reasonCode === 'calculation_error');
  assert.ok(otherReason && otherReason.count === 1, 'different reason never merges (Case 7)');
  const otherNode = result.patterns.find((p) => p.nodeId === 'node-mem');
  assert.ok(otherNode && otherNode.count === 1 && otherNode.subject === 'CO', 'different node never merges (Case 8)');
  assert.equal(result.totals.wrongCount, 4);
  assert.equal(result.totals.wrongCount, result.attemptsCounted, 'OBSERVED count == eligible evidence count');
});

test('A1 patterns Case 6: time window filters strictly; unknown free text lands in unclassified, never concept_confusion', () => {
  const base = 1_700_000_000_000;
  const result = buildErrorPatterns({
    now: new Date(base).toISOString(),
    windowDays: 7,
    attempts: [
      // the only controlled-reason attempt sits OUTSIDE the 7d window
      attempt({ occurredAt: new Date(base - 30 * DAY).toISOString() }),
      // everything in-window is unknown (free text / null): explicit unclassified
      attempt({ reasonRaw: 'stale reason', occurredAt: new Date(base - 1 * DAY).toISOString() }),
      attempt({ reasonRaw: null, occurredAt: new Date(base - 2 * DAY).toISOString() }),
      attempt({ reasonRaw: 'concept unclear', occurredAt: new Date(base - 2 * DAY).toISOString() }),
    ],
  });
  assert.equal(result.totals.wrongCount, 3, 'only in-window wrong evidence counts (Case 6)');
  const unclassified = result.patterns.filter((p) => p.reasonCode === 'unclassified');
  assert.equal(unclassified.reduce((sum, p) => sum + p.count, 0), 3, 'free text and null both land in explicit unknown');
  assert.ok(!result.patterns.some((p) => p.reasonCode === 'concept_confusion'), 'UNKNOWN must not be folded into CONCEPT_CONFUSION (task §12)');
  assert.equal(result.totals.unclassifiedCount, 3);
  assert.equal(result.totals.unclassifiedCount, result.totals.wrongCount - result.patterns.reduce((sum, p) => sum + (p.reasonCode === 'unclassified' ? 0 : p.count), 0));
});

test('A1 patterns Case 10 + honesty: empty input yields empty stats, trend needs both halves (no PROXY trends)', () => {
  const base = 1_700_000_000_000;
  const empty = buildErrorPatterns({ now: new Date(base).toISOString(), windowDays: 7, attempts: [] });
  assert.deepEqual(empty.patterns, []);
  assert.equal(empty.totals.wrongCount, 0);
  assert.equal(empty.totals.unclassifiedCount, 0);

  const recentOnly = buildErrorPatterns({
    now: new Date(base).toISOString(),
    windowDays: 14,
    attempts: [attempt({ occurredAt: new Date(base - DAY).toISOString() })], // only recent half
  });
  assert.equal(recentOnly.patterns[0].trend, 'no_data', 'trend without an older-half baseline stays no_data (no fabrication)');

  const both = buildErrorPatterns({
    now: new Date(base).toISOString(),
    windowDays: 14,
    attempts: [
      attempt({ occurredAt: new Date(base - 2 * DAY).toISOString() }),
      attempt({ occurredAt: new Date(base - 10 * DAY).toISOString() }),
      attempt({ occurredAt: new Date(base - 11 * DAY).toISOString() }),
    ],
  });
  const row = both.patterns[0];
  assert.equal(row.count, 3);
  assert.equal(row.recentCount, 1);
  assert.equal(row.trend, 'down', 'recent half 1 < older half 2');
  assert.equal(row.repeated, true, 'count>=2 marks repetition');
  assert.ok(row.lastOccurredAt <= new Date(base).toISOString());
});

test('A1 patterns: review-side self-reported evidence joins aggregation; correct redos excluded; sources distinguish auto/self', () => {
  const base = 1_700_000_000_000;
  const result = buildErrorPatterns({
    now: new Date(base).toISOString(),
    windowDays: 14,
    attempts: [
      attempt({ reasonRaw: '概念混淆', occurredAt: new Date(base - DAY).toISOString(), source: 'auto' }),
      attempt({ reasonRaw: '概念混淆', occurredAt: new Date(base - 2 * DAY).toISOString(), source: 'self_reported', questionId: 'q-9' }),
      attempt({ reasonRaw: '方法错误', occurredAt: new Date(base - 3 * DAY).toISOString(), source: 'self_reported', questionId: 'q-8' }),
    ],
  });
  const merged = result.patterns.find((p) => p.reasonCode === 'concept_confusion');
  assert.equal(merged.sources.sort().join(','), 'auto,self_reported', 'mixed sources labelled');
  const selfOnly = result.patterns.find((p) => p.reasonCode === 'method_error');
  assert.ok(selfOnly, 'user-confirmed-only codes surface through self reports');
  assert.equal(selfOnly.sources.join(','), 'self_reported');
});

test('A1 patterns: node-less attempts count in totals but form no pattern row (honest attribution gap)', () => {
  const base = 1_700_000_000_000;
  const result = buildErrorPatterns({
    now: new Date(base).toISOString(),
    windowDays: 7,
    attempts: [
      attempt({ nodeId: null, subject: null, occurredAt: new Date(base - DAY).toISOString() }),
      attempt({ occurredAt: new Date(base - DAY).toISOString() }),
    ],
  });
  assert.equal(result.totals.wrongCount, 2);
  assert.equal(result.totals.nodeUnattributedCount, 1);
  assert.equal(result.patterns.length, 1);
});
