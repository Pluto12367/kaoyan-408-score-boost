import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadModule(path, dependencies = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)((specifier) => {
    const key = Object.keys(dependencies).find((candidate) => specifier.includes(candidate));
    if (key) return dependencies[key];
    if (specifier.includes('@nestjs/common')) return { Injectable: () => (target) => target, Optional: () => (target, _key, _index) => undefined };
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
  return module.exports;
}

const asOf = new Date('2026-08-24T08:00:00.000Z');
const snapshot = { source: 'dashboard_facts', userId: 'u-1', asOf: asOf.toISOString() };
const dto = { source: 'dashboard_facts', generatedAt: asOf.toISOString(), student: { id: 'u-1' } };

async function createQuery() {
  const calls = { projection: [], adapter: [] };
  const query = await loadModule('apps/api/src/study/dashboard-query.service.ts', {
    'dashboard-projection.service': { DashboardProjectionService: class {} },
    'dashboard.adapter': { toLegacyDashboardOverview: (value, generatedAt) => { calls.adapter.push([value, generatedAt]); return dto; } },
  });
  const service = new query.DashboardQueryService({
    getSnapshot: async (...args) => { calls.projection.push(args); return snapshot; },
  });
  return { service, calls };
}

test('query service calls projection with fixed userId and asOf', async () => {
  const { service, calls } = await createQuery();
  await service.getDashboardOverviewCompat('u-1', asOf);
  assert.deepEqual(calls.projection, [['u-1', asOf]]);
});

test('query service calls adapter with projected snapshot and generatedAt', async () => {
  const { service, calls } = await createQuery();
  const result = await service.getDashboardOverviewCompat('u-1', asOf);
  assert.deepEqual(calls.adapter, [[snapshot, asOf.toISOString()]]);
  assert.deepEqual(result, dto);
});

test('query service applies a default asOf and forwards it', async () => {
  const { service, calls } = await createQuery();
  const before = Date.now();
  await service.getDashboardOverviewCompat('u-1');
  const after = Date.now();
  assert.equal(calls.projection.length, 1);
  assert.ok(calls.projection[0][1] instanceof Date);
  assert.ok(calls.projection[0][1].getTime() >= before && calls.projection[0][1].getTime() <= after);
});

test('no database projection result is returned as a compatible DTO', async () => {
  const { service } = await createQuery();
  assert.deepEqual(await service.getDashboardOverviewCompat('u-1', asOf), dto);
});

test('query service has no forbidden read or presentation dependencies', async () => {
  const source = await readFile(new URL('../apps/api/src/study/dashboard-query.service.ts', import.meta.url), 'utf8');
  for (const forbidden of ['StudyService', 'Prisma', 'Repository', 'Controller', 'recommendation', 'nextAction']) assert.equal(source.includes(forbidden), false, `${forbidden} must not be present`);
});
