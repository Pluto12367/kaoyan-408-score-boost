import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('backend exposes node quest repository, service and routes', () => {
  const repository = readFileSync('apps/api/src/score-center/repository.ts', 'utf8');
  const service = readFileSync('apps/api/src/score-center/service.ts', 'utf8');
  const routes = readFileSync('apps/api/src/score-center/routes.ts', 'utf8');
  assert.match(repository, /loadNodeQuest/);
  assert.match(repository, /saveNodeQuestAttempt/);
  assert.match(service, /getNodeQuest/);
  assert.match(service, /completeNodeQuest/);
  assert.match(service, /deriveNodeQuestStatus/);
  assert.match(routes, /@Get\('knowledge\/:id\/quest'\)/);
  assert.match(routes, /@Post\('knowledge\/:id\/quest\/complete'\)/);
});

test('mastery summary carries quest status for catalog badges', () => {
  const service = readFileSync('apps/api/src/score-center/service.ts', 'utf8');
  assert.match(service, /questStatus/);
});

test('schema adds the user node quest milestone table', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  assert.match(schema, /model UserNodeQuest/);
});

test('frontend wires node quest api, drawer section and app session', () => {
  const api = readFileSync('apps/web/src/api/endpoints/score-center.ts', 'utf8');
  const drawer = readFileSync('apps/web/src/features/knowledge-catalog/KnowledgePointDetailDrawer.tsx', 'utf8');
  const catalog = readFileSync('apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx', 'utf8');
  const app = readFileSync('apps/web/src/App.tsx', 'utf8');
  assert.match(api, /fetchNodeQuest/);
  assert.match(api, /completeNodeQuest/);
  assert.match(drawer, /闯关/);
  assert.match(drawer, /开始闯关/);
  assert.match(catalog, /onStartQuest/);
  assert.match(app, /questContext/);
});

test('quest context survives returning to the catalog for settlement', () => {
  const app = readFileSync('apps/web/src/App.tsx', 'utf8');
  assert.match(
    app,
    /questContext && activeSection !== 'question' && activeSection !== 'knowledge-catalog'/,
    'leaving practice for the catalog must keep the quest context so the round can be settled',
  );
});
