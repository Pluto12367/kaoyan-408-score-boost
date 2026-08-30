import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const source = async (path) => readFile(new URL(path, root), 'utf8');

test('contextual coach keeps the legacy tutor endpoints intact', async () => {
  const controller = await source('apps/api/src/study/study.controller.ts');
  const service = await source('apps/api/src/study/ai-tutor.service.ts');
  assert.match(controller, /Post\('ai\/tutor-reply'\)/);
  assert.match(controller, /Post\('ai\/follow-up'\)/);
  assert.match(service, /async explain\(/);
  assert.match(service, /async followUp\(/);
});

test('contextual coach supports explicit template fallback', async () => {
  const service = await source('apps/api/src/study/ai-tutor.service.ts');
  assert.match(service, /async contextualCoach\(/);
  assert.match(service, /contextual-coach-template/);
  assert.match(service, /AI unavailable/);
  assert.match(service, /DeepSeekClient/);
});

test('contextual coach response contains the normalized teaching fields', async () => {
  const service = await source('apps/api/src/study/contextual-coach.service.ts');
  const types = await source('apps/api/src/study/contextual-coach.types.ts');
  for (const field of ['summary', 'replySteps', 'misconceptionTips', 'reviewCards', 'nextActions', 'fallbackReason']) {
    assert.match(types, new RegExp(field));
  }
  assert.match(service, /\.\.\.result\.draft/);
});

test('module registers the contextual coach providers', async () => {
  const mod = await source('apps/api/src/study/study.module.ts');
  assert.match(mod, /ContextualCoachService/);
  assert.match(mod, /ContextualCoachContextAssembler/);
});

test('runtime service normalizes all four context requests with the authenticated user', async () => {
  const { ContextualCoachService } = await import('../apps/api/dist/study/contextual-coach.service.js');
  const calls = [];
  const assembler = {
    assemble: async (userId, request) => {
      calls.push({ userId, request });
      return {
        version: 'contextual-coach-v1',
        context: { type: request.contextType, id: request.questionId ?? request.knowledgeNodeId ?? request.assessmentId ?? null },
        student: { goal: {}, masterySummary: {}, weakPoints: [] },
        focus: {}, currentTasks: [], assembledAt: '2026-08-30T00:00:00.000Z',
      };
    },
  };
  const aiTutor = {
    contextualCoach: async () => ({
      draft: { summary: 'ok', replySteps: [], misconceptionTips: [], reviewCards: [], nextActions: [] },
      source: 'contextual-coach-template', prompt: '', fallbackReason: 'AI unavailable',
    }),
  };
  const service = new ContextualCoachService(assembler, aiTutor);
  const requests = [
    { contextType: 'question', questionId: 'q-1' },
    { contextType: 'wrong_question', questionId: 'q-2' },
    { contextType: 'knowledge_node', knowledgeNodeId: 'node-1' },
    { contextType: 'assessment' },
  ];
  for (const request of requests) {
    const response = await service.contextualCoach('authenticated-user', request);
    assert.equal(response.contextType, request.contextType);
    assert.equal(response.source, 'contextual-coach-template');
    assert.equal(response.fallbackReason, 'AI unavailable');
  }
  assert.deepEqual(calls.map((call) => call.userId), ['authenticated-user', 'authenticated-user', 'authenticated-user', 'authenticated-user']);
});
