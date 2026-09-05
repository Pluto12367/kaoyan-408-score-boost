/**
 * V4-4 Adaptive Recommendation Layer tests.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { adaptRecommendation } from '../apps/api/dist/adaptive/adaptive-recommendation.js';

const ITEMS = [
  { knowledgeNodeId: 'n-a', title: '节点A', action: 'PRACTICE', score: 70, estimatedMinutes: 30 },
  { knowledgeNodeId: 'n-b', title: '节点B', action: 'LEARN', score: 65, estimatedMinutes: 40 },
  { knowledgeNodeId: 'n-c', title: '节点C', action: 'REVIEW', score: 60, estimatedMinutes: 20 },
];

function facts(overrides = {}) {
  return {
    risks: [],
    signals: [],
    reviewQueue: [],
    examDaysRemaining: null,
    ...overrides,
  };
}

test('no risks: engine order preserved, no adjustments', () => {
  const view = adaptRecommendation(ITEMS, facts());
  assert.deepEqual(view.items.map((item) => item.knowledgeNodeId), ['n-a', 'n-b', 'n-c']);
  assert.equal(view.reviewCard, null);
  assert.equal(view.loadCapApplied, false);
  assert.match(view.strategyNote, /按引擎排序透传/);
});

test('high-risk node boosts to the top with audit trail', () => {
  const view = adaptRecommendation(ITEMS, facts({
    risks: [{ type: 'repeated_mistake', severity: 'high', knowledgeNodeId: 'n-c', evidence: { wrongStreakRatio: 0.85 } }],
  }));
  assert.equal(view.items[0].knowledgeNodeId, 'n-c', 'risk node should jump ahead of higher-scored items');
  assert.ok(view.items[0].adjustedScore > view.items[1].adjustedScore);
  assert.ok(view.items[0].adjustments.some((entry) => entry.startsWith('risk_boost:repeated_mistake:high')));
});

test('review debt injects a review card with the top queue question', () => {
  const view = adaptRecommendation(ITEMS, facts({
    risks: [{ type: 'review_debt', severity: 'medium', knowledgeNodeId: null, evidence: { dueCount: 5, overdueCount: 2 } }],
    reviewQueue: [{ questionId: 'w-1', title: '错题1', wrongCount: 4, overdue: true }],
  }));
  assert.ok(view.reviewCard);
  assert.equal(view.reviewCard.dueCount, 5);
  assert.equal(view.reviewCard.overdueCount, 2);
  assert.equal(view.reviewCard.topQuestion.questionId, 'w-1');
  assert.match(view.strategyNote, /复习债优先/);
});

test('overload risk caps the item budget to 3', () => {
  const many = Array.from({ length: 8 }, (_, index) => ({
    knowledgeNodeId: `n-${index}`, title: `T${index}`, action: 'PRACTICE', score: 90 - index, estimatedMinutes: 20,
  }));
  const view = adaptRecommendation(many, facts({
    risks: [{ type: 'overload', severity: 'medium', knowledgeNodeId: null, evidence: { openTaskCount: 9 } }],
  }));
  assert.equal(view.items.length, 3);
  assert.equal(view.loadCapApplied, true);
});

test('exam proximity within 30 days adds urgency boost', () => {
  const view = adaptRecommendation(ITEMS, facts({ examDaysRemaining: 20 }));
  assert.ok(view.items.every((item) => item.adjustedScore === item.score + 5));
  assert.match(view.strategyNote, /考前 20 天/);
});

test('deterministic output', () => {
  const f = facts({ risks: [{ type: 'review_debt', severity: 'medium', knowledgeNodeId: null, evidence: { dueCount: 4, overdueCount: 1 } }] });
  assert.deepEqual(adaptRecommendation(ITEMS, f), adaptRecommendation(ITEMS, f));
});