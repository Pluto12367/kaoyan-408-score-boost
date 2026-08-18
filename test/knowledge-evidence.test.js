import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKnowledgeEvidenceSummary } from '../packages/shared/dist/knowledgeEvidence.js';

const point = {
  id: 'co-cache',
  name: 'Cache 映射与替换',
  importance: 5,
  difficulty: 4,
  evidence: {
    recent3Frequency: 2,
    recent5Frequency: 5,
    allTimeEvidence: 8,
    primaryScore5y: 18,
    trendDirection: 'RISING',
    trendDelta: 3,
    evidenceConfidence: 'HIGH',
  },
};

test('buildKnowledgeEvidenceSummary produces a structured guidance card set', () => {
  const summary = buildKnowledgeEvidenceSummary({
    point,
    mastery: {
      status: 'review',
      mastery: 0.56,
      accuracy: 0.5,
      attempts: 4,
      correctCount: 2,
      wrongCount: 2,
      nextReviewAt: null,
    },
    examQuestions: [{ year: 2024, questionNo: 22, questionType: '选择题', score: 5, summary: 'Cache 映射与替换常见考法' }],
    relatedQuestionsCount: 3,
    prerequisiteCount: 2,
    relatedCount: 4,
  });

  assert.match(summary.whyImportant, /高频|重要权重|基础连接点/);
  assert.match(summary.nextStepHint, /复盘|前置知识|变式题/);
  assert.equal(summary.cards.length, 5);
  assert.equal(summary.cards[0].title, '为什么重要');
  assert.equal(summary.cards[1].title, '真题证据');
  assert.equal(summary.cards[2].title, '我的掌握度');
  assert.equal(summary.cards[3].title, '下一步怎么学');
  assert.equal(summary.cards[4].title, '题库支撑');
  assert.match(summary.cards[1].value, /2024 年第 22 题/);
  assert.match(summary.cards[2].value, /56%|review/);
  assert.match(summary.cards[3].note, /前置 2 · 相关 4/);
});

test('buildKnowledgeEvidenceSummary falls back safely when evidence and mastery are missing', () => {
  const summary = buildKnowledgeEvidenceSummary({
    point: { ...point, evidence: null },
    mastery: null,
    examQuestions: [],
    relatedQuestionsCount: 0,
    prerequisiteCount: 0,
    relatedCount: 0,
  });

  assert.match(summary.whyImportant, /先把该节点|基础概念/);
  assert.match(summary.nextStepHint, /前置知识/);
  assert.equal(summary.cards[1].value, '暂无真题示例');
  assert.equal(summary.cards[2].value, '尚未练习');
  assert.equal(summary.cards[4].tone, 'warning');
});
