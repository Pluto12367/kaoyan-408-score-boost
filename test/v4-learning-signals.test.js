/**
 * V4-2 Learning Signal Engine tests.
 *
 * Eight signal kinds derived READ-ONLY from the canonical StudentContext
 * (plus an optional baseline for change/regression signals). Deterministic,
 * rebuildable, never a source of truth.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveLearningSignals,
  SIGNAL_KINDS,
} from '../apps/api/dist/adaptive/learning-signals.js';

function contextInput(overrides = {}) {
  return {
    asOf: '2026-09-07T08:00:00.000Z',
    mastery: {
      weakNodes: [
        { knowledgeNodeId: 'n-dl', title: '死锁必要条件', subject: 'OS', mastery: 0.32, attempts: 6, wrongCount: 4 },
        { knowledgeNodeId: 'n-sm', title: '信号量', subject: 'OS', mastery: 0.41, attempts: 10, wrongCount: 5 },
      ],
      improvingNodes: [
        { knowledgeNodeId: 'n-tcp', title: 'TCP拥塞控制', subject: 'CN', mastery: 0.62, attempts: 8, wrongCount: 2 },
      ],
      masteredNodes: [
        { knowledgeNodeId: 'n-list', title: '顺序表', subject: 'DS', mastery: 0.92, attempts: 12, wrongCount: 1 },
      ],
    },
    practice: {
      recentAccuracy: { status: 'sufficient', value: 0.72 },
      totalCount: 24,
      latestSubmittedAt: '2026-09-06T19:00:00.000Z',
    },
    review: { dueCount: 3, overdueCount: 1, highRiskQuestions: [{ questionId: 'w-1', wrongCount: 4, overdue: true }] },
    plan: { completionRate: 0.6, openTaskCount: 2 },
    momentum: { studyStreak: 5, isActiveToday: true, activeDaysLast7: 5 },
    ...overrides,
  };
}

test('SIGNAL_KINDS exposes exactly the eight mission signal kinds', () => {
  assert.deepEqual([...SIGNAL_KINDS].sort(), [
    'accuracy_trend', 'exam_performance', 'knowledge_regression', 'mastery_change',
    'review_overdue', 'study_consistency', 'task_completion', 'wrong_streak',
  ].sort());
});

test('signals: accuracy trend derived from practice facts', () => {
  const signals = deriveLearningSignals(contextInput());
  const accuracy = signals.find((s) => s.kind === 'accuracy_trend');
  assert.ok(accuracy);
  assert.equal(accuracy.present, true);
  assert.equal(accuracy.severity, 'info');
  assert.equal(accuracy.evidence.recentAccuracy, 0.72);
});

test('signals: review overdue fires with overdue count evidence', () => {
  const signals = deriveLearningSignals(contextInput());
  const overdue = signals.find((s) => s.kind === 'review_overdue');
  assert.ok(overdue);
  assert.equal(overdue.present, true);
  assert.equal(overdue.severity, 'warning');
  assert.equal(overdue.evidence.overdueCount, 1);
  assert.equal(overdue.evidence.dueCount, 3);
});

test('signals: study consistency flags inactivity when streak broken', () => {
  const signals = deriveLearningSignals(contextInput({
    momentum: { studyStreak: 0, isActiveToday: false, activeDaysLast7: 1 },
    practice: { recentAccuracy: { status: 'insufficient_data', value: null }, totalCount: 2, latestSubmittedAt: '2026-08-20T00:00:00.000Z' },
  }));
  const consistency = signals.find((s) => s.kind === 'study_consistency');
  assert.ok(consistency);
  assert.equal(consistency.present, true);
  assert.equal(consistency.severity, 'warning');
});

test('signals: task completion below threshold is flagged', () => {
  const signals = deriveLearningSignals(contextInput({
    plan: { completionRate: 0.15, openTaskCount: 4 },
  }));
  const completion = signals.find((s) => s.kind === 'task_completion');
  assert.ok(completion);
  assert.equal(completion.present, true);
  assert.equal(completion.severity, 'warning');
});

test('signals: wrong streak derived from high wrong ratio and risk questions', () => {
  const signals = deriveLearningSignals(contextInput({
    mastery: {
      weakNodes: [{ knowledgeNodeId: 'n-x', title: 'X', subject: 'OS', mastery: 0.3, attempts: 6, wrongCount: 5 }],
      improvingNodes: [], masteredNodes: [],
    },
    review: { dueCount: 1, overdueCount: 0, highRiskQuestions: [{ questionId: 'w-9', wrongCount: 5, overdue: false }] },
  }));
  const streak = signals.find((s) => s.kind === 'wrong_streak');
  assert.ok(streak);
  assert.equal(streak.present, true);
  assert.ok(streak.evidence.weakWrongRatio >= 0.8);
});

test('signals: mastery change and regression require a baseline; absent baseline degrades gracefully', () => {
  const noBaseline = deriveLearningSignals(contextInput());
  for (const kind of ['mastery_change', 'knowledge_regression']) {
    const signal = noBaseline.find((s) => s.kind === kind);
    assert.ok(signal);
    assert.equal(signal.present, false);
    assert.equal(signal.evidence.reason, 'no_baseline');
  }
  const baseline = deriveLearningSignals(contextInput({
    baseline: {
      capturedAt: '2026-09-01T00:00:00.000Z',
      nodeMastery: { 'n-dl': 0.55, 'n-tcp': 0.5 },
    },
  }));
  const change = baseline.find((s) => s.kind === 'mastery_change');
  assert.ok(change);
  assert.equal(change.present, true);
  assert.equal(change.evidence.direction, 'down');
  const regression = baseline.find((s) => s.kind === 'knowledge_regression');
  assert.ok(regression);
  assert.equal(regression.present, true);
  assert.equal(regression.severity, 'critical');
});

test('signals: exam performance surfaces when baseline carries it', () => {
  const without = deriveLearningSignals(contextInput());
  assert.equal(without.find((s) => s.kind === 'exam_performance')?.present, false);
  const withExam = deriveLearningSignals(contextInput({
    baseline: {
      capturedAt: '2026-09-01T00:00:00.000Z',
      nodeMastery: {},
      exam: { lastScorePercent: 55, trend: 'down' },
    },
  }));
  const exam = withExam.find((s) => s.kind === 'exam_performance');
  assert.ok(exam);
  assert.equal(exam.present, true);
  assert.equal(exam.severity, 'warning');
});

test('signals: deterministic for identical input (rebuildable)', () => {
  const input = contextInput();
  assert.deepEqual(deriveLearningSignals(input), deriveLearningSignals(input));
});