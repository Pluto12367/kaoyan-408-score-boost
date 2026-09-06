/**
 * V6-11..V6-15 Student Segmentation / Experiment Engine / Strategy Optimizer tests.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyStudent } from '../apps/api/dist/effectiveness/learning-effectiveness.js';
import { runExperiment, generateStrategyProposals } from '../apps/api/dist/effectiveness/learning-effectiveness.js';
import { deriveLearningOutcome, buildIntervention } from '../apps/api/dist/effectiveness/learning-outcome.js';

function outcome(interventionId, masteryGain, sampleSize = 5) {
  return deriveLearningOutcome({
    userId: 'u-' + interventionId,
    intervention: buildIntervention({
      interventionId, type: 'recommendation', targetKnowledgeNodeId: 'n1',
      deliveredAt: '2026-09-01T00:00:00.000Z', expectedOutcome: 'mastery improvement', source: 'recommendation_engine',
    }),
    before: { mastery: 0.3, accuracy: 0.4, reviewSuccessRate: null, taskCompletionRate: 0.5, practiceEfficiency: null, examScorePercent: null },
    after: { mastery: 0.3 + masteryGain, accuracy: 0.5, reviewSuccessRate: null, taskCompletionRate: 0.5, practiceEfficiency: null, examScorePercent: null },
    windowStart: '2026-09-01T00:00:00.000Z', windowEnd: '2026-09-07T00:00:00.000Z', sampleSize,
  });
}

// ---- Student Segmentation ----

test('segmentation: strong_consistent for high mastery + high streak + low error', () => {
  const profile = classifyStudent({ avgMastery: 0.85, recentAccuracy: 0.88, studyStreak: 10, overdueCount: 0, openTaskCount: 2, examDaysRemaining: 60 });
  assert.equal(profile.archetype, 'strong_consistent');
  assert.equal(profile.masteryLevel, 'strong');
  assert.equal(profile.consistency, 'high');
});

test('segmentation: failing for weak mastery + debt + low consistency', () => {
  const profile = classifyStudent({ avgMastery: 0.3, recentAccuracy: 0.3, studyStreak: 0, overdueCount: 5, openTaskCount: 8, examDaysRemaining: 90 });
  assert.equal(profile.archetype, 'failing');
});

test('segmentation: average_idle for medium mastery + low streak', () => {
  const profile = classifyStudent({ avgMastery: 0.55, recentAccuracy: 0.6, studyStreak: 1, overdueCount: 1, openTaskCount: 2, examDaysRemaining: 60 });
  assert.equal(profile.archetype, 'returning');
});

test('segmentation: deterministic', () => {
  const params = { avgMastery: 0.6, recentAccuracy: 0.6, studyStreak: 4, overdueCount: 1, openTaskCount: 3, examDaysRemaining: 45 };
  assert.deepEqual(classifyStudent(params), classifyStudent(params));
});

// ---- Experiment Engine ----

test('experiment: B better than A when B has higher mastery gain', () => {
  const armA = { name: 'baseline', outcomes: [outcome('a1', 0.02), outcome('a2', 0.03), outcome('a3', 0.01)] };
  const armB = { name: 'adaptive', outcomes: [outcome('b1', 0.12), outcome('b2', 0.15), outcome('b3', 0.10)] };
  const result = runExperiment({ armA, armB, metric: 'masteryGain' });
  assert.equal(result.verdict, 'B_better');
  assert.ok(result.delta > 0);
  assert.equal(result.confidence, 'sufficient');
});

test('experiment: insufficient_data when either arm has too few samples', () => {
  const armA = { name: 'baseline', outcomes: [outcome('a1', 0.02)] };
  const armB = { name: 'adaptive', outcomes: [outcome('b1', 0.12), outcome('b2', 0.15), outcome('b3', 0.10)] };
  const result = runExperiment({ armA, armB, metric: 'masteryGain' });
  assert.equal(result.verdict, 'insufficient_data');
});

test('experiment: no significant difference when delta < 0.01', () => {
  const armA = { name: 'baseline', outcomes: [outcome('a1', 0.05), outcome('a2', 0.05), outcome('a3', 0.05)] };
  const armB = { name: 'adaptive', outcomes: [outcome('b1', 0.055), outcome('b2', 0.055), outcome('b3', 0.055)] };
  const result = runExperiment({ armA, armB, metric: 'masteryGain' });
  assert.equal(result.verdict, 'no_significant_difference');
});

test('experiment: deterministic across runs', () => {
  const armA = { name: 'base', outcomes: [outcome('a1', 0.02), outcome('a2', 0.03)] };
  const armB = { name: 'treat', outcomes: [outcome('b1', 0.08), outcome('b2', 0.09)] };
  assert.deepEqual(runExperiment({ armA, armB, metric: 'masteryGain' }), runExperiment({ armA, armB, metric: 'masteryGain' }));
});

// ---- Strategy Optimizer ----

test('optimizer: generates proposal only for B_better experiments', () => {
  const experiments = [
    { armA: 'baseline', armB: 'adaptive', sampleSizeA: 5, sampleSizeB: 5, metric: 'masteryGain', avgA: 0.02, avgB: 0.12, delta: 0.10, confidence: 'sufficient', verdict: 'B_better' },
    { armA: 'baseline', armB: 'adaptive', sampleSizeA: 5, sampleSizeB: 5, metric: 'accuracyGain', avgA: 0.05, avgB: 0.03, delta: -0.02, confidence: 'sufficient', verdict: 'A_better' },
  ];
  const proposals = generateStrategyProposals(experiments);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].parameter, 'masteryGain');
  assert.equal(proposals[0].requiresApproval, true);
});

test('optimizer: no proposals when all experiments show A_better or no difference', () => {
  const experiments = [
    { armA: 'base', armB: 'treat', sampleSizeA: 5, sampleSizeB: 5, metric: 'masteryGain', avgA: 0.1, avgB: 0.05, delta: -0.05, confidence: 'sufficient', verdict: 'A_better' },
    { armA: 'base', armB: 'treat', sampleSizeA: 5, sampleSizeB: 5, metric: 'accuracyGain', avgA: 0.05, avgB: 0.05, delta: 0, confidence: 'sufficient', verdict: 'no_significant_difference' },
  ];
  assert.equal(generateStrategyProposals(experiments).length, 0);
});

test('optimizer: proposals always require human approval', () => {
  const experiments = [
    { armA: 'base', armB: 'adaptive', sampleSizeA: 10, sampleSizeB: 10, metric: 'masteryGain', avgA: 0.02, avgB: 0.15, delta: 0.13, confidence: 'sufficient', verdict: 'B_better' },
  ];
  const proposals = generateStrategyProposals(experiments);
  assert.ok(proposals.every((p) => p.requiresApproval === true));
  assert.ok(proposals.every((p) => p.rollbackPlan.length > 0));
});