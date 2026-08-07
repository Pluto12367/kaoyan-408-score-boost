import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildAiVariantUserPrompt,
  parseAiVariantJson,
} from '../packages/shared/dist/ai-variant.js';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('AI variant: parser accepts a valid JSON draft list and rejects malformed items', () => {
  const items = parseAiVariantJson(JSON.stringify({
    items: [
      {
        stem: '变式题干',
        options: ['A1', 'B1', 'C1', 'D1'],
        answer: 'B',
        analysis: '解析',
        difficulty: '困难',
      },
      { stem: '缺选项', options: ['A', 'B'], answer: 'A', analysis: 'x' },
      { stem: '缺解析', options: ['A', 'B', 'C', 'D'], answer: 'C', difficulty: '中等' },
      'not-an-object',
    ],
  }));

  assert.equal(items.length, 1);
  assert.equal(items[0].answer, 'B');
  assert.deepEqual(items[0].options, ['A1', 'B1', 'C1', 'D1']);
  assert.equal(items[0].difficulty, '困难');
});

test('AI variant: parser returns empty for invalid JSON and prompt carries the count', () => {
  assert.deepEqual(parseAiVariantJson('not json'), []);
  assert.deepEqual(parseAiVariantJson('{"other": 1}'), []);
  const prompt = buildAiVariantUserPrompt(
    { stem: '原题', options: ['A', 'B', 'C', 'D'], answer: 'A', analysis: '解析' },
    3,
  );
  assert.match(prompt, /生成 3 道同知识点变式题/);
});

test('AI variant: backend service generates via DeepSeek and confirms via question creation', async () => {
  const service = await source('apps/api/src/questions/ai-variant.service.ts');
  assert.match(service, /AI_API_KEY 未配置，无法生成 AI 变式题（不会静默回退）。/, 'missing key must fail loudly, never fake');
  assert.match(service, /chatCompletions\(\{/, 'generation should call the DeepSeek client');
  assert.match(service, /logRepository\.create/, 'AI calls should be audited');
  assert.match(service, /questionsService\.createQuestion\(/, 'confirm should persist through question creation');
  assert.match(service, /source: 'AI 变式题'/, 'confirmed variants should carry the AI source marker');

  const controller = await source('apps/api/src/questions/questions.controller.ts');
  assert.match(controller, /@Post\(':questionId\/ai-variant'\)/, 'generate route should exist');
  assert.match(controller, /@Post\(':questionId\/ai-variant\/confirm'\)/, 'confirm route should exist');

  const moduleSource = await source('apps/api/src/questions/questions.module.ts');
  assert.match(moduleSource, /AiVariantService/, 'module should register the variant service');
  assert.match(moduleSource, /AiTutorLogRepository/, 'module should register the audit repository');
});

test('AI variant: teacher UI offers generate, preview and confirm-to-bank', async () => {
  const teacher = await source('apps/web/src/api/endpoints/teacher.ts');
  assert.match(teacher, /export async function generateAiVariant\(questionId: string, count = 1\)/, 'client should expose generate');
  assert.match(teacher, /export async function confirmAiVariant\(questionId: string, draft: AiVariantDraft\)/, 'client should expose confirm');

  const workspace = await source('apps/web/src/features/teacher/TeacherWorkspace.tsx');
  assert.match(workspace, /generateAiVariant\(questionId\)/, 'question rows should trigger generation');
  assert.match(workspace, /confirmAiVariant\(aiSourceQuestionId, draft\)/, 'preview should confirm into the bank');
  assert.match(workspace, /确认入库/, 'preview should offer confirm');
  assert.match(workspace, /AI 变式题预览（需教师核对后确认入库）/, 'preview should require teacher review');
});
