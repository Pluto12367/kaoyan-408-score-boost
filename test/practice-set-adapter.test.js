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

test('reason prefers the top weak point and never claims one it cannot evidence', async () => {
  const { buildPracticeSetCopy } = await loadAdapter();
  const withPoint = buildPracticeSetCopy({
    stage: '强化', overallAccuracyRate: 80, questionSetFocus: '薄弱专题突破',
    topWeakPoint: { title: '树的遍历应用', accuracyRate: 50 },
  });
  assert.equal(withPoint.reason, '优先覆盖 树的遍历应用，当前正确率 50%。');

  // G1 Release Hardening (A1, EVIDENCED_REASON-only): the fallback used to say
  // "当前薄弱点较少", a conclusion the call site cannot support — an empty weak
  // set means "no records yet" just as often as "no standout weakness", and the
  // first case makes the sentence false. It must state the absence of evidence.
  const withoutPoint = buildPracticeSetCopy({
    stage: '强化', overallAccuracyRate: 80, questionSetFocus: '薄弱专题突破', topWeakPoint: null,
  });
  assert.match(withoutPoint.reason, /^当前证据不足/);
  assert.ok(
    !withoutPoint.reason.includes('薄弱点较少'),
    'the fallback must not claim the student has few weak points',
  );
});

test('nodeId bridge maps to real KP ids, dedupes, and never aliases an orphan node', async () => {
  const { bridgeKnowledgePointIds } = await loadAdapter();
  const bridged = bridgeKnowledgePointIds({
    nodeIds: ['node-1', 'node-2', 'node-1'],
    kpIdsByNodeId: { 'node-1': ['kp-a', 'kp-b'], 'node-2': ['kp-a'] },
  });
  assert.deepEqual(bridged, ['kp-a', 'kp-b']);

  const orphan = bridgeKnowledgePointIds({ nodeIds: ['node-orphan'], kpIdsByNodeId: {} });
  assert.deepEqual(orphan, [], 'unbridged nodes must not be emitted as Point IDs');
});
