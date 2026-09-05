/**
 * V4-7 Adaptive Review + V4-8 Personalized Practice tests.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveAdaptiveReviewInterval,
  selectNextPractice,
} from '../apps/api/dist/adaptive/adaptive-review.js';

// ---- adaptive review interval ----

test('review interval: weak mastery shortens the engine base interval', () => {
  const rec = deriveAdaptiveReviewInterval({ stabilityDays: 4, mastery: 0.3, attempts: 6, wrongCount: 4, overdueCount: 0, wrongStreakRisk: false });
  assert.equal(rec.intervalDays, 3, '4 × 0.7 = 2.8 → quantized to 0.5 steps = 3.0');
  assert.match(rec.reason, /缩短间隔/);
});

test('review interval: strong mastery extends up to the 14-day cap', () => {
  const rec = deriveAdaptiveReviewInterval({ stabilityDays: 12, mastery: 0.8, attempts: 10, wrongCount: 1, overdueCount: 0, wrongStreakRisk: false });
  assert.equal(rec.intervalDays, 14);
  assert.match(rec.reason, /延长间隔/);
});

test('review interval: wrong-streak risk tightens spacing by 0.8×', () => {
  const rec = deriveAdaptiveReviewInterval({ stabilityDays: 5, mastery: 0.5, attempts: 6, wrongCount: 4, overdueCount: 0, wrongStreakRisk: true });
  assert.equal(rec.intervalDays, 4, '5 × 0.8');
  assert.match(rec.reason, /连错风险/);
});

test('review interval: overdue debt tightens spacing by 0.85×', () => {
  const rec = deriveAdaptiveReviewInterval({ stabilityDays: 4, mastery: 0.5, attempts: 4, wrongCount: 1, overdueCount: 2, wrongStreakRisk: false });
  assert.equal(rec.intervalDays, 3.5, '4 × 0.85');
  assert.match(rec.reason, /逾期/);
});

test('review interval: intensity follows mastery/wrong-ratio/overdue evidence', () => {
  const intensive = deriveAdaptiveReviewInterval({ stabilityDays: 2, mastery: 0.3, attempts: 6, wrongCount: 4, overdueCount: 3, wrongStreakRisk: false });
  assert.equal(intensive.intensity, 'intensive');
  const light = deriveAdaptiveReviewInterval({ stabilityDays: 8, mastery: 0.8, attempts: 10, wrongCount: 1, overdueCount: 0, wrongStreakRisk: false });
  assert.equal(light.intensity, 'light');
  const standard = deriveAdaptiveReviewInterval({ stabilityDays: 4, mastery: 0.5, attempts: 4, wrongCount: 1, overdueCount: 0, wrongStreakRisk: false });
  assert.equal(standard.intensity, 'standard');
});

test('review interval: deterministic', () => {
  const input = { stabilityDays: 4, mastery: 0.3, attempts: 6, wrongCount: 4, overdueCount: 0, wrongStreakRisk: false };
  assert.deepEqual(deriveAdaptiveReviewInterval(input), deriveAdaptiveReviewInterval(input));
});

// ---- personalized practice selection ----

test('practice selection: prefers questions in the productive mastery zone', () => {
  const selection = selectNextPractice([
    { questionId: 'q-easy', knowledgeNodeId: 'n1', difficulty: 'BASIC' },
    { questionId: 'q-mid', knowledgeNodeId: 'n2', difficulty: 'MEDIUM' },
    { questionId: 'q-hard', knowledgeNodeId: 'n3', difficulty: 'HARD' },
  ], new Map([['n1', 0.3], ['n2', 0.5], ['n3', 0.9]]));
  assert.equal(selection?.questionId, 'q-easy', 'first in-zone candidate (BASIC at 0.3 mastery) wins the productive-zone tie-break');
});

test('practice selection: excluded questions are skipped', () => {
  const selection = selectNextPractice([
    { questionId: 'q-done', knowledgeNodeId: 'n1', difficulty: 'MEDIUM' },
    { questionId: 'q-next', knowledgeNodeId: 'n1', difficulty: 'MEDIUM' },
  ], new Map(), new Set(['q-done']));
  assert.equal(selection?.questionId, 'q-next');
});

test('practice selection: returns null when all candidates excluded', () => {
  const selection = selectNextPractice([
    { questionId: 'q-done', knowledgeNodeId: 'n1', difficulty: 'MEDIUM' },
  ], new Map(), new Set(['q-done']));
  assert.equal(selection, null);
});

test('practice selection: unknown mastery gets neutral fitness', () => {
  const selection = selectNextPractice([
    { questionId: 'q-unknown', knowledgeNodeId: 'n9', difficulty: 'HARD' },
    { questionId: 'q-known', knowledgeNodeId: 'n1', difficulty: 'MEDIUM' },
  ], new Map([['n1', 0.5]]));
  // known 0.5 mastery in MEDIUM zone (0.35-0.7) fits=1 beats unknown 0.5
  assert.equal(selection?.questionId, 'q-known');
});