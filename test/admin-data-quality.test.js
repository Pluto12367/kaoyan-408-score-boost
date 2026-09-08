import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// V11-M1 — Data Quality observability (read-only).
// Purpose: make silent data exclusions visible (audit B4/B6/B13): questions
// without node tags, knowledge points without a PRIMARY catalog mapping,
// nodes without frequency snapshots, sparse relation edges. The projection
// never mutates anything and never "fixes" data — it only makes gaps
// measurable so content work can be prioritized.

const DQ_URL = new URL('../apps/api/src/study/admin-data-quality.ts', import.meta.url);

async function loadDQ() {
  const source = await readFile(DQ_URL, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(() => {
    throw new Error('admin-data-quality must stay dependency-free');
  }, module, module.exports);
  return module.exports;
}

test('buildDataQualityReport computes coverage ratios and health flags', async () => {
  const { buildDataQualityReport } = await loadDQ();
  const result = buildDataQualityReport({
    questionTotal: 320,
    questionIdsWithNodeTags: new Set(['q-1', 'q-2']),
    knowledgePointTotal: 16,
    knowledgePointIdsWithPrimaryMap: new Set(['ds-tree', 'co-cache']),
    nodeIds: [
      { id: 'n-1', subject: '数据结构' },
      { id: 'n-2', subject: '数据结构' },
      { id: 'n-3', subject: '操作系统' },
      { id: 'n-4', subject: '操作系统' },
    ],
    nodeIdsWithFrequencySnapshot: new Set(['n-1', 'n-3']),
    prerequisiteEdgeCount: 2,
    relatedEdgeCount: 1,
    samples: {
      questionsWithoutNodeTags: ['q-3'],
      knowledgePointsWithoutPrimaryMap: ['ds-list'],
      nodesWithoutFrequencySnapshot: [{ id: 'n-2', subject: '数据结构' }, { id: 'n-4', subject: '操作系统' }],
    },
    generatedAt: '2026-09-08T00:00:00.000Z',
  });

  assert.equal(result.questions.total, 320);
  assert.equal(result.questions.withNodeTags, 2);
  assert.equal(result.questions.withoutNodeTags, 318);
  assert.equal(result.questions.coverageRate, 1, '2/320 → 0% displayed as 0, coverageRate rounds to 0');
  assert.equal(result.knowledgePoints.total, 16);
  assert.equal(result.knowledgePoints.withoutPrimaryMap, 14);
  assert.equal(result.nodes.total, 4);
  assert.equal(result.nodes.withFrequencySnapshot, 2);
  assert.equal(result.nodes.withoutFrequencySnapshot, 2);
  assert.deepEqual(
    result.nodes.bySubject.map((row) => `${row.subject}:${row.total}:${row.withSnapshot}`).sort(),
    ['操作系统:2:1', '数据结构:2:1'].sort(),
    'per-subject rows are deterministic regardless of tie-break order',
  );
  assert.equal(result.relations.prerequisite, 2);
  assert.equal(result.relations.related, 1);
  assert.equal(result.generatedAt, '2026-09-08T00:00:00.000Z');
  assert.equal(result.source, 'derived');
});

test('health flags fire exactly on the audited gap conditions', async () => {
  const { buildDataQualityReport } = await loadDQ();
  const result = buildDataQualityReport({
    questionTotal: 320,
    questionIdsWithNodeTags: new Set(['q-1', 'q-2']),
    knowledgePointTotal: 16,
    knowledgePointIdsWithPrimaryMap: new Set(['ds-tree']),
    nodeIds: [
      { id: 'n-1', subject: '数据结构' },
      { id: 'n-2', subject: '数据结构' },
    ],
    nodeIdsWithFrequencySnapshot: new Set(['n-1']),
    prerequisiteEdgeCount: 0,
    relatedEdgeCount: 0,
    samples: {
      questionsWithoutNodeTags: [],
      knowledgePointsWithoutPrimaryMap: ['ds-list'],
      nodesWithoutFrequencySnapshot: [{ id: 'n-2', subject: '数据结构' }],
    },
    generatedAt: '2026-09-08T00:00:00.000Z',
  });
  const flags = Object.fromEntries(result.healthFlags.map((flag) => [flag.flag, true]));
  assert.equal(flags.questions_missing_node_tags, true, 'B13: untagged questions');
  assert.equal(flags.knowledge_points_missing_primary_map, true, 'B13: unmapped knowledge points');
  assert.equal(flags.nodes_missing_frequency_snapshot, true, 'B4: silent recommendation exclusion');
  assert.equal(flags.relations_sparse, true, 'B6: sparse relation edges (0 prerequisite)');
});

test('fully healthy catalog produces zero flags and 100% coverage rows', async () => {
  const { buildDataQualityReport } = await loadDQ();
  const result = buildDataQualityReport({
    questionTotal: 2,
    questionIdsWithNodeTags: new Set(['q-1', 'q-2']),
    knowledgePointTotal: 2,
    knowledgePointIdsWithPrimaryMap: new Set(['a', 'b']),
    nodeIds: [
      { id: 'n-1', subject: '数据结构' },
      { id: 'n-2', subject: '操作系统' },
    ],
    nodeIdsWithFrequencySnapshot: new Set(['n-1', 'n-2']),
    prerequisiteEdgeCount: 10,
    relatedEdgeCount: 5,
    samples: { questionsWithoutNodeTags: [], knowledgePointsWithoutPrimaryMap: [], nodesWithoutFrequencySnapshot: [] },
    generatedAt: '2026-09-08T00:00:00.000Z',
  });
  assert.deepEqual([...result.healthFlags], [], 'healthy catalog → zero flags');
  assert.equal(result.questions.coverageRate, 100);
  assert.equal(result.nodes.withoutFrequencySnapshot, 0);
});

test('purity: dependency-free, deterministic', async () => {
  const source = await readFile(DQ_URL, 'utf8');
  const imports = [...source.matchAll(/^import\s+(?:[^'"]+from\s+)?['"]([^'"]+)['"]/gm)].map((match) => match[1]);
  assert.deepEqual(imports, [], 'admin-data-quality stays dependency-free');
  assert.doesNotMatch(source, /Date\.now|Math\.random/);
});

test('wiring: admin-only endpoint, service assembly, module registration', async () => {
  const controller = await readFile(new URL('../apps/api/src/study/study.controller.ts', import.meta.url), 'utf8');
  assert.match(controller, /Get\('admin\/data-quality'\)/);
  assert.match(
    controller,
    /@Get\('admin\/data-quality'\)[\s\S]{0,200}@Roles\('admin'\)/,
    'data quality is an admin-only read',
  );

  const service = await readFile(new URL('../apps/api/src/study/admin-data-quality.service.ts', import.meta.url), 'utf8');
  assert.match(service, /questionKnowledgeNodeTag\.groupBy/);
  assert.match(service, /knowledgeFrequencySnapshot\.findMany/);
  assert.match(service, /knowledgeRelation\.(findMany|count)/);
  assert.match(service, /buildDataQualityReport/);
  assert.doesNotMatch(service, /\.create\(|\.update\(|\.delete\(/, 'read-only service');

  const moduleSource = await readFile(new URL('../apps/api/src/study/study.module.ts', import.meta.url), 'utf8');
  assert.match(moduleSource, /AdminDataQualityService/);
});
