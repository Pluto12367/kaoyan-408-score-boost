import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const controllerPath = new URL('../apps/api/src/study/study.controller.ts', import.meta.url);
const modulePath = new URL('../apps/api/src/study/study.module.ts', import.meta.url);

async function read(path) {
  return readFile(path, 'utf8');
}

test('StudyController injects TodayPlanQueryService', async () => {
  const source = await read(controllerPath);
  assert.match(source, /import \{ TodayPlanQueryService \} from '\.\/today-plan-query\.service';/);
  assert.match(source, /private readonly todayPlanQuery: TodayPlanQueryService/);
});

test('GET /today/plan calls TodayPlanQueryService and preserves route', async () => {
  const source = await read(controllerPath);
  assert.match(source, /@Get\('today\/plan'\)/);
  assert.match(source, /return this\.todayPlanQuery\.getTodayPlanCompat\(user\.id\);/);
  assert.doesNotMatch(source, /getTodayPlan\(userId\)[\s\S]*?this\.studyService\.getTodayPlan/);
});

test('StudyModule registers TodayPlan query and projection services once', async () => {
  const source = await read(modulePath);
  assert.match(source, /import \{ TodayPlanQueryService \} from '\.\/today-plan-query\.service';/);
  assert.match(source, /import \{ TodayPlanProjectionService \} from '\.\/today-plan-projection\.service';/);
  assert.equal((source.match(/TodayPlanQueryService/g) ?? []).length, 2);
  assert.equal((source.match(/TodayPlanProjectionService/g) ?? []).length, 2);
});

test('controller does not use StudyService for today plan', async () => {
  const source = await read(controllerPath);
  const method = source.match(/@Get\('today\/plan'\)[\s\S]*?\n  \}/u)?.[0] ?? '';
  assert.notEqual(method, '');
  assert.doesNotMatch(method, /studyService\.getTodayPlan/);
  assert.match(method, /todayPlanQuery\.getTodayPlanCompat/);
});
