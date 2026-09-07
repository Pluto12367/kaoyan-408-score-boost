/**
 * V4-6 Proactive Coach tests.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveProactiveInterventions } from '../apps/api/dist/adaptive/proactive-coach.js';
import { detectLearningRisks } from '../apps/api/dist/adaptive/learning-risk.js';
import { deriveLearningSignals } from '../apps/api/dist/adaptive/learning-signals.js';

function risksFrom(contextOverrides = {}, baseline) {
  const input = {
    asOf: '2026-09-07T08:00:00.000Z',
    mastery: {
      weakNodes: [
        { knowledgeNodeId: 'n-dl', title: '死锁必要条件', subject: 'OS', mastery: 0.32, attempts: 6, wrongCount: 5 },
      ],
      improvingNodes: [],
      masteredNodes: [],
      ...contextOverrides.mastery,
    },
    practice: { recentAccuracy: { status: 'sufficient', value: 0.45 }, totalCount: 20, latestSubmittedAt: '2026-09-06T19:00:00.000Z', ...contextOverrides.practice },
    review: { dueCount: 6, overdueCount: 2, highRiskQuestions: [{ questionId: 'w-1', wrongCount: 5, overdue: true }], ...contextOverrides.review },
    plan: { completionRate: 0.3, openTaskCount: 4, ...contextOverrides.plan },
    momentum: { studyStreak: 6, isActiveToday: true, activeDaysLast7: 5, ...contextOverrides.momentum },
    baseline,
    ...contextOverrides.top,
  };
  const signals = deriveLearningSignals(input);
  return detectLearningRisks(signals);
}

test('proactive: repeated mistake risk produces a practice-oriented intervention', () => {
  const risks = risksFrom({});
  const interventions = deriveProactiveInterventions({ signals: [], risks, asOf: '2026-09-07' });
  const intervention = interventions.find((i) => i.trigger === 'repeated_mistake');
  assert.ok(intervention);
  assert.equal(intervention.actorHint, 'practice');
  assert.ok(intervention.actions.length >= 2);
  assert.match(intervention.id, /^repeated_mistake-2026-09-07-/);
});

test('proactive: review debt intervention routes to the review queue', () => {
  const risks = risksFrom({ review: { dueCount: 9, overdueCount: 3, highRiskQuestions: [] } });
  const interventions = deriveProactiveInterventions({ signals: [], risks, asOf: '2026-09-07' });
  const review = interventions.find((i) => i.trigger === 'review_debt');
  assert.ok(review);
  assert.equal(review.actorHint, 'review');
  assert.match(review.headline, /3 项复习已逾期/);
});

test('proactive: inactivity intervention routes to the plan (light restart)', () => {
  const risks = risksFrom({ momentum: { studyStreak: 0, isActiveToday: false, activeDaysLast7: 0 } });
  const interventions = deriveProactiveInterventions({ signals: [], risks, asOf: '2026-09-07' });
  const inactivity = interventions.find((i) => i.trigger === 'study_inactivity');
  assert.ok(inactivity);
  assert.equal(inactivity.actorHint, 'plan');
});

test('proactive: regression is critical and routes to coach explanation', () => {
  const risks = risksFrom({
    top: { baseline: { capturedAt: '2026-09-01T00:00:00.000Z', nodeMastery: { 'n-dl': 0.6 } } },
  });
  const interventions = deriveProactiveInterventions({ signals: [], risks, asOf: '2026-09-07' });
  const regression = interventions.find((i) => i.trigger === 'knowledge_regression');
  assert.ok(regression);
  assert.equal(regression.severity, 'high');
  assert.equal(regression.knowledgeNodeId, 'n-dl');
});

test('proactive: healthy state produces no interventions', () => {
  const risks = risksFrom({
    mastery: { weakNodes: [], improvingNodes: [], masteredNodes: [{ knowledgeNodeId: 'n-m', title: 'M', subject: 'DS', mastery: 0.9, attempts: 8, wrongCount: 0 }] },
    practice: { recentAccuracy: { status: 'sufficient', value: 0.88 }, totalCount: 30, latestSubmittedAt: '2026-09-06T20:00:00.000Z' },
    review: { dueCount: 0, overdueCount: 0, highRiskQuestions: [] },
    plan: { completionRate: 0.95, openTaskCount: 1 },
    momentum: { studyStreak: 12, isActiveToday: true, activeDaysLast7: 6 },
  });
  assert.equal(deriveProactiveInterventions({ signals: [], risks, asOf: '2026-09-07' }).length, 0);
});

test('proactive: deterministic output sorted by severity', () => {
  const risks = risksFrom({});
  const a = deriveProactiveInterventions({ signals: [], risks, asOf: '2026-09-07' });
  const b = deriveProactiveInterventions({ signals: [], risks, asOf: '2026-09-07' });
  assert.deepEqual(a, b);
  for (let i = 1; i < a.length; i++) {
    const order = { high: 0, medium: 1, low: 2 };
    assert.ok(order[a[i - 1].severity] <= order[a[i].severity]);
  }
});
test('V9 production fix: repeated-mistake headline shows the real wrong ratio, never 0%', () => {
  // The risk layer renames the signal's weakWrongRatio → wrongStreakRatio.
  // The headline must read the renamed key — a 0% ratio next to a high
  // severity flag is self-contradictory (caught live in production smoke).
  const risks = risksFrom({});
  const repeated = risks.find((risk) => risk.type === 'repeated_mistake');
  assert.ok(repeated, 'fixture should surface a repeated_mistake risk');
  const ratio = repeated.evidence.wrongStreakRatio;
  assert.ok(ratio > 0, 'fixture should have a real ratio');

  const interventions = deriveProactiveInterventions({ signals: [], risks, asOf: '2026-09-07' });
  const intervention = interventions.find((i) => i.trigger === 'repeated_mistake');
  const expectedPct = Math.round(ratio * 100);
  assert.match(intervention.headline, new RegExp(`错误占比 ${expectedPct}%`));
  assert.doesNotMatch(intervention.headline, /错误占比 0%/);
});
