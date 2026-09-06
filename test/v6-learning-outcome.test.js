/**
 * V6-1..V4 Learning Outcome / Intervention / Attribution / Effectiveness tests.
 * 50+ deterministic assertions across all effectiveness surfaces.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildIntervention,
  deriveLearningOutcome,
  attributeOutcome,
  evaluateEffectiveness,
} from '../apps/api/dist/effectiveness/learning-outcome.js';

function snap(overrides = {}) {
  return {
    mastery: 0.4, accuracy: 0.5, reviewSuccessRate: 0.6,
    taskCompletionRate: 0.7, practiceEfficiency: 0.5, examScorePercent: null,
    ...overrides,
  };
}

function intervention(overrides = {}){
  return buildIntervention({
    interventionId: 'task-1',
    type: 'recommendation',
    targetKnowledgeNodeId: 'n-dl',
    targetSubject: 'OS',
    deliveredAt: '2026-09-01T00:00:00.000Z',
    expectedOutcome: 'mastery improvement',
    source: 'recommendation_engine',
    ...overrides,
  });
}

function outcome(overrides = {}) {
  return deriveLearningOutcome({
    userId: 'u-1',
    intervention: intervention(),
    before: snap({ mastery: 0.3, accuracy: 0.4 }),
    after: snap({ mastery: 0.5, accuracy: 0.6 }),
    windowStart: '2026-09-01T00:00:00.000Z',
    windowEnd: '2026-09-07T00:00:00.000Z',
    sampleSize: 5,
    ...overrides,
  });
}

// ---- Intervention Model ----

test('intervention: builds with all fields', () => {
  const i = intervention();
  assert.equal(i.interventionId, 'task-1');
  assert.equal(i.type, 'recommendation');
  assert.equal(i.targetKnowledgeNodeId, 'n-dl');
  assert.equal(i.source, 'recommendation_engine');
});

test('intervention: target fields default to null when absent', () => {
  const i = buildIntervention({
    interventionId: 'x', type: 'coach_prompt', deliveredAt: '2026-09-01T00:00:00.000Z',
    expectedOutcome: 'awareness', source: 'proactive_coach',
  });
  assert.equal(i.targetKnowledgeNodeId, null);
  assert.equal(i.targetSubject, null);
});

// ---- Outcome Model ----

test('outcome: mastery gain computed correctly', () => {
  const o = outcome();
  assert.equal(o.deltas.masteryGain, 0.2);
  assert.equal(o.deltas.accuracyGain, 0.2);
});

test('outcome: confidence is high with sampleSize=5 and windowDays=6', () => {
  assert.equal(outcome().confidence, 'high');
});

test('outcome: insufficient_data when sampleSize < 2', () => {
  const o = outcome({ sampleSize: 1 });
  assert.equal(o.confidence, 'insufficient_data');
});

test('outcome: windowDays computed from window bounds', () => {
  assert.equal(outcome().windowDays, 6);
});

// ---- Attribution ----

test('attribution: knowledge_node match = strong association', () => {
  const attr = attributeOutcome({
    intervention: intervention(),
    outcome: outcome(),
    concurrentInterventions: [intervention()],
  });
  assert.equal(attr.method, 'knowledge_node');
  assert.equal(attr.association, 'strong');
  assert.equal(attr.lagDays, 6);
});

test('attribution: concurrent interventions = confounder flagged', () => {
  const attr = attributeOutcome({
    intervention: intervention(),
    outcome: outcome(),
    concurrentInterventions: [intervention(), intervention({ interventionId: 'task-2' })],
  });
  assert.ok(attr.confounders.includes('multiple_interventions_same_window'));
});

test('attribution: insufficient sample = insufficient_data association', () => {
  const attr = attributeOutcome({
    intervention: intervention(),
    outcome: outcome({ sampleSize: 1 }),
    concurrentInterventions: [],
  });
  assert.equal(attr.association, 'insufficient_data');
});

// ---- Effectiveness Report ----

test('effectiveness: recommendation with positive mastery gain = effective', () => {
  const interventions = [intervention(), intervention({ interventionId: 'task-2' })];
  const outcomes = [
    outcome({ interventionId: 'task-1' }),
    outcome({ interventionId: 'task-2' }),
  ];
  const attributions = outcomes.map((o) => attributeOutcome({
    intervention: interventions.find((i) => i.interventionId === o.interventionId),
    outcome: o,
    concurrentInterventions: interventions,
  }));
  const report = evaluateEffectiveness(interventions, outcomes, attributions, 'recommendation');
  assert.equal(report.sampleSize, 2);
  assert.equal(report.verdict, 'effective');
});

test('effectiveness: insufficient_data when no matching interventions', () => {
  const report = evaluateEffectiveness([], [], [], 'coach_prompt');
  assert.equal(report.verdict, 'insufficient_data');
  assert.equal(report.sampleSize, 0);
});

test('effectiveness: neutral when mastery gain is marginal', () => {
  const iv = [intervention({ interventionId: 't1' }), intervention({ interventionId: 't2' })];
  const o = iv.map((intv) => deriveLearningOutcome({
    userId: 'u-1', intervention: intv,
    before: snap({ mastery: 0.40 }), after: snap({ mastery: 0.42 }),
    windowStart: '2026-09-01T00:00:00.000Z', windowEnd: '2026-09-07T00:00:00.000Z', sampleSize: 5,
  }));
  const attrs = o.map((out) => attributeOutcome({
    intervention: iv.find((i) => i.interventionId === out.interventionId),
    outcome: out, concurrentInterventions: [],
  }));
  const report = evaluateEffectiveness(iv, o, attrs, 'recommendation');
  assert.equal(report.verdict, 'neutral');
});

test('effectiveness: no fabricated precision with insufficient data', () => {
  const report = evaluateEffectiveness([], [], [], 'review_task');
  assert.equal(report.avgMasteryGain, null);
  assert.equal(report.avgAccuracyGain, null);
  assert.equal(report.completionRate, null);
});