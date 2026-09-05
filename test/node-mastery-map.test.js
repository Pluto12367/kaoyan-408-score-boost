import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadNodeMastery() {
  const source = await readFile(new URL('../packages/shared/src/nodeMastery.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

test('deriveNodeWeakPoints keeps only weak nodes with attempts and sorts by weakness', async () => {
  const { deriveNodeWeakPoints } = await loadNodeMastery();
  const rows = [
    { knowledgeNodeId: 'n-mastered', subject: '数据结构', chapter: 'C2', title: '已掌握', importance: 4, frequency: 4, mastery: 0.85, attempts: 5, correctCount: 5, wrongCount: 0, status: 'mastered' },
    { knowledgeNodeId: 'n-weak', subject: '数据结构', chapter: 'C2', title: '薄弱', importance: 5, frequency: 5, mastery: 0.3, attempts: 4, correctCount: 1, wrongCount: 3, status: 'weak' },
    { knowledgeNodeId: 'n-untouched', subject: '数据结构', chapter: 'C2', title: '未练', importance: 3, frequency: 3, mastery: 0.5, attempts: 0, correctCount: 0, wrongCount: 0, status: 'untouched' },
    { knowledgeNodeId: 'n-review', subject: '数据结构', chapter: 'C2', title: '复习中', importance: 4, frequency: 4, mastery: 0.55, attempts: 3, correctCount: 2, wrongCount: 1, status: 'review' },
  ];
  const weakPoints = deriveNodeWeakPoints(rows);
  assert.deepEqual(weakPoints.map((point) => point.knowledgePointId), ['n-weak']);
  assert.equal(weakPoints[0].weaknessScore, 70);
  assert.equal(weakPoints[0].accuracyRate, 25);
  assert.equal(weakPoints[0].slowCount, 0);
});

test('buildNodeMasteryMap aggregates practiced nodes per subject with compatible statuses', async () => {
  const { buildNodeMasteryMap } = await loadNodeMastery();
  const map = buildNodeMasteryMap({
    userId: 'u-1',
    rows: [
      { knowledgeNodeId: 'n-weak', subject: '数据结构', chapter: 'C2', title: '薄弱', importance: 5, frequency: 5, mastery: 0.3, attempts: 4, correctCount: 1, wrongCount: 3, status: 'weak' },
      { knowledgeNodeId: 'n-review', subject: '数据结构', chapter: 'C2', title: '复习中', importance: 4, frequency: 4, mastery: 0.55, attempts: 3, correctCount: 2, wrongCount: 1, status: 'review' },
      { knowledgeNodeId: 'n-mastered', subject: '计算机组成原理', chapter: 'C1', title: '已掌握', importance: 4, frequency: 4, mastery: 0.85, attempts: 5, correctCount: 5, wrongCount: 0, status: 'mastered' },
      { knowledgeNodeId: 'n-untouched', subject: '操作系统', chapter: 'C1', title: '未练', importance: 3, frequency: 3, mastery: 0.5, attempts: 0, correctCount: 0, wrongCount: 0, status: 'untouched' },
    ],
    subjects: ['数据结构', '计算机组成原理', '操作系统', '计算机网络'],
  });
  assert.equal(map.subjects.length, 4);
  const ds = map.subjects.find((subject) => subject.subject === '数据结构');
  assert.equal(ds.averageMastery, 43);
  assert.equal(ds.weakCount, 1);
  assert.equal(ds.reviewCount, 1);
  assert.equal(ds.masteredCount, 0);
  assert.equal(ds.points.length, 2);
  assert.equal(ds.points[0].status, 'weak');
  assert.equal(ds.points[0].actionAnchor, '#wrong-book');
  assert.equal(ds.points[1].nextAction.length > 0, true);
  const os = map.subjects.find((subject) => subject.subject === '操作系统');
  assert.equal(os.points.length, 0);
  assert.equal(map.weakestPoints.length, 3);
  assert.equal(map.weakestPoints[0].knowledgeNodeId, 'n-weak');
});
