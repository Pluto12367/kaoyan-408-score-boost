import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Knowledge Galaxy renders a focused SVG workspace with interactive nodes', async () => {
  const galaxy = await source('apps/web/src/features/knowledge-catalog/KnowledgeGalaxy.tsx');

  assert.match(galaxy, /data-testid="knowledge-galaxy"/);
  assert.match(galaxy, /<svg/);
  assert.match(galaxy, /knowledge-galaxy-viewport/);
  assert.match(galaxy, /onSelectPoint/);
  assert.match(galaxy, /onClick/);
});

test('Galaxy mastery presentation uses the existing masteryById and shared status helper', async () => {
  const galaxy = await source('apps/web/src/features/knowledge-catalog/KnowledgeGalaxy.tsx');

  assert.match(galaxy, /masteryById/);
  assert.match(galaxy, /deriveNodeMasteryStatus/);
  assert.match(galaxy, /untouched|未评估/);
  assert.doesNotMatch(galaxy, /fetchMyMastery|fetchMasteryMap/);
});

test('Galaxy keeps stable, importance-aware node sizing and handles missing relationships', async () => {
  const galaxy = await source('apps/web/src/features/knowledge-catalog/KnowledgeGalaxy.tsx');

  assert.match(galaxy, /importance/);
  assert.match(galaxy, /prerequisites/);
  assert.match(galaxy, /relatedPoints/);
  assert.match(galaxy, /\?\? \[\]|\?\.length/);
  assert.doesNotMatch(galaxy, /Math\.random/);
});

test('KnowledgeCatalog feeds filtered knowledge points into Galaxy and reuses the detail drawer', async () => {
  const page = await source('apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx');

  assert.match(page, /KnowledgeGalaxy/);
  assert.match(page, /visibleSubject/);
  assert.match(page, /masteryById/);
  assert.match(page, /KnowledgePointDetailDrawer/);
  assert.match(page, /onSelectPoint/);
});

test('Galaxy selection follows the existing selected point and focus path', async () => {
  const page = await source('apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx');

  assert.match(page, /focusNodeId/);
  assert.match(page, /setSelectedPointId\(focusNodeId\)/);
  assert.match(page, /selectedPointId/);
  assert.match(page, /selectedPointId=\{selectedPointId\}/);
});

test('Existing KnowledgeCatalog search, filters, tree, and action callbacks remain present', async () => {
  const page = await source('apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx');

  for (const marker of [
    '搜索当前科目知识点',
    '只看高频',
    '重要度 ≥ 4',
    '全部展开',
    '全部收起',
    'KnowledgeTree',
    'onPracticeQuestion',
    'onStartQuest',
    'onCompleteQuest',
    'focusNodeId',
  ]) {
    assert.match(page, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), marker);
  }
});

test('Galaxy does not introduce a second knowledge or mastery data source', async () => {
  const galaxy = await source('apps/web/src/features/knowledge-catalog/KnowledgeGalaxy.tsx');

  assert.doesNotMatch(galaxy, /fetch\(/);
  assert.doesNotMatch(galaxy, /axios|reactflow|@xyflow|d3/);
  assert.doesNotMatch(galaxy, /galaxyMastery|knowledgeMasteryState/);
});

test('Galaxy styling is feature-scoped and does not touch frozen theme files', async () => {
  const css = await source('apps/web/src/features/knowledge-catalog/knowledge-galaxy.css');

  assert.match(css, /knowledge-galaxy-/);
  assert.doesNotMatch(css, /styles\.css|theme-optimizations|themePreference/);
});
