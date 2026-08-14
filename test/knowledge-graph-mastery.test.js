import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('backend exposes the student node mastery endpoint and service', () => {
  const routes = readFileSync('apps/api/src/score-center/routes.ts', 'utf8');
  const service = readFileSync('apps/api/src/score-center/service.ts', 'utf8');
  assert.match(routes, /@Get\('knowledge\/mastery'\)/);
  assert.match(routes, /@Roles\('student', 'teacher', 'admin'\)/);
  assert.match(service, /async getMyMastery\(userId: string\)/);
});

test('shared exposes the node mastery status helper', () => {
  const scoreCenterIndex = readFileSync('packages/shared/src/score-center/index.ts', 'utf8');
  assert.match(scoreCenterIndex, /export \* from '\.\/mastery'/);
});

test('catalog page loads node mastery and passes it to tree and drawer', () => {
  const catalog = readFileSync('apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx', 'utf8');
  const tree = readFileSync('apps/web/src/features/knowledge-catalog/KnowledgeTree.tsx', 'utf8');
  const drawer = readFileSync('apps/web/src/features/knowledge-catalog/KnowledgePointDetailDrawer.tsx', 'utf8');
  const api = readFileSync('apps/web/src/api/endpoints/score-center.ts', 'utf8');
  const app = readFileSync('apps/web/src/App.tsx', 'utf8');
  assert.match(api, /fetchMyMastery/);
  assert.match(catalog, /fetchMyMastery/);
  assert.match(catalog, /masteryById/);
  assert.match(tree, /masteryStatus/);
  assert.match(drawer, /我的掌握度/);
  assert.match(drawer, /去练习/);
  assert.match(app, /<KnowledgeCatalog[\s\S]*onNavigate=\{setActiveSection\}/);
});
