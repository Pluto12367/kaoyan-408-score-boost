import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('shared evidence summary can power wrong-question detail cards', () => {
  const summary = buildKnowledgeEvidenceSummary({
    point,
    mastery: {
      status: 'weak',
      mastery: 0.33,
      accuracy: 0.25,
      attempts: 6,
      correctCount: 2,
      wrongCount: 4,
      nextReviewAt: null,
    },
    examQuestions: [{ year: 2024, questionNo: 22, questionType: '选择题', score: 5, summary: 'Cache 映射与替换常见考法' }],
    relatedQuestionsCount: 2,
    prerequisiteCount: 1,
    relatedCount: 3,
  });

  assert.equal(summary.cards.length, 5);
  assert.equal(summary.cards[0].title, '为什么重要');
  assert.equal(summary.cards[1].title, '真题证据');
  assert.equal(summary.cards[2].title, '我的掌握度');
  assert.equal(summary.cards[3].title, '下一步怎么学');
  assert.equal(summary.cards[4].title, '题库支撑');
  assert.match(summary.cards[1].value, /2024 年第 22 题/);
  assert.match(summary.cards[2].value, /33%/);
  assert.match(summary.cards[3].note, /前置 1 · 相关 3/);
});

test('wrong question detail view wires the shared evidence summary block', () => {
  const detail = readFileSync('apps/web/src/components/WrongQuestionDetail.tsx', 'utf8');
  assert.match(detail, /buildKnowledgeEvidenceSummary/);
  assert.match(detail, /wrong-question-evidence-grid/);
  assert.match(detail, /catalog-evidence-card/);
  assert.match(detail, /catalog-evidence-tone-/);
  assert.match(detail, /考点真题怎么考/);
  assert.match(detail, /近 3 年命中/);
  assert.match(detail, /真题累计/);
  assert.match(detail, /在知识图谱中查看该考点/);
});

test('wrong question detail view exposes an on-demand AI mistake diagnosis', () => {
  const detail = readFileSync('apps/web/src/components/WrongQuestionDetail.tsx', 'utf8');
  // The diagnosis moved from an inline tutor call to the shared Contextual
  // Coach: still per-question, still on-demand, still about the mistake.
  assert.match(detail, /import \{ ContextualCoach \} from '\.\/ContextualCoach'/);
  assert.match(detail, /contextType: 'wrong_question'/);
  assert.match(detail, /questionId \}\s*\}/);
  assert.match(detail, /为什么这道题容易错/);

  const coach = readFileSync('apps/web/src/components/ContextualCoach.tsx', 'utf8');
  assert.match(coach, /requestContextualCoach/, 'coach must hit the on-demand contextual endpoint');
  assert.match(coach, /loading|加载中/, 'on-demand action needs a pending state');
});

test('wrong question detail API still provides the exam links payload consumed by the evidence cards', () => {
  const api = readFileSync('apps/web/src/api/endpoints/review.ts', 'utf8');
  assert.match(api, /WrongQuestionExamLinks/);
  assert.match(api, /fetchWrongQuestionExamLinks/);
  assert.match(api, /frequency/);
  assert.match(api, /summary/);
});
