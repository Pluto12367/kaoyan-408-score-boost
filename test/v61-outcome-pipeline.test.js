/**
 * V6.1 Outcome Pipeline / Strategy Comparison / Evidence Gate tests.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOutcomeFromFacts,
  selectQuestionsByStrategy,
  checkEvidenceGate,
} from '../apps/api/dist/effectiveness/outcome-pipeline.js';

// ---- Outcome Pipeline ----

test('outcome pipeline: builds from real practice facts with time window', () => {
  const result = buildOutcomeFromFacts({
    facts: [
      { questionId: 'q1', knowledgeNodeId: 'n1', correct: false, submittedAt: '2026-09-01T10:00:00.000Z' },
      { questionId: 'q1', knowledgeNodeId: 'n1', correct: true, submittedAt: '2026-09-02T10:00:00.000Z' },
      { questionId: 'q1', knowledgeNodeId: 'n1', correct: true, submittedAt: '2026-09-03T10:00:00.000Z' },
    ],
    masteryBefore: 0.3,
    masteryAfter: 0.55,
    windowStart: '2026-09-01T00:00:00.000Z',
    windowEnd: '2026-09-07T00:00:00.000Z',
    knowledgeNodeId: 'n1',
  });
  assert.equal(result.attemptsInWindow, 3);
  assert.equal(result.correctInWindow, 2);
  assert.equal(result.accuracyInWindow, 0.6667);
  assert.equal(result.masteryGain, 0.25);
  assert.equal(result.quality, 'ok');
});

test('outcome pipeline: insufficient_data when < 2 attempts in window', () => {
  const result = buildOutcomeFromFacts({
    facts: [{ questionId: 'q1', knowledgeNodeId: 'n1', correct: true, submittedAt: '2026-09-02T10:00:00.000Z' }],
    masteryBefore: null, masteryAfter: 0.5,
    windowStart: '2026-09-01T00:00:00.000Z', windowEnd: '2026-09-07T00:00:00.000Z',
    knowledgeNodeId: 'n1',
  });
  assert.equal(result.quality, 'insufficient_data');
});

test('outcome pipeline: masteryGain is null when no baseline', () => {
  const result = buildOutcomeFromFacts({
    facts: [
      { questionId: 'q1', knowledgeNodeId: 'n1', correct: true, submittedAt: '2026-09-02T10:00:00.000Z' },
      { questionId: 'q2', knowledgeNodeId: 'n1', correct: true, submittedAt: '2026-09-03T10:00:00.000Z' },
    ],
    masteryBefore: null, masteryAfter: 0.5,
    windowStart: '2026-09-01T00:00:00.000Z', windowEnd: '2026-09-07T00:00:00.000Z',
    knowledgeNodeId: 'n1',
  });
  assert.equal(result.masteryGain, null);
});

// ---- Strategy Comparison ----

const CANDIDATES = [
  { questionId: 'q-weak', knowledgeNodeId: 'n-weak', difficulty: 'MEDIUM', examFrequency: 2, mastery: 0.25 },
  { questionId: 'q-strong', knowledgeNodeId: 'n-strong', difficulty: 'HARD', examFrequency: 8, mastery: 0.9 },
  { questionId: 'q-mid', knowledgeNodeId: 'n-mid', difficulty: 'MEDIUM', examFrequency: 5, mastery: 0.5 },
];

test('strategy: weakness_first picks lowest mastery question', () => {
  const result = selectQuestionsByStrategy(CANDIDATES, 'weakness_first', 1);
  assert.equal(result.selectedQuestionIds[0], 'q-weak');
});

test('strategy: exam_frequency_first picks highest frequency question', () => {
  const result = selectQuestionsByStrategy(CANDIDATES, 'exam_frequency_first', 1);
  assert.equal(result.selectedQuestionIds[0], 'q-strong');
});

test('strategy: balanced picks by combined mastery+frequency score', () => {
  const result = selectQuestionsByStrategy(CANDIDATES, 'balanced', 2);
  assert.equal(result.selectedQuestionIds.length, 2);
  assert.ok(result.selectedQuestionIds.includes('q-weak'), 'weak should be selected (low mastery + decent freq)');
});

test('strategy: adaptive picks by combined score with risk boost', () => {
  const result = selectQuestionsByStrategy(CANDIDATES, 'adaptive', 1, new Set(['n-weak']));
  assert.equal(result.selectedQuestionIds[0], 'q-weak');
});

test('strategy: comparison produces distinct results across strategies', () => {
  const strategies = ['weakness_first', 'exam_frequency_first', 'balanced', 'adaptive'];
  const results = strategies.map((s) => selectQuestionsByStrategy(CANDIDATES, s, 2));
  const firstPicks = results.map((r) => r.selectedQuestionIds[0]);
  assert.ok(new Set(firstPicks).size >= 2, 'different strategies should produce different top picks');
});

// ---- Evidence Gate ----

test('evidence gate: passes when all thresholds met', () => {
  const result = checkEvidenceGate(10, 0.15, 'high', 'ok', {
    minSampleSize: 5, minEffectSize: 0.1, requiredConfidence: 'medium', dataQualityOk: true,
  });
  assert.equal(result.passed, true);
});

test('evidence gate: blocks on insufficient sample size', () => {
  const result = checkEvidenceGate(2, 0.15, 'high', 'ok', {
    minSampleSize: 5, minEffectSize: 0.1, requiredConfidence: 'medium', dataQualityOk: true,
  });
  assert.equal(result.passed, false);
  assert.ok(result.reason.includes('min_sample_size'));
});

test('evidence gate: blocks on small effect size', () => {
  const result = checkEvidenceGate(10, 0.03, 'high', 'ok', {
    minSampleSize: 5, minEffectSize: 0.1, requiredConfidence: 'medium', dataQualityOk: true,
  });
  assert.equal(result.passed, false);
  assert.ok(result.reason.includes('min_effect_size'));
});

test('evidence gate: blocks on poor data quality', () => {
  const result = checkEvidenceGate(10, 0.15, 'high', 'insufficient_data', {
    minSampleSize: 5, minEffectSize: 0.1, requiredConfidence: 'medium', dataQualityOk: false,
  });
  assert.equal(result.passed, false);
  assert.ok(result.reason.includes('data_quality'));
});