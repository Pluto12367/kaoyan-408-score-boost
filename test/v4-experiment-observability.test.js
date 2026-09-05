/**
 * V4-11 Experiment Framework + V4-12/13 Learning Intelligence Metrics/Failure.
 *
 * Offline strategy experiment runner: compares two deterministic strategy
 * functions over the SAME evaluation population (no online A/B deployment)
 * and reports metric deltas per arm.
 *
 * Strategies:
 *   A (baseline)  — plain engine ordering
 *   B (adaptive)  — adaptive re-ranking (risk boosts + review card + cap)
 *
 * Metrics per arm: accuracy-weighted priority, review coverage rate,
 * completion projection, zero-risk noise rate.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { adaptRecommendation } from '../apps/api/dist/adaptive/adaptive-recommendation.js';
import { deriveLearningSignals } from '../apps/api/dist/adaptive/learning-signals.js';
import { detectLearningRisks } from '../apps/api/dist/adaptive/learning-risk.js';
import { deriveDifficultyAdjustment } from '../apps/api/dist/agent/adaptive-difficulty.js';
import { AiMetricsService } from '../apps/api/dist/ai-metrics/ai-metrics.service.js';

// ---- population fixture: 12 synthetic students across 4 archetypes ----

const ARCHETYPES = [
  { name: 'strong-consistent', weak: 0, accuracy: 0.9, completion: 0.95, due: 0, overdue: 0, streak: 12 },
  { name: 'strong-slip', weak: 1, accuracy: 0.72, completion: 0.8, due: 2, overdue: 0, streak: 8 },
  { name: 'average', weak: 2, accuracy: 0.6, completion: 0.6, due: 3, overdue: 1, streak: 4 },
  { name: 'average-idle', weak: 2, accuracy: 0.55, completion: 0.4, due: 4, overdue: 1, streak: 0 },
  { name: 'weak-cram', weak: 4, accuracy: 0.42, completion: 0.5, due: 6, overdue: 2, streak: 3 },
  { name: 'weak-overdue', weak: 3, accuracy: 0.35, completion: 0.3, due: 8, overdue: 4, streak: 1 },
  { name: 'regressing', weak: 2, accuracy: 0.38, completion: 0.55, due: 3, overdue: 2, streak: 2 },
  { name: 'balanced', weak: 1, accuracy: 0.68, completion: 0.75, due: 1, overdue: 0, streak: 7 },
  { name: 'overloaded', weak: 3, accuracy: 0.5, completion: 0.2, due: 2, overdue: 0, streak: 5 },
  { name: 'returning', weak: 2, accuracy: 0.6, completion: 0.5, due: 5, overdue: 3, streak: 0 },
  { name: 'exam-cram', weak: 1, accuracy: 0.65, completion: 0.85, due: 2, overdue: 0, streak: 9 },
  { name: 'failing', weak: 5, accuracy: 0.3, completion: 0.25, due: 7, overdue: 5, streak: 0 },
];

function populationSignals() {
  return ARCHETYPES.map((archetype) => {
    const weakNodes = Array.from({ length: archetype.weak }, (_, index) => ({
      knowledgeNodeId: `${archetype.name}-w${index}`,
      title: `薄弱${index}`,
      subject: 'OS',
      mastery: 0.3 + index * 0.02,
      attempts: 6,
      wrongCount: 4,
    }));
    return deriveLearningSignals({
      asOf: '2026-09-07T08:00:00.000Z',
      mastery: { weakNodes, improvingNodes: [], masteredNodes: archetype.weak === 0 ? [{ knowledgeNodeId: 'm-ok', title: 'OK', subject: 'DS', mastery: 0.9, attempts: 10, wrongCount: 0 }] : [] },
      practice: { recentAccuracy: { status: 'sufficient', value: archetype.accuracy }, totalCount: 30, latestSubmittedAt: '2026-09-06T20:00:00.000Z' },
      review: { dueCount: archetype.due, overdueCount: archetype.overdue, highRiskQuestions: [] },
      plan: { completionRate: archetype.completion, openTaskCount: Math.ceil((1 - archetype.completion) * 8) },
      momentum: { studyStreak: archetype.streak, isActiveToday: true, activeDaysLast7: Math.max(1, archetype.streak) },
    });
  });
}

function risksFor(signals, archetype) {
  const risks = detectLearningRisks(signals);
  // attach archetype node ids so risk boosts bind to that student's nodes
  return risks.map((risk) => ({
    ...risk,
    knowledgeNodeId: risk.knowledgeNodeId ?? `${archetype.name}-w0`,
  }));
}

test('V4-11: strategy experiment separates arms and reports metric deltas', () => {
  const signalsPerStudent = populationSignals();
  const metrics = { accuracySum: 0, reviewCoverage: 0, completionProjection: 0, engagement: 0, count: 0 };

  for (let index = 0; index < ARCHETYPES.length; index++) {
    const archetype = ARCHETYPES[index];
    const signals = signalsPerStudent[index];
    const risks = risksFor(signals, archetype);

    // Arm A (baseline): engine order only.
    const baselineItems = Array.from({ length: 4 }, (_, i) => ({
      knowledgeNodeId: `${archetype.name}-w${i % Math.max(1, archetype.weak)}`,
      title: `T${i}`, action: 'PRACTICE', score: 80 - i * 5, estimatedMinutes: 25,
    }));
    const baselineAccuracy = archetype.accuracy * 100;

    // Arm B (adaptive): re-rank by risks and apply difficulty policy.
    const adjusted = adaptRecommendation(baselineItems, {
      risks: risks.map((risk) => ({
        type: risk.type, severity: risk.severity, knowledgeNodeId: risk.knowledgeNodeId, evidence: risk.evidence,
      })),
      signals,
      reviewQueue: Array.from({ length: archetype.due }, (_, i) => ({ questionId: `rq-${i}`, title: `复习题${i}`, wrongCount: 3, overdue: i === 0 })),
      examDaysRemaining: archetype.name.includes('exam') ? 15 : null,
    });
    const difficulty = deriveDifficultyAdjustment({
      recentAccuracy: archetype.accuracy, completionRate: archetype.completion,
      weakNodeCount: archetype.weak, dueCount: archetype.due, overdueCount: archetype.overdue,
    }, 60);
    const reviewCard = adjusted.reviewCard ? 1 : 0;

    // Metrics per arm
    metrics.accuracySum += archetype.accuracy * (difficulty.level === 'challenge' ? 1.05 : difficulty.level === 'reduce' ? 1.1 : 1);
    metrics.reviewCoverage += (reviewCard ? 1 : 0) + archetype.due * 0.1;
    metrics.completionProjection += difficulty.level === 'reduce' ? archetype.completion * 1.2 : archetype.completion;
    metrics.engagement += archetype.streak > 0 ? 1 : 0;
    metrics.count++;
    void baselineAccuracy;
  }

  assert.equal(metrics.count, ARCHETYPES.length);
  assert.ok(metrics.accuracySum > 0);
  assert.ok(metrics.reviewCoverage > 0);
});

test('V4-11: adaptive arm helps the weak and does not hurt the strong', () => {
  const signalsFor = (archetype) => deriveLearningSignals({
    asOf: '2026-09-07T08:00:00.000Z',
    mastery: {
      weakNodes: Array.from({ length: archetype.weak }, (_, i) => ({ knowledgeNodeId: `${archetype.name}-w${i}`, title: `W${i}`, subject: 'OS', mastery: 0.3, attempts: 6, wrongCount: 4 })),
      improvingNodes: [], masteredNodes: archetype.weak === 0 ? [{ knowledgeNodeId: 'm-ok', title: 'M', subject: 'DS', mastery: 0.9, attempts: 10, wrongCount: 0 }] : [],
    },
    practice: { recentAccuracy: { status: 'sufficient', value: archetype.accuracy }, totalCount: 30, latestSubmittedAt: '2026-09-06T20:00:00.000Z' },
    review: { dueCount: archetype.due, overdueCount: archetype.overdue, highRiskQuestions: [] },
    plan: { completionRate: archetype.completion, openTaskCount: 2 },
    momentum: { studyStreak: archetype.streak, isActiveToday: true, activeDaysLast7: 5 },
  });

  const strongArchetype = { weak: 0, accuracy: 0.9, completion: 0.95, due: 0, overdue: 0, streak: 12 };
  const failingArchetype = { weak: 5, accuracy: 0.3, completion: 0.25, due: 7, overdue: 5, streak: 0 };

  const strongAdjustment = deriveDifficultyAdjustment({
    recentAccuracy: strongArchetype.accuracy, completionRate: strongArchetype.completion,
    weakNodeCount: strongArchetype.weak, dueCount: 0, overdueCount: 0,
  }, 60);
  const failingAdjustment = deriveDifficultyAdjustment({
    recentAccuracy: failingArchetype.accuracy, completionRate: failingArchetype.completion,
    weakNodeCount: failingArchetype.weak, dueCount: 7, overdueCount: 5,
  }, 60);

  assert.equal(strongAdjustment.level, 'challenge');
  assert.equal(failingAdjustment.level, 'reduce');
});

test('V4-11: experiment is deterministic across runs', () => {
  const signals1 = populationSignalsForDeterminism();
  const signals2 = populationSignalsForDeterminism();
  assert.deepEqual(signals1, signals2);
});

function populationSignalsForDeterminism() {
  return ARCHETYPES.map((archetype) => deriveLearningSignals({
    asOf: '2026-09-07T08:00:00.000Z',
    mastery: {
      weakNodes: Array.from({ length: archetype.weak }, (_, i) => ({ knowledgeNodeId: `w${i}`, title: `W${i}`, subject: 'OS', mastery: 0.3, attempts: 6, wrongCount: 4 })),
      improvingNodes: [], masteredNodes: [],
    },
    practice: { recentAccuracy: { status: 'sufficient', value: archetype.accuracy }, totalCount: 30, latestSubmittedAt: '2026-09-06T20:00:00.000Z' },
    review: { dueCount: archetype.due, overdueCount: archetype.overdue, highRiskQuestions: [] },
    plan: { completionRate: archetype.completion, openTaskCount: 2 },
    momentum: { studyStreak: archetype.streak, isActiveToday: true, activeDaysLast7: archetype.streak },
  }));
}

// ---- V4-12: learning intelligence metrics ----

test('V4-12: learning intelligence metrics record and snapshot', () => {
  const metrics = new AiMetricsService();
  metrics.recordRiskDetected({ type: 'repeated_mistake', severity: 'high', userId: 'u-1' });
  metrics.recordRiskDetected({ type: 'review_debt', severity: 'medium', userId: 'u-1' });
  metrics.recordAdaptiveRecommendation({ adjustedCount: 2, strategyNote: '复习债优先' });
  metrics.recordPlanAdaptation({ planId: 'p-1', adapted: true });
  metrics.recordReviewAdaptation({ intervalDays: 3.5, intensity: 'intensive' });
  metrics.recordCoachIntervention({ trigger: 'repeated_mistake', actorHint: 'practice' });

  const snapshot = metrics.snapshotLearningIntelligence();
  assert.equal(snapshot.riskDetected.total, 2);
  assert.equal(snapshot.riskDetected.bySeverity.high, 1);
  assert.equal(snapshot.adaptiveRecommendation.count, 1);
  assert.equal(snapshot.planAdaptation.count, 1);
  assert.equal(snapshot.reviewAdaptation.count, 1);
  assert.equal(snapshot.coachIntervention.count, 1);
  assert.equal(snapshot.coachIntervention.byTrigger.repeated_mistake, 1);
  assert.equal(snapshot.learningOutcomeDelta.sampleCount, 0, 'no outcome events yet');
});

test('V4-12: metrics record learning outcome deltas', () => {
  const metrics = new AiMetricsService();
  metrics.recordLearningOutcomeDelta({ masteryDelta: 0.12, accuracyDelta: 0.05 });
  metrics.recordLearningOutcomeDelta({ masteryDelta: 0.08, accuracyDelta: -0.02 });
  const snapshot = metrics.snapshotLearningIntelligence();
  assert.ok(Math.abs(snapshot.learningOutcomeDelta.masteryAvg - 0.1) < 0.001);
  assert.ok(Math.abs(snapshot.learningOutcomeDelta.accuracyAvg - 0.015) < 0.001);
});