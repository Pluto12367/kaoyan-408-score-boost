import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

async function loadNodeMastery() {
  const source = await readFile(new URL('../packages/shared/src/nodeMastery.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

const rows = [
  {
    knowledgeNodeId: 'node-cache', subject: '计算机组成原理', chapter: '存储系统', title: 'Cache',
    importance: 5, frequency: 5, mastery: 0.3, attempts: 4, correctCount: 1, wrongCount: 3, status: 'weak',
  },
];

test('node mastery builder emits canonical node identity only', async () => {
  const { buildNodeMasteryMap } = await loadNodeMastery();
  const map = buildNodeMasteryMap({
    userId: 'u-1', rows, subjects: ['计算机组成原理'], generatedAt: '2026-09-02T00:00:00.000Z',
  });
  const point = map.subjects[0].points[0];
  assert.equal(point.knowledgeNodeId, 'node-cache');
  assert.equal(Object.hasOwn(point, 'knowledgePointId'), false);
});

test('legacy mastery adapter is the only compatibility boundary', async () => {
  const { buildNodeMasteryMap, toLegacyMasteryMap } = await loadNodeMastery();
  const canonical = buildNodeMasteryMap({
    userId: 'u-1', rows, subjects: ['计算机组成原理'], generatedAt: '2026-09-02T00:00:00.000Z',
  });
  const legacy = toLegacyMasteryMap(canonical);
  assert.equal(legacy.subjects[0].points[0].knowledgePointId, 'node-cache');
  assert.equal(legacy.subjects[0].points[0].knowledgeNodeId, undefined);
  assert.equal(canonical.subjects[0].points[0].knowledgePointId, undefined);
});

test('recommendation identity adapter never mixes node ids into point ids', async () => {
  const source = await readFile(new URL('../apps/api/src/study/practice-set-recommendation.adapter.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)((specifier) => {
    if (specifier.includes('@kaoyan408/shared')) return {};
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
  const { bridgeKnowledgePointIds, buildCanonicalPracticeSetIdentity } = module.exports;
  assert.deepEqual(bridgeKnowledgePointIds({ nodeIds: ['node-unmapped'], kpIdsByNodeId: {} }), []);
  assert.deepEqual(buildCanonicalPracticeSetIdentity({
    nodeIds: ['node-a', 'node-b'],
    kpIdsByNodeId: { 'node-a': ['point-a'], 'node-b': [] },
  }), { knowledgeNodeIds: ['node-a', 'node-b'], knowledgePointIds: ['point-a'] });
});

test('state recommendation keeps node and point arrays separate', async () => {
  const source = await readFile(new URL('../apps/api/src/study/study.service.ts', import.meta.url), 'utf8');
  assert.match(source, /const knowledgeNodeIds = identity\.knowledgeNodeIds/);
  assert.match(source, /const knowledgePointIds = identity\.knowledgePointIds/);
  assert.doesNotMatch(source, /knowledgePointIds = \[\.\.\.new Set\(weakNodeIds\)\]/);
});

test('StudyTask legacy field is written only through an explicit adapter', async () => {
  const service = await readFile(new URL('../apps/api/src/study/recommendation.service.ts', import.meta.url), 'utf8');
  const adapter = await readFile(new URL('../apps/api/src/study/practice-set-recommendation.adapter.ts', import.meta.url), 'utf8');
  assert.match(service, /toLegacyStudyTaskIdentity/);
  assert.doesNotMatch(service, /knowledgePointId:\s*draft\.knowledgeNodeId/);
  assert.match(adapter, /knowledgePointId: input\.knowledgeNodeId/);
});

test('review resources bridge Node recommendations to real Point IDs before legacy DTO output', async () => {
  const service = await readFile(new URL('../apps/api/src/study/study.service.ts', import.meta.url), 'utf8');
  assert.match(service, /getKpIdsByNodeId\(nodeIds\)/);
  assert.doesNotMatch(service, /knowledgePointId:\s*item\.knowledgeNodeId/);
});
