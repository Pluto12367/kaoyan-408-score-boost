import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

test('canonical overview query is exposed without replacing the legacy dashboard endpoint', () => {
  const controller = read('apps/api/src/study/study.controller.ts');
  const query = read('apps/api/src/study/overview-query.service.ts');
  assert.match(controller, /@Get\('overview\/canonical'\)/);
  assert.match(controller, /overviewQuery\.getCanonicalOverview/);
  assert.match(query, /OverviewReportProjectionService/);
  assert.match(query, /buildOverview\(userId, asOf\)/);
  assert.match(controller, /@Get\('dashboard\/overview'\)/);
});

test('canonical overview query forwards user and fixed asOf without writes', async () => {
  const { OverviewQueryService } = require('../apps/api/src/study/overview-query.service.ts');
  const asOf = new Date('2026-09-02T12:00:00.000Z');
  const calls = [];
  const service = new OverviewQueryService({
    async buildOverview(userId, receivedAsOf) {
      calls.push([userId, receivedAsOf]);
      return { contractVersion: 'overview-report-v1', userId, asOf: receivedAsOf.toISOString() };
    },
  });
  const result = await service.getCanonicalOverview('u-1', asOf);
  assert.equal(result.userId, 'u-1');
  assert.deepEqual(calls, [['u-1', asOf]]);
});

test('homepage view model prefers canonical node mastery and review facts', () => {
  const viewModel = read('apps/web/src/features/student/home/useDashboardViewModel.ts');
  const sections = read('apps/web/src/features/student/StudentSections.tsx');
  const home = read('apps/web/src/features/student/home/StudentHome.tsx');
  assert.match(viewModel, /canonicalOverview/);
  assert.match(viewModel, /canonicalOverview\.mastery/);
  assert.match(viewModel, /canonicalOverview\.weaknesses\.nodeWeaknesses/);
  assert.match(viewModel, /canonicalOverview\?\.reviewStatus\.pendingWrongQuestionCount/);
  assert.match(sections, /canonicalOverview/);
  assert.match(home, /canonicalOverview/);
  assert.match(home, /canonicalOverviewError/);
  assert.match(home, /新版总览暂不可用/);
});

test('homepage canonical adapter does not mix node and point identity spaces', () => {
  const viewModel = read('apps/web/src/features/student/home/useDashboardViewModel.ts');
  assert.doesNotMatch(viewModel, /nodeWeaknesses[\s\S]{0,500}knowledgePointId/);
  assert.doesNotMatch(viewModel, /knowledgePointId[\s\S]{0,500}knowledgeNodeId/);
});
