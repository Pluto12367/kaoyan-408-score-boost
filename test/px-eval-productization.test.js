/**
 * PX Productization Evaluation Suite.
 *
 * Metrics-as-assertions across the four product surfaces:
 * - planner: feasibility (budget), workload balance (task size), mastery alignment
 * - exam generator: knowledge coverage, difficulty accuracy
 * - tutor: misconception detection accuracy
 * - coach: personalization (three student profiles differ)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { validatePlan } from '../apps/api/dist/agent/plan-validator.js';
import { buildExamPaper } from '../apps/api/dist/agent/exam-simulator.js';
import { detectMisconceptions, buildLayeredExplanation } from '../apps/api/dist/agent/tutor-mode.js';
import { buildPersonalizedPromptSections } from '../apps/api/dist/study/coach-session.js';

test('planner feasibility: plan always fits the budget and caps task size', () => {
  const drafts = [
    { knowledgeNodeId: 'n1', title: 'A', action: 'LEARN', score: 95, estimatedMinutes: 50 },
    { knowledgeNodeId: 'n2', title: 'B', action: 'PRACTICE', score: 90, estimatedMinutes: 50 },
    { knowledgeNodeId: 'n3', title: 'C', action: 'REVIEW', score: 85, estimatedMinutes: 50 },
    { knowledgeNodeId: 'n4', title: 'D', action: 'WRONG_QUESTION', score: 80, estimatedMinutes: 50 },
  ];
  const result = validatePlan({ items: drafts, availableMinutes: 120, masteredNodeIds: [] });
  assert.ok(result.totalMinutes <= 120, `totalMinutes ${result.totalMinutes} exceeds budget`);
  for (const item of result.validItems) {
    assert.ok(item.estimatedMinutes <= 90, 'no single task may exceed 90 minutes');
  }
});

test('planner workload balance: valid plan has no duplicate nodes and reasonable count', () => {
  const drafts = Array.from({ length: 8 }, (_, index) => ({
    knowledgeNodeId: `n${index % 4}`, title: `T${index}`, action: 'PRACTICE', score: 90 - index, estimatedMinutes: 20,
  }));
  const result = validatePlan({ items: drafts, availableMinutes: 180, masteredNodeIds: [] });
  const nodes = result.validItems.map((item) => item.knowledgeNodeId);
  assert.equal(new Set(nodes).size, nodes.length, 'duplicates must be removed');
  assert.ok(result.validItems.length >= 2 && result.validItems.length <= 8);
});

test('planner mastery alignment: mastered nodes never appear in the final plan', () => {
  const result = validatePlan({
    items: [
      { knowledgeNodeId: 'weak-1', title: '弱项', action: 'LEARN', score: 90, estimatedMinutes: 30 },
      { knowledgeNodeId: 'mastered-1', title: '已掌握', action: 'LEARN', score: 99, estimatedMinutes: 30 },
    ],
    availableMinutes: 120,
    masteredNodeIds: ['mastered-1'],
  });
  assert.ok(!result.validItems.some((item) => item.knowledgeNodeId === 'mastered-1'));
});

test('exam knowledge coverage: paper spans distinct points up to the slot budget', () => {
  const points = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
  const candidates = points.flatMap((point) => [
    { id: `${point}-a`, stem: 's', type: 'SINGLE_CHOICE', difficulty: 'BASIC', knowledgePointIds: [point], subject: 'OS' },
    { id: `${point}-b`, stem: 's', type: 'SINGLE_CHOICE', difficulty: 'HARD', knowledgePointIds: [point], subject: 'OS' },
  ]);
  const paper = buildExamPaper(candidates, { targetCount: 6, subject: 'OS' });
  assert.equal(paper.questions.length, 6);
  assert.ok(paper.coveragePoints.length >= 6, `coverage ${paper.coveragePoints.length} should span all 6 points`);
});

test('exam difficulty accuracy: weak mastery yields more BASIC than HARD; strong the inverse', () => {
  const candidates = [
    { id: 'basic', stem: 's', type: 'SINGLE_CHOICE', difficulty: 'BASIC', knowledgePointIds: ['p1'], subject: 'OS' },
    { id: 'hard', stem: 's', type: 'SINGLE_CHOICE', difficulty: 'HARD', knowledgePointIds: ['p1'], subject: 'OS' },
  ];
  const weakPaper = buildExamPaper(candidates, { targetCount: 1, masteryByPoint: new Map([['p1', 0.3]]) });
  const strongPaper = buildExamPaper(candidates, { targetCount: 1, masteryByPoint: new Map([['p1', 0.9]]) });
  assert.equal(weakPaper.questions[0].difficulty, 'BASIC');
  assert.equal(strongPaper.questions[0].difficulty, 'HARD');
});

test('tutor misconception detection: dominant pattern follows evidence weight', () => {
  const cases = [
    { reasons: ['概念不清', '知识点混淆', '概念不清'], expected: 'conceptual_gap' },
    { reasons: ['审题问题', '审题问题', '审题问题', '计算失误'], expected: 'misreading' },
    { reasons: ['速度偏慢'], expected: 'fluency_gap' },
  ];
  for (const { reasons, expected } of cases) {
    const { dominant } = detectMisconceptions({ mistakeReasons: reasons });
    assert.equal(dominant?.type, expected, `dominant for [${reasons}] should be ${expected}`);
  }
});

test('coach personalization: three profiles yield three distinct personalized outputs', () => {
  const render = (section) => buildPersonalizedPromptSections({
    studentProfile: { stage: section.stage, weakestSubject: section.subject, targetScore: section.score },
    learningMemory: { weakTitles: section.weak, streakDays: section.streak },
    recentBehavior: { recentAccuracyPercent: section.accuracy },
  });
  const weak = render({ stage: '基础', subject: '操作系统', score: 100, weak: ['死锁必要条件'], streak: 1, accuracy: 40 });
  const average = render({ stage: '强化', subject: '计算机网络', score: 115, weak: ['TCP拥塞控制'], streak: 6, accuracy: 70 });
  const strong = render({ stage: '冲刺', subject: null, score: 130, weak: [], streak: 25, accuracy: 92 });
  assert.notEqual(weak, average);
  assert.notEqual(average, strong);
  assert.ok(weak.includes('基础') && strong.includes('冲刺'));
});