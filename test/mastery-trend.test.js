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

const NODE_CATALOG = [
  { knowledgeNodeId: 'n-a', subject: '数据结构', title: '薄弱点', chapter: 'C1' },
  { knowledgeNodeId: 'n-b', subject: '数据结构', title: '掌握点', chapter: 'C1' },
  { knowledgeNodeId: 'n-c', subject: '数据结构', title: '下滑点', chapter: 'C1' },
];

test('buildMasteryTrend builds overall and per-subject series from snapshots', async () => {
  const { buildMasteryTrend } = await loadNodeMastery();
  const trend = buildMasteryTrend({
    userId: 'u-1',
    snapshots: [
      { knowledgeNodeId: 'n-a', mastery: 0.2, snapshotDate: '2026-08-10T00:00:00.000Z' },
      { knowledgeNodeId: 'n-a', mastery: 0.3, snapshotDate: '2026-08-11T00:00:00.000Z' },
      { knowledgeNodeId: 'n-b', mastery: 0.9, snapshotDate: '2026-08-11T00:00:00.000Z' },
      { knowledgeNodeId: 'n-c', mastery: 0.8, snapshotDate: '2026-08-10T00:00:00.000Z' },
      { knowledgeNodeId: 'n-c', mastery: 0.5, snapshotDate: '2026-08-11T00:00:00.000Z' },
    ],
    nodeCatalog: NODE_CATALOG,
    subjects: ['数据结构', '计算机组成原理', '操作系统', '计算机网络'],
    days: 7,
  });
  assert.deepEqual(trend.overall, [
    { date: '2026-08-10', averageMastery: 50 },
    { date: '2026-08-11', averageMastery: 57 },
  ]);
  const ds = trend.subjects.find((subject) => subject.subject === '数据结构');
  assert.equal(ds.averageMastery, 57);
  assert.deepEqual(
    ds.weakestNodes.map((node) => node.knowledgeNodeId),
    ['n-a'],
  );
  assert.deepEqual(
    trend.improving.map((item) => [item.knowledgeNodeId, item.delta]),
    [['n-a', 10]],
  );
  assert.deepEqual(
    trend.declining.map((item) => [item.knowledgeNodeId, item.delta]),
    [['n-c', -30]],
  );
});

test('buildMasteryTrend handles empty snapshots', async () => {
  const { buildMasteryTrend } = await loadNodeMastery();
  const trend = buildMasteryTrend({
    userId: 'u-1',
    snapshots: [],
    nodeCatalog: NODE_CATALOG,
    subjects: ['数据结构', '计算机组成原理', '操作系统', '计算机网络'],
    days: 14,
  });
  assert.deepEqual(trend.overall, []);
  assert.equal(trend.subjects.length, 4);
  assert.deepEqual(trend.improving, []);
  assert.deepEqual(trend.declining, []);
});
