import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('backend exposes a mastery trend endpoint and snapshot loader', () => {
  const service = readFileSync('apps/api/src/score-center/service.ts', 'utf8');
  const repository = readFileSync('apps/api/src/score-center/repository.ts', 'utf8');
  const routes = readFileSync('apps/api/src/score-center/routes.ts', 'utf8');
  assert.match(service, /getMasteryTrend/);
  assert.match(service, /buildMasteryTrend/);
  assert.match(repository, /loadMasterySnapshots/);
  assert.match(routes, /@Get\('mastery-trend'\)/);
});

test('mastery snapshots are persisted on writes', () => {
  const service = readFileSync('apps/api/src/score-center/service.ts', 'utf8');
  assert.match(service, /saveMasterySnapshot/);
});

test('schema and frontend wire the mastery trend panel', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8');
  const api = readFileSync('apps/web/src/api/endpoints/trend.ts', 'utf8');
  const panel = readFileSync('apps/web/src/features/report/MasteryTrendPanel.tsx', 'utf8');
  const workspace = readFileSync('apps/web/src/features/report/ReportWorkspace.tsx', 'utf8');
  assert.match(schema, /model UserMasterySnapshot/);
  assert.match(api, /fetchMasteryTrend/);
  assert.match(panel, /掌握度趋势/);
  assert.match(panel, /fetchMasteryTrend/);
  assert.match(workspace, /MasteryTrendPanel/);
});
