import test from 'node:test';
import assert from 'node:assert/strict';

import { AiTutorService } from '../apps/api/dist/study/ai-tutor.service.js';
import { ChatCompletionError } from '../apps/api/dist/study/deepseek-client.js';

const context = {
  version: 'contextual-coach-v1',
  context: { type: 'question', id: 'q-1' },
  student: { goal: {}, masterySummary: {}, weakPoints: [] },
  focus: {},
  currentTasks: [],
  assembledAt: '2026-08-30T00:00:00.000Z',
};

const draft = {
  summary: '基于学习事实进行复盘。',
  replySteps: ['复述核心概念'],
  misconceptionTips: [],
  reviewCards: [],
  nextActions: ['查看相关题目'],
};

function createService(client) {
  const service = new AiTutorService({ create: async () => undefined });
  service.client = client;
  const logs = [];
  service.logger = { log: (message) => logs.push(JSON.parse(message)) };
  return { service, logs };
}

test('model response records source and duration metadata', async () => {
  const { service, logs } = createService({
    chatCompletions: async () => ({ content: JSON.stringify(draft), model: 'test-model' }),
  });
  const result = await service.contextualCoach('user-1', context);
  assert.equal(result.source, 'test-model');
  assert.equal(result.fallbackReason, undefined);
  assert.equal(result.errorType, undefined);
  assert.equal(Number.isInteger(result.durationMs), true);
  assert.equal(logs[0].event, 'contextual_coach.completed');
  assert.equal(logs[0].source, 'test-model');
  assert.equal(logs[0].fallback, false);
  assert.equal(Number.isInteger(logs[0].durationMs), true);
});

test('normalization fallback records model output error metadata', async () => {
  const { service, logs } = createService({
    chatCompletions: async () => ({ content: 'not-json', model: 'test-model' }),
  });
  const result = await service.contextualCoach('user-1', context);
  assert.equal(result.source, 'contextual-coach-template');
  assert.equal(result.fallbackReason, 'invalid_model_json');
  assert.equal(result.errorType, 'model_output');
  assert.equal(logs[0].fallback, true);
  assert.equal(logs[0].fallbackReason, 'invalid_model_json');
  assert.equal(logs[0].errorType, 'model_output');
});

test('provider timeout returns explicit fallback and records error type', async () => {
  const { service, logs } = createService({
    chatCompletions: async () => { throw new ChatCompletionError('timeout', 'timed out'); },
  });
  const result = await service.contextualCoach('user-1', context);
  assert.equal(result.source, 'contextual-coach-template');
  assert.equal(result.fallbackReason, 'provider_timeout');
  assert.equal(result.errorType, 'timeout');
  assert.equal(logs[0].fallbackReason, 'provider_timeout');
  assert.equal(logs[0].errorType, 'timeout');
  assert.equal(Number.isInteger(logs[0].durationMs), true);
});

test('unconfigured provider is observable as template fallback', async () => {
  const previousKey = process.env.AI_API_KEY;
  delete process.env.AI_API_KEY;
  try {
    const service = new AiTutorService({ create: async () => undefined });
    const logs = [];
    service.logger = { log: (message) => logs.push(JSON.parse(message)) };
    const result = await service.contextualCoach('user-1', context);
    assert.equal(result.source, 'contextual-coach-template');
    assert.equal(result.fallbackReason, 'AI unavailable');
    assert.equal(Number.isInteger(result.durationMs), true);
    assert.equal(logs[0].fallback, true);
    assert.equal(logs[0].fallbackReason, 'AI unavailable');
  } finally {
    if (previousKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = previousKey;
  }
});
