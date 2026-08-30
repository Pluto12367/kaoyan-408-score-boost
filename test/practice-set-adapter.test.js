import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const adapterPath = new URL('../apps/api/src/study/practice-set-recommendation.adapter.ts', import.meta.url);

async function loadAdapter() {
  const source = await readFile(adapterPath, 'utf8');
  const output = ts.transpileModule(source, {
    fileName: 'practice-set-recommendation.adapter.ts',
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)(() => {
    throw new Error('adapter must be dependency-free');
  }, module, module.exports);
  return module.exports;
}

test('QUESTION_SET.focus drives the three legacy title/focus branches', async () => {
  const { buildPracticeSetCopy } = await loadAdapter();
  const base = { stage: '强化', overallAccuracyRate: 80, topWeakPoint: null };

  const sprint = buildPracticeSetCopy({ ...base, questionSetFocus: '真题错题回炉训练' });
  assert.equal(sprint.title, '真题错题回炉训练');
  assert.equal(sprint.focus, '近年真题、错题重做、限时复盘');

  const weak = buildPracticeSetCopy({ ...base, questionSetFocus: '高频基础考点补强' });
  assert.equal(weak.title, '高频基础考点补强');
  assert.equal(weak.focus, '例题理解、概念复述、基础题组');

  const standard = buildPracticeSetCopy({ ...base, questionSetFocus: '薄弱专题突破' });
  assert.equal(standard.title, '薄弱专题突破');
  assert.equal(standard.focus, '相似考点辨析、变式题组、错因复盘');
});

test('fallback branch mirrors legacy stage/accuracy when the engine has no QUESTION_SET', async () => {
  const { buildPracticeSetCopy } = await loadAdapter();
  const sprint = buildPracticeSetCopy({ stage: '冲刺', overallAccuracyRate: 90, questionSetFocus: null, topWeakPoint: null });
  assert.equal(sprint.title, '真题错题回炉训练');

  const weak = buildPracticeSetCopy({ stage: '强化', overallAccuracyRate: 40, questionSetFocus: null, topWeakPoint: null });
  assert.equal(weak.title, '高频基础考点补强');

  const standard = buildPracticeSetCopy({ stage: '强化', overallAccuracyRate: 80, questionSetFocus: null, topWeakPoint: null });
  assert.equal(standard.title, '薄弱专题突破');
});

test('reason prefers the top weak point and falls back without one', async () => {
  const { buildPracticeSetCopy } = await loadAdapter();
  const withPoint = buildPracticeSetCopy({
    stage: '强化', overallAccuracyRate: 80, questionSetFocus: '薄弱专题突破',
    topWeakPoint: { title: '树的遍历应用', accuracyRate: 50 },
  });
  assert.equal(withPoint.reason, '优先覆盖 树的遍历应用，当前正确率 50%。');

  const withoutPoint = buildPracticeSetCopy({
    stage: '强化', overallAccuracyRate: 80, questionSetFocus: '薄弱专题突破', topWeakPoint: null,
  });
  assert.equal(withoutPoint.reason, '当前薄弱点较少，按今日计划和高频考点生成练习题组。');
});

test('nodeId bridge maps to KP ids, dedupes, and falls back to nodeId', async () => {
  const { bridgeKnowledgePointIds } = await loadAdapter();
  const bridged = bridgeKnowledgePointIds({
    nodeIds: ['node-1', 'node-2', 'node-1'],
    kpIdsByNodeId: { 'node-1': ['kp-a', 'kp-b'], 'node-2': ['kp-a'] },
  });
  assert.deepEqual(bridged, ['kp-a', 'kp-b']);

  const orphan = bridgeKnowledgePointIds({ nodeIds: ['node-orphan'], kpIdsByNodeId: {} });
  assert.deepEqual(orphan, ['node-orphan'], 'unbridged nodes must fall back to their nodeId');
});
