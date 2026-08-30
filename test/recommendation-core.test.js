import test from 'node:test';
import assert from 'node:assert/strict';
import { runRecommendation } from '../packages/shared/dist/index.js';

const NOW = '2026-08-30T08:00:00.000Z';

function evidence(id, overrides = {}) {
  return {
    subject: overrides.subject ?? '数据结构',
    importance: overrides.importance ?? 4,
    difficulty: overrides.difficulty ?? 3,
    recent3Y: { frequency: overrides.recent3 ?? 4 },
    recent5Y: { frequency: overrides.recent5 ?? 4 },
    allTimeEvidence: { frequency: overrides.allTime ?? 4 },
    trend: { direction: 'STABLE', delta: 0 },
    evidenceConfidence: 'HIGH',
  };
}

function node(id, overrides = {}) {
  return {
    knowledgeNodeId: id,
    mastery: 0.5,
    accuracy: 0.6,
    recentAccuracy: 0.6,
    attempts: 4,
    correctCount: 2,
    wrongCount: 1,
    retention: 0.9,
    stabilityDays: 3,
    lastReviewedAt: '2026-08-28T00:00:00.000Z',
    pinned: false,
    ...overrides,
  };
}

function input(overrides = {}) {
  const nodeStates = overrides.nodeStates ?? [
    node('node-a'),
    node('node-b'),
    node('node-c'),
  ];
  const evidenceMap = {};
  for (const state of nodeStates) evidenceMap[state.knowledgeNodeId] = evidence(state.knowledgeNodeId);
  return {
    meta: { userId: 'u-1', now: NOW, generatedAt: NOW },
    student: {
      goal: { stage: null, targetScore: 115, currentScore: 72, remainingDays: 96, dailyHours: 3 },
      nodeStates,
      reviewSummary: { dueCount: 0, overdueCount: 0 },
    },
    content: {
      evidence: overrides.evidence ?? evidenceMap,
      prerequisites: overrides.prerequisites ?? {},
      prerequisiteMastery: overrides.prerequisiteMastery ?? {},
    },
    config: {
      availableMinutes: overrides.availableMinutes ?? 120,
      daysToExam: overrides.daysToExam ?? 96,
      maxItems: overrides.maxItems,
    },
  };
}

const itemsOf = (result, kind) => result.items.filter((item) => item.kind === kind);

// ---- Deterministic ----

test('same input run twice produces identical results', () => {
  const first = runRecommendation(input());
  const second = runRecommendation(input());
  assert.deepEqual(first, second);
  assert.equal(first.source, 'recommendation_engine_v1');
  assert.equal(first.generatedAt, NOW);
});

test('items are sorted by score desc with nodeId tie-break', () => {
  const result = runRecommendation(input());
  const scores = result.items.map((item) => item.score);
  for (let i = 1; i < scores.length; i += 1) {
    assert.ok(scores[i - 1] >= scores[i], 'scores must be non-increasing');
    if (scores[i - 1] === scores[i]) {
      assert.ok(
        result.items[i - 1].knowledgeNodeId.localeCompare(result.items[i].knowledgeNodeId) <= 0,
        'equal scores must tie-break by nodeId',
      );
    }
  }
});

// ---- Priority / action classification ----

test('low mastery node classifies as LEARN with LOW_MASTERY reason', () => {
  const result = runRecommendation(input({
    nodeStates: [node('node-weak', { mastery: 0.3, recentAccuracy: 0.4, attempts: 6, correctCount: 2, wrongCount: 1 })],
  }));
  const knowledge = itemsOf(result, 'KNOWLEDGE').find((item) => item.knowledgeNodeId === 'node-weak');
  assert.equal(knowledge.action, 'LEARN');
  assert.ok(knowledge.reasonCodes.includes('LOW_MASTERY'));
  assert.equal(knowledge.estimatedMinutes, 20, 'difficulty 3 LEARN estimate');
});

test('high wrong count classifies as WRONG_QUESTION with REPEATED_WRONG', () => {
  const result = runRecommendation(input({
    nodeStates: [node('node-wrong', { mastery: 0.8, recentAccuracy: 0.9, wrongCount: 3, attempts: 9, correctCount: 6 })],
  }));
  const knowledge = itemsOf(result, 'KNOWLEDGE').find((item) => item.knowledgeNodeId === 'node-wrong');
  assert.equal(knowledge.action, 'WRONG_QUESTION');
  assert.ok(knowledge.reasonCodes.includes('REPEATED_WRONG'));
});

