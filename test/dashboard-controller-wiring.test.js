import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const controllerPath = new URL('../apps/api/src/study/study.controller.ts', import.meta.url);
const modulePath = new URL('../apps/api/src/study/study.module.ts', import.meta.url);

test('StudyController injects DashboardQueryService', async () => {
  const source = await readFile(controllerPath, 'utf8');
  assert.match(source, /import \{ DashboardQueryService \} from '\.\/dashboard-query\.service';/);
  assert.match(source, /private readonly dashboardQuery: DashboardQueryService/);
});

test('GET /dashboard/overview calls DashboardQueryService and preserves route', async () => {
  const source = await readFile(controllerPath, 'utf8');
  assert.match(source, /@Get\('dashboard\/overview'\)/);
  assert.match(source, /return this\.dashboardQuery\.getDashboardOverviewCompat\(this\.resolveUserId\(user, viewUserId\)\);/);
  assert.doesNotMatch(source, /getDashboardOverview\(this\.resolveUserId\(user, viewUserId\)\)/);
});

test('controller response remains DTO-compatible and StudyService legacy path remains present', async () => {
  const source = await readFile(controllerPath, 'utf8');
  assert.match(source, /getDashboardOverviewCompat/);
  assert.match(source, /getDashboardOverview\(/);
  assert.equal(source.includes('return this.dashboardQuery.getDashboardOverviewCompat(this.resolveUserId(user, viewUserId));'), true);
});

test('StudyModule registers Dashboard projection and query services', async () => {
  const source = await readFile(modulePath, 'utf8');
  assert.match(source, /import \{ DashboardQueryService \} from '\.\/dashboard-query\.service';/);
  assert.match(source, /import \{ DashboardProjectionService \} from '\.\/dashboard-projection\.service';/);
  assert.match(source, /DashboardProjectionService/);
  assert.match(source, /DashboardQueryService/);
});
