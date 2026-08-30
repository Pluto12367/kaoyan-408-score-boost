import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeContextualCoachDraft,
  normalizeContextualCoachModelResponse,
} from '../apps/api/dist/study/contextual-coach-normalizer.js';

const fallback = {
  summary: 'fallback',
  replySteps: ['fallback step'],
  misconceptionTips: [],
  reviewCards: [],
  nextActions: ['fallback action'],
};

test('normalizer preserves valid structured output and ignores extra fields', () => {
  const result = normalizeContextualCoachModelResponse(JSON.stringify({
    summary: 'summary',
    replySteps: ['step'],
    misconceptionTips: ['tip'],
    reviewCards: [{ id: 'card-1', type: 'rule', title: 'title', content: 'content', nextAction: 'act' }],
    nextActions: ['next'],
    extra: 'ignored',
  }), fallback);
  assert.equal(result.fallbackReason, undefined);
  assert.deepEqual(result.draft, {
    summary: 'summary',
    replySteps: ['step'],
    misconceptionTips: ['tip'],
    reviewCards: [{ id: 'card-1', type: 'rule', title: 'title', content: 'content', nextAction: 'act' }],
    nextActions: ['next'],
  });
});

test('normalizer supplies defaults for missing fields', () => {
  const draft = normalizeContextualCoachDraft({ summary: 'partial' });
  assert.equal(draft.summary, 'partial');
  assert.deepEqual(draft.replySteps, []);
  assert.deepEqual(draft.misconceptionTips, []);
  assert.deepEqual(draft.reviewCards, []);
  assert.deepEqual(draft.nextActions, []);
});

test('normalizer converts invalid field types to safe defaults', () => {
  const draft = normalizeContextualCoachDraft({
    summary: 42,
    replySteps: 'not-an-array',
    misconceptionTips: [1, 'valid'],
    reviewCards: [{ id: 7, type: 'unknown', title: null }],
    nextActions: { value: 'not-an-array' },
  });
  assert.equal(draft.summary, '请根据已提供的学习事实完成复盘。');
  assert.deepEqual(draft.replySteps, []);
  assert.deepEqual(draft.misconceptionTips, ['valid']);
  assert.deepEqual(draft.reviewCards, [{ id: 'context-card-1', type: 'concept', title: '复盘卡片', content: '回到上下文事实进行核对。', nextAction: '完成一次复述' }]);
  assert.deepEqual(draft.nextActions, []);
});

test('non-JSON model output returns explicit fallback', () => {
  const result = normalizeContextualCoachModelResponse('not json', fallback);
  assert.equal(result.fallbackReason, 'invalid_model_json');
  assert.deepEqual(result.draft, fallback);
});

test('empty model output returns explicit fallback', () => {
  const result = normalizeContextualCoachModelResponse('  ', fallback);
  assert.equal(result.fallbackReason, 'empty_model_response');
  assert.deepEqual(result.draft, fallback);
});

test('unsafe system-action claims are downgraded to explicit fallback', () => {
  const result = normalizeContextualCoachModelResponse(JSON.stringify({
    summary: '已经帮你提升掌握度',
    nextActions: ['已创建复习任务', '已经安排复习'],
  }), fallback);
  assert.equal(result.fallbackReason, 'unsafe_model_content');
  assert.deepEqual(result.draft, fallback);
});
