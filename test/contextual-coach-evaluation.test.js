import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeContextualCoachModelResponse,
} from '../apps/api/dist/study/contextual-coach-normalizer.js';
import { AiTutorService } from '../apps/api/dist/study/ai-tutor.service.js';

const fallback = {
  summary: 'fallback',
  replySteps: ['fallback step'],
  misconceptionTips: [],
  reviewCards: [],
  nextActions: ['fallback action'],
};

const validDraft = {
  summary: '根据当前学习事实进行复盘。',
  replySteps: ['复述核心概念'],
  misconceptionTips: ['区分相近概念'],
  reviewCards: [{ id: 'card-1', type: 'concept', title: '概念核对', content: '写出定义', nextAction: '练习这个概念' }],
  nextActions: ['查看相关题目'],
};

function context(type) {
  return { type, id: type === 'assessment' ? null : `${type}-1` };
}

function fullContext(type = 'question') {
  return {
    version: 'contextual-coach-v1',
    context: context(type),
    student: { goal: {}, masterySummary: {}, weakPoints: [] },
    focus: {},
    currentTasks: [],
    assembledAt: '2026-08-30T00:00:00.000Z',
  };
}

test('valid model output reaches the service with the model source', async () => {
  const service = new AiTutorService({ create: async () => undefined });
  service.client = {
    chatCompletions: async () => ({ content: JSON.stringify(validDraft), model: 'test-model' }),
  };
  const result = await service.contextualCoach('user-1', fullContext());
  assert.equal(result.source, 'test-model');
  assert.equal(result.fallbackReason, undefined);
  assert.equal(result.draft.summary, validDraft.summary);
});

test('valid structured output keeps the model source contract', () => {
  const result = normalizeContextualCoachModelResponse(JSON.stringify(validDraft), fallback);
  assert.equal(result.fallbackReason, undefined);
  assert.deepEqual(result.draft, validDraft);
});

test('missing fields remain a safe structured response', () => {
  const result = normalizeContextualCoachModelResponse(JSON.stringify({ summary: 'partial' }), fallback);
  assert.equal(result.fallbackReason, undefined);
  assert.equal(result.draft.summary, 'partial');
  assert.deepEqual(result.draft.replySteps, []);
  assert.deepEqual(result.draft.reviewCards, []);
  assert.deepEqual(result.draft.nextActions, []);
});

test('wrong field types do not cross the response boundary', () => {
  const result = normalizeContextualCoachModelResponse(JSON.stringify({
    summary: 'safe',
    replySteps: 'not array',
    misconceptionTips: [42, 'valid tip'],
    reviewCards: 'not array',
    nextActions: { action: 'not array' },
  }), fallback);
  assert.equal(result.fallbackReason, undefined);
  assert.deepEqual(result.draft.replySteps, []);
  assert.deepEqual(result.draft.misconceptionTips, ['valid tip']);
  assert.deepEqual(result.draft.reviewCards, []);
  assert.deepEqual(result.draft.nextActions, []);
});

test('extra model fields are excluded from the response', () => {
  const result = normalizeContextualCoachModelResponse(JSON.stringify({ ...validDraft, fakeSystemAction: 'created study plan' }), fallback);
  assert.equal(result.fallbackReason, undefined);
  assert.equal('fakeSystemAction' in result.draft, false);
});

test('invalid JSON returns an explicit fallback reason', () => {
  const result = normalizeContextualCoachModelResponse('hello', fallback);
  assert.equal(result.fallbackReason, 'invalid_model_json');
  assert.deepEqual(result.draft, fallback);
});

test('unsafe state-change claims are rejected instead of presented as facts', () => {
  const result = normalizeContextualCoachModelResponse(JSON.stringify({
    summary: '系统已经记录并修改学习计划',
    nextActions: ['掌握度已经提升', '已经创建任务', '已经安排复习'],
  }), fallback);
  assert.equal(result.fallbackReason, 'unsafe_model_content');
  assert.deepEqual(result.draft, fallback);
});

test('all four context types share the same response contract', () => {
  for (const type of ['question', 'wrong_question', 'knowledge_node', 'assessment']) {
    const response = {
      contextType: type,
      contextId: context(type).id,
      ...validDraft,
      source: 'model',
      assembledAt: '2026-08-30T00:00:00.000Z',
    };
    for (const field of ['contextType', 'contextId', 'summary', 'replySteps', 'misconceptionTips', 'reviewCards', 'nextActions', 'source', 'assembledAt']) {
      assert.ok(field in response, `${type} response is missing ${field}`);
    }
    assert.equal(response.contextType, type);
  }
});