test('overdue retention produces a REVIEW item with REVIEW_DUE and derived nextReviewAt', () => {
  const result = runRecommendation(input({
    nodeStates: [node('node-review', { mastery: 0.5, recentAccuracy: 0.85, retention: 0.3, stabilityDays: 3, lastReviewedAt: '2026-08-20T00:00:00.000Z' })],
  }));
  const review = itemsOf(result, 'REVIEW').find((item) => item.knowledgeNodeId === 'node-review');
  assert.ok(review, 'REVIEW item must exist');
  assert.ok(review.reasonCodes.includes('REVIEW_DUE'));
  assert.deepEqual(review.facts, { stabilityDays: 3, retention: 0.3, nextReviewAt: '2026-08-23T00:00:00.000Z' });
});

test('steady node classifies as PRACTICE and near-exam mastered node as MOCK', () => {
  const practice = runRecommendation(input({
    nodeStates: [node('node-practice', { mastery: 0.6, recentAccuracy: 0.6 })],
  }));
  assert.equal(itemsOf(practice, 'KNOWLEDGE')[0].action, 'PRACTICE');

  const mock = runRecommendation(input({
    nodeStates: [node('node-mock', { mastery: 0.85, recentAccuracy: 0.95, wrongCount: 0 })],
    daysToExam: 30,
  }));
  assert.equal(itemsOf(mock, 'KNOWLEDGE')[0].action, 'MOCK');
});

test('missing evidence degrades to LOW_EVIDENCE with neutral defaults', () => {
  const result = runRecommendation(input({ evidence: {} }));
  const knowledge = itemsOf(result, 'KNOWLEDGE');
  assert.ok(knowledge.length > 0);
  for (const item of knowledge) assert.ok(item.reasonCodes.includes('LOW_EVIDENCE'));
});

// ---- Budget / orchestration ----

test('question set quota follows stage and overall accuracy', () => {
  // 全量正确率 0.7 ≥ 0.55 且非冲刺 → 薄弱专题突破（12 题）
  const standard = runRecommendation(input({
    nodeStates: [node('node-s', { mastery: 0.6, attempts: 10, correctCount: 7 })],
  }));
  assert.equal(itemsOf(standard, 'QUESTION_SET')[0].questionCount, 12);
  assert.equal(itemsOf(standard, 'QUESTION_SET')[0].focus, '薄弱专题突破');

  // 全量正确率 0.3 < 0.55 → 高频基础考点补强（16 题）
  const weak = runRecommendation(input({
    nodeStates: [node('node-s', { mastery: 0.6, attempts: 10, correctCount: 3 })],
  }));
  assert.equal(itemsOf(weak, 'QUESTION_SET')[0].questionCount, 16);
  assert.equal(itemsOf(weak, 'QUESTION_SET')[0].focus, '高频基础考点补强');

  // 冲刺阶段 → 真题错题回炉训练（20 题）
  const sprintInput = input({
    nodeStates: [node('node-s', { mastery: 0.6, attempts: 10, correctCount: 7 })],
  });
  sprintInput.student.goal.stage = '冲刺';
  const sprint = runRecommendation(sprintInput);
  assert.equal(itemsOf(sprint, 'QUESTION_SET')[0].questionCount, 20);
  assert.equal(itemsOf(sprint, 'QUESTION_SET')[0].focus, '真题错题回炉训练');
});

test('LEARN cap applies beyond 150 days to exam', () => {
  const nodeStates = [];
  for (let i = 0; i < 5; i += 1) {
    nodeStates.push(node(`node-learn-${i}`, { mastery: 0.3, recentAccuracy: 0.4, wrongCount: 0, retention: null, stabilityDays: null, lastReviewedAt: null }));
  }
  for (let i = 0; i < 5; i += 1) {
    nodeStates.push(node(`node-practice-${i}`, { mastery: 0.6, recentAccuracy: 0.6, wrongCount: 0, retention: 0.9 }));
  }
  const result = runRecommendation(input({ nodeStates, availableMinutes: 180, daysToExam: 200 }));
  const taskDrafts = itemsOf(result, 'TASK_DRAFT');
  const learnTasks = taskDrafts.filter((item) => item.action === 'LEARN');
  // cap = ceil(选中草稿数 × 0.4)；配额池（PRACTICE）会把超额 LEARN 换出
  const cap = Math.ceil(taskDrafts.length * 0.4);
  assert.ok(learnTasks.length <= cap, `LEARN tasks must respect the foundation cap ${cap} (got ${learnTasks.length})`);
  assert.ok(learnTasks.length < 5, 'the cap must have removed at least one LEARN draft');
});

