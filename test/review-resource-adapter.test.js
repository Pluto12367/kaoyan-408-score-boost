import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const adapterUrl = new URL('../apps/api/src/study/review-resources-recommendation.adapter.ts', import.meta.url);

async function loadAdapter() {
  const source = await readFile(adapterUrl, 'utf8');
  const output = ts.transpileModule(source, {
    fileName: 'review-resources-recommendation.adapter.ts',
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)(() => {
    throw new Error('adapter must be dependency-free');
  }, module, module.exports);
  return module.exports;
}

const point = (id, overrides = {}) => ({
  knowledgePointId: id,
  title: `考点 ${id}`,
  subject: '操作系统',
  chapter: '进程管理',
  accuracyRate: 50,
  ...overrides,
});

test('three resource templates are generated per point with legacy copy', async () => {
  const { buildReviewResourcesDto } = await loadAdapter();
  const dto = buildReviewResourcesDto({
    userId: 'u-1',
    source: 'postgresql',
    generatedAt: '2026-08-30T08:00:00.000Z',
    weakPointCount: 1,
    resourcePoints: [point('kp-1')],
    wrongQuestions: [],
  });
  assert.equal(dto.source, 'postgresql');
  assert.equal(dto.userId, 'u-1');
  assert.equal(dto.weakPointCount, 1);
  assert.equal(dto.items.length, 3);
  assert.deepEqual(dto.items.map((item) => item.resourceType), ['concept_card', 'mistake_checklist', 'practice_set']);
  assert.equal(dto.items[0].id, 'resource-kp-1-concept');
  assert.equal(dto.items[0].knowledgePointTitle, '考点 kp-1');
  assert.equal(dto.items[0].summary, '先复述 进程管理 中 考点 kp-1 的定义、适用条件和常见题干关键词。');
  assert.equal(dto.items[0].actionAnchor, '#question');
  assert.equal(dto.items[1].summary, '按知识点没学过、概念混淆、公式记错、计算错误、审题错误、推理过程错误、时间不足、蒙题八类检查最近错因。');
  assert.equal(dto.items[1].actionAnchor, '#wrong-book');
  assert.equal(dto.items[2].actionText, '进入专项训练');
});

test('mistake checklist prefers the wrong-question reason and accuracy tiers apply', async () => {
  const { buildReviewResourcesDto } = await loadAdapter();
  const dto = buildReviewResourcesDto({
    userId: 'u-1',
    source: 'postgresql',
    generatedAt: '2026-08-30T08:00:00.000Z',
    weakPointCount: 1,
    resourcePoints: [point('kp-1', { accuracyRate: 40 })],
    wrongQuestions: [{ knowledgePointId: 'kp-1', wrongCount: 3, latestMistakeReason: '概念混淆' }],
  });
  assert.match(dto.items[1].summary, /该考点已有 3 次错误，优先检查：概念混淆/);
  assert.equal(dto.items[0].estimatedMinutes, 18, 'accuracyRate < 50 raises concept minutes');
  assert.equal(dto.items[2].difficulty, '中等', 'accuracyRate < 60 keeps practice at 中等');
});

test('items are capped at six across points', async () => {
  const { buildReviewResourcesDto } = await loadAdapter();
  const dto = buildReviewResourcesDto({
    userId: 'u-1',
    source: 'postgresql',
    generatedAt: '2026-08-30T08:00:00.000Z',
    weakPointCount: 3,
    resourcePoints: [point('kp-1'), point('kp-2'), point('kp-3')],
    wrongQuestions: [],
  });
  assert.equal(dto.items.length, 6);
});

test('empty resource points fall back to the directory first point', async () => {
  const { buildReviewResourcesDto } = await loadAdapter();
  const dto = buildReviewResourcesDto({
    userId: 'u-1',
    source: 'postgresql',
    generatedAt: '2026-08-30T08:00:00.000Z',
    weakPointCount: 0,
    resourcePoints: [],
    fallbackPoint: point('kp-fallback'),
    wrongQuestions: [],
  });
  assert.equal(dto.items.length, 3);
  assert.equal(dto.items[0].knowledgePointId, 'kp-fallback');
});
