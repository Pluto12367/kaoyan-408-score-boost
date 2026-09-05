/**
 * V4-3 Learning Risk Detector tests (TDD RED first).
 *
 * Six risk types derived from LEARNING SIGNALS + context facts:
 *   knowledge_regression, repeated_mistake, review_debt, study_inactivity,
 *   overload, exam_risk.
 *
 * Evidence-based: severity/confidence are computed from signal evidence.
 * The LLM is never involved in risk determination.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { detectLearningRisks, RISK_TYPES } from '../apps/api/dist/adaptive/learning-risk.js';
import { deriveLearningSignals } from '../apps/api/dist/adaptive/learning-signals.js';

function signalsFrom(contextOverrides = {}, baseline) {
  const input = {
    asOf: '2026-09-07T08:00:00.000Z',
    mastery: {
      weakNodes: [
        { knowledgeNodeId: 'n-dl', title: '死锁必要条件', subject: 'OS', mastery: 0.32, attempts: 6, wrongCount: 5 },
        { knowledgeNodeId: 'n-sm', title: '信号量', subject: 'OS', mastery: 0.41, attempts: 8, wrongCount: 4 },
      ],
      improvingNodes: [{ knowledgeNodeId: 'n-tcp', title: 'TCP拥塞控制', subject: 'CN', mastery: 0.62, attempts: 8, wrongCount: 2 }],
      masteredNodes: [],
      ...contextOverrides.mastery,
    },
    practice: { recentAccuracy: { status: 'sufficient', value: 0.45 }, totalCount: 20, latestSubmittedAt: '2026-09-06T19:00:00.000Z', ...contextOverrides.practice },
    review: { dueCount: 5, overdueCount: 3, highRiskQuestions: [{ questionId: 'w-1', wrongCount: 5, overdue: true }], ...contextOverrides.review },
    plan: { completionRate: 0.3, openTaskCount: 4, ...contextOverrides.plan },
    momentum: { studyStreak: 6, isActiveToday: true, activeDaysLast7: 5, ...contextOverrides.momentum },
    baseline,
    ...contextOverrides.top,
  };
  return deriveLearningSignals(input);
}

test('RISK_TYPES exposes exactly the six risk types', () => {
  assert.deepEqual([...RISK_TYPES].sort(), [
    'knowledge_regression', 'repeated_mistake', 'review_debt', 'study_inactivity',
    'overload', 'exam_risk',
  ].sort());
});

test('risk: repeated mistake from wrong-streak signal with weak accuracy', () => {
  const risks = detectLearningRisks(signalsFrom({}));
  const risk = risks.find((r) => r.type === 'repeated_mistake');
  assert.ok(risk, 'repeated_mistake risk expected');
  assert.ok(['high', 'medium'].includes(risk.severity));
  assert.ok(risk.evidence.wrongStreakRatio >= 0.7 || risk.evidence.recentAccuracy < 0.5);
  assert.ok(risk.confidence >= 0.5);
  assert.match(risk.recommendation, /错因|复盘|对比/);
});

test('risk: review debt from overdue+due counts, high severity at heavy debt', () => {
  const risks = detectLearningRisks(signalsFrom({ review: { dueCount: 12, overdueCount: 6, highRiskQuestions: [] } }));
  const debt = risks.find((r) => r.type === 'review_debt');
  assert.ok(debt);
  assert.equal(debt.severity, 'high');
  assert.equal(debt.evidence.dueCount, 12);
  assert.equal(debt.evidence.overdueCount, 6);
});

test('risk: no review debt when due count is zero', () => {
  const risks = detectLearningRisks(signalsFrom({ review: { dueCount: 0, overdueCount: 0, highRiskQuestions: [] } }));
  assert.ok(!risks.some((r) => r.type === 'review_debt'));
});

test('risk: study inactivity from consistency warning', () => {
  const risks = detectLearningRisks(signalsFrom({
    momentum: { studyStreak: 0, isActiveToday: false, activeDaysLast7: 0 },
  }));
  const inactivity = risks.find((r) => r.type === 'study_inactivity');
  assert.ok(inactivity);
  assert.ok(inactivity.severity === 'high' || inactivity.severity === 'medium');
  assert.ok(inactivity.evidence.studyStreak === 0);
});

test('risk: overload from large open task count with low completion', () => {
  const risks = detectLearningRisks(signalsFrom({
    plan: { completionRate: 0.2, openTaskCount: 9 },
  }));
  const overload = risks.find((r) => r.type === 'overload');
  assert.ok(overload);
  assert.ok(overload.evidence.openTaskCount >= 8);
});

test('risk: exam risk from exam-performance warning signal', () => {
  const risks = detectLearningRisks(signalsFrom({
    top: { baseline: { capturedAt: '2026-09-01T00:00:00.000Z', nodeMastery: {}, exam: { lastScorePercent: 45, trend: 'down' } } },
  }));
  const examRisk = risks.find((r) => r.type === 'exam_risk');
  assert.ok(examRisk);
  assert.equal(examRisk.severity, 'high');
  assert.equal(examRisk.evidence.lastScorePercent, 45);
});

test('risk: knowledge regression from baseline drop signal', () => {
  const risks = detectLearningRisks(signalsFrom({
    top: { baseline: { capturedAt: '2026-09-01T00:00:00.000Z', nodeMastery: { 'n-dl': 0.6, 'n-sm': 0.6 } } },
  }));
  const regression = risks.find((r) => r.type === 'knowledge_regression');
  assert.ok(regression, 'regression risk expected when mastery dropped vs baseline');
  assert.ok(regression.evidence.regressedNodes.includes('n-dl') || regression.evidence.regressedNodes.includes('n-sm'));
});

test('risk: healthy student produces zero risks', () => {
  const risks = detectLearningRisks(signalsFrom({
    mastery: { weakNodes: [], improvingNodes: [{ knowledgeNodeId: 'n-ok', title: 'OK', subject: 'DS', mastery: 0.7, attempts: 6, wrongCount: 1 }], masteredNodes: [{ knowledgeNodeId: 'n-m', title: 'M', subject: 'DS', mastery: 0.9, attempts: 8, wrongCount: 0 }] },
    practice: { recentAccuracy: { status: 'sufficient', value: 0.85 }, totalCount: 30, latestSubmittedAt: '2026-09-06T20:00:00.000Z' },
    review: { dueCount: 1, overdueCount: 0, highRiskQuestions: [] },
    plan: { completionRate: 0.9, openTaskCount: 1 },
    momentum: { studyStreak: 10, isActiveToday: true, activeDaysLast7: 6 },
  }));
  assert.equal(risks.length, 0);
});

test('risk: deterministic (rebuildable) and sorted by severity then confidence', () => {
  const input = signalsFrom({});
  const a = detectLearningRisks(input);
  const b = detectLearningRisks(input);
  assert.deepEqual(a, b);
  for (let i = 1; i < a.length; i++) {
    const order = { high: 0, medium: 1, low: 2 };
    assert.ok(order[a[i - 1].severity] <= order[a[i].severity], 'sorted by severity');
  }
});