import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const shared = require('../packages/shared/dist/index.js');

const asOf = '2026-08-29T08:00:00.000Z';

async function loadModule(dependencies = {}) {
  const path = 'apps/web/src/api/endpoints/dashboard.ts';
  const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)((specifier) => {
    const key = Object.keys(dependencies).find((candidate) => specifier.includes(candidate));
    if (key) return dependencies[key];
    if (specifier.includes('@kaoyan408/shared')) return shared;
    if (specifier.includes('../client')) return { API_BASE_URL: '', fetchWithAuth: async () => { throw new Error('network disabled in unit test'); }, authenticatedFetch: async () => { throw new Error('network disabled in unit test'); } };
    if (specifier.includes('./score-center')) return { fetchMyMastery: async () => { throw new Error('use buildMasteryMapFromState directly in unit tests'); } };
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
  return module.exports;
}

// 最小静态目录（与 shared CatalogAtomicPoint/CatalogSubject 结构一致）
function fakeCatalog() {
  return {
    DS: {
      code: 'DS',
      name: '数据结构',
      chapters: [
        {
          id: 'ds-tree', name: '树与二叉树',
          sections: [
            { id: 'ds-tree-1', name: '遍历', points: [
              { id: 'node-ds-traversal', name: '树的遍历应用', subject: 'DS', order: 1, importance: 5, difficulty: 3, prerequisites: [], relatedPoints: [], evidence: { recent3Frequency: 2, recent5Frequency: 5, allTimeEvidence: 9, trendDirection: 'UP', trendDelta: 1, evidenceConfidence: 'HIGH' } },
            ] },
          ],
        },
      ],
    },
    CO: {
      code: 'CO', name: '计算机组成原理',
      chapters: [
        { id: 'co-cache', name: '存储系统', sections: [
          { id: 'co-cache-1', name: '映射', points: [
            { id: 'node-co-cache', name: 'Cache 映射与替换', subject: 'CO', order: 1, importance: 5, difficulty: 3, prerequisites: [], relatedPoints: [], evidence: null },
          ] },
        ] },
      ],
    },
    OS: { code: 'OS', name: '操作系统', chapters: [] },
    CN: { code: 'CN', name: '计算机网络', chapters: [] },
  };
}

function item(overrides = {}) {
  return {
    knowledgeNodeId: 'node-ds-traversal',
    mastery: 0.382,
    accuracy: 0.5,
    recentAccuracy: 0.5,
    attempts: 8,
    correctCount: 4,
    wrongCount: 4,
    status: 'weak',
    lastLearnedAt: null,
    lastReviewedAt: null,
    nextReviewAt: null,
    ...overrides,
  };
}

test('mastery map is assembled from UserKnowledgeMastery items with catalog grouping', async () => {
  const { buildMasteryMapFromState } = await loadModule({ catalogData: { getKnowledgeCatalog: fakeCatalog } });
  const map = buildMasteryMapFromState('u-1', { generatedAt: asOf, items: [item()] }, fakeCatalog());
  assert.equal(map.userId, 'u-1');
  assert.equal(map.title, '408 掌握度地图');
  assert.equal(map.generatedAt, asOf);
  // subjects 按目录键序 DS/CO/OS/CN，且科目名来自目录
  assert.deepEqual(map.subjects.map((subject) => subject.subject), ['数据结构', '计算机组成原理', '操作系统', '计算机网络']);
  const point = map.subjects[0].points[0];
  assert.equal(point.knowledgePointId, 'node-ds-traversal');
  assert.equal(point.title, '树的遍历应用');
  assert.equal(point.chapter, '树与二叉树');
  assert.equal(point.masteryRate, 38, 'EWMA mastery should render as a percentage');
  assert.equal(point.practiceCount, 8);
  assert.equal(point.status, 'weak');
});

test('untouched and unknown-subject items are excluded from the map', async () => {
  const { buildMasteryMapFromState } = await loadModule({ catalogData: { getKnowledgeCatalog: fakeCatalog } });
  const map = buildMasteryMapFromState('u-1', { generatedAt: asOf, items: [
    item({ knowledgeNodeId: 'node-ds-traversal', attempts: 0, status: 'untouched' }),
    item({ knowledgeNodeId: 'node-unknown', attempts: 2, correctCount: 1, wrongCount: 1, mastery: 0.8, status: 'review' }),
  ] }, fakeCatalog());
  assert.equal(map.subjects[0].points.length, 0, 'untouched nodes must not enter the map');
  // 与后端 node 模式一致：无法归入四科的节点（目录漂移）不进地图，避免出现“未分类”科目
  assert.equal(map.subjects.every((subject) => subject.points.length === 0), true);
});

test('weakest points are sorted by mastery rate across subjects', async () => {
  const { buildMasteryMapFromState } = await loadModule({ catalogData: { getKnowledgeCatalog: fakeCatalog } });
  const map = buildMasteryMapFromState('u-1', { generatedAt: asOf, items: [
    item({ knowledgeNodeId: 'node-ds-traversal', mastery: 0.9, attempts: 5, correctCount: 5, wrongCount: 0, status: 'mastered' }),
    item({ knowledgeNodeId: 'node-co-cache', mastery: 0.2, attempts: 5, correctCount: 1, wrongCount: 4, status: 'weak' }),
  ] }, fakeCatalog());
  assert.equal(map.weakestPoints[0].knowledgePointId, 'node-co-cache');
  assert.equal(map.subjects[0].masteredCount, 1);
  assert.equal(map.subjects[1].weakCount, 1);
});