test('subject quota pulls a second-subject node into the plan', () => {
  const nodeStates = [
    node('node-ds-1', { mastery: 0.3, recentAccuracy: 0.4, wrongCount: 0, retention: null, stabilityDays: null, lastReviewedAt: null }),
    node('node-ds-2', { mastery: 0.35, recentAccuracy: 0.4, wrongCount: 0, retention: null, stabilityDays: null, lastReviewedAt: null }),
    node('node-ds-3', { mastery: 0.4, recentAccuracy: 0.4, wrongCount: 0, retention: null, stabilityDays: null, lastReviewedAt: null }),
    node('node-co-1', { mastery: 0.3, recentAccuracy: 0.4, wrongCount: 0, retention: null, stabilityDays: null, lastReviewedAt: null }),
  ];
  const evidenceMap = {
    // 三个 DS（20min/个，importance 5）恰好占满 60 分钟预算；CO 只能由科目配额换入
    'node-ds-1': evidence('node-ds-1', { subject: '数据结构', difficulty: 3, importance: 5 }),
    'node-ds-2': evidence('node-ds-2', { subject: '数据结构', difficulty: 3, importance: 5 }),
    'node-ds-3': evidence('node-ds-3', { subject: '数据结构', difficulty: 3, importance: 5 }),
    'node-co-1': evidence('node-co-1', { subject: '计算机组成原理', difficulty: 3, importance: 1, recent3: 0, recent5: 0, allTime: 0 }),
  };
  const result = runRecommendation(input({ nodeStates, evidence: evidenceMap, availableMinutes: 60 }));
  const draftNodes = itemsOf(result, 'TASK_DRAFT').map((item) => item.knowledgeNodeId);
  assert.ok(draftNodes.includes('node-co-1'), 'subject quota must swap the CO node into the drafts');
  assert.equal(draftNodes.length, 3, 'budget still caps the draft count');
});

// ---- Edge cases ----

test('empty student state returns empty items without throwing', () => {
  const result = runRecommendation(input({ nodeStates: [] }));
  assert.deepEqual(result.items, []);
  assert.equal(result.source, 'recommendation_engine_v1');
});

test('nodes missing from the evidence map are processed with neutral LOW_EVIDENCE facts', () => {
  const result = runRecommendation(input({
    nodeStates: [node('node-unknown')],
    evidence: {},
  }));
  const knowledge = itemsOf(result, 'KNOWLEDGE').find((item) => item.knowledgeNodeId === 'node-unknown');
  assert.ok(knowledge, 'unknown node must still be processed');
  assert.ok(knowledge.reasonCodes.includes('LOW_EVIDENCE'));
  // 前置替换：target 分数更高（先入队）但前置未满足（prerequisiteMastery=0.2<0.45），
  // 其 draft 被替换为前置节点并携带 PREREQUISITE_GAP；target 自身被去重丢弃。
  const withPrereq = runRecommendation(input({
    nodeStates: [node('node-target', { mastery: 0.1, recentAccuracy: 0.2, wrongCount: 0, retention: null, stabilityDays: null, lastReviewedAt: null }), node('node-prereq', { mastery: 0.44, recentAccuracy: 0.9, wrongCount: 0, retention: null, stabilityDays: null, lastReviewedAt: null })],
    prerequisites: { 'node-target': ['node-prereq'] },
    prerequisiteMastery: { 'node-prereq': 0.2 },
  }));
  const target = itemsOf(withPrereq, 'TASK_DRAFT').find((item) => item.knowledgeNodeId === 'node-target');
  assert.equal(target, undefined, 'unmet prerequisite must suppress the target task draft');
  const prereq = itemsOf(withPrereq, 'TASK_DRAFT').find((item) => item.knowledgeNodeId === 'node-prereq');
  assert.ok(prereq, 'the prerequisite draft must be generated instead');
  assert.ok(prereq.reasonCodes.includes('PREREQUISITE_GAP'));
});
