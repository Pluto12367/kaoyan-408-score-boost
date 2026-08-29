import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadModule(path, dependencies = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const localRequire = (specifier) => {
    const key = Object.keys(dependencies).find((candidate) => specifier.includes(candidate));
    if (key) return dependencies[key];
    if (specifier.includes('@nestjs/common')) return { Injectable: () => (target) => target, Optional: () => (target, _key, _index) => undefined };
    throw new Error(`Unexpected dependency: ${specifier}`);
  };
  Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
  return module.exports;
}

function createSnapshot() {
  return {
    source: 'today_plan_student_state_score_center', userId: 'u-1', asOf: '2026-08-24T08:00:00.000Z',
    planFacts: { planId: 'plan-1', phase: '强化', status: 'ACTIVE', windowStart: '2026-08-18', windowEnd: '2026-08-24', generatedAt: null, checkpointState: null },
    taskFacts: { todayTasks: [], counts: { pending: 0, inProgress: 0, postponed: 0, completed: 0 }, weekDays: [] },
    reviewFacts: { dueCount: 0, overdueCount: 0, nextReviewAt: null, items: [] },
    activityFacts: { streakDays: 0, isActiveToday: false, latestActivityAt: null },
    masteryFacts: { source: 'empty', averageMastery: 0, weakCount: 0, reviewCount: 0, masteredCount: 0, lastUpdatedAt: null, weakPoints: [] },
    scoreFacts: { available: false, generatedAt: null, raw: null },
  };
}

async function createQuery({ snapshot = createSnapshot(), adapterResult = { userId: 'u-1', phase: '强化' } } = {}) {
  const projection = await loadModule('apps/api/src/study/today-plan-query.service.ts', {
    'today-plan-projection.service': {},
    'today-plan.adapter': { toLegacyTodayPlan: () => adapterResult },
  });
  const calls = [];
  const projectionStub = { getSnapshot: async (...args) => { calls.push(args); return snapshot; } };
  const service = new projection.TodayPlanQueryService(projectionStub);
  return { service, calls, snapshot, adapterResult };
}

test('query service calls projection with userId and fixed asOf', async () => {
  const { service, calls, snapshot } = await createQuery();
  const asOf = new Date('2026-08-24T08:00:00.000Z');
  await service.getTodayPlanCompat('u-1', asOf);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'u-1');
  assert.equal(calls[0][1], asOf);
  assert.equal(snapshot.userId, 'u-1');
});

test('query service returns adapter DTO', async () => {
  const adapterResult = { userId: 'u-1', phase: '强化', reviewDue: 3 };
  const { service } = await createQuery({ adapterResult });
  const result = await service.getTodayPlanCompat('u-1');
  assert.deepEqual(result, adapterResult);
});

test('query service applies default asOf and forwards it to projection', async () => {
  const { service, calls } = await createQuery();
  const before = Date.now();
  await service.getTodayPlanCompat('u-1');
  const after = Date.now();
  assert.equal(calls.length, 1);
  assert.ok(calls[0][1] instanceof Date);
  assert.ok(calls[0][1].getTime() >= before && calls[0][1].getTime() <= after);
});

test('no database projection result remains legacy-compatible', async () => {
  const adapterResult = { userId: 'u-empty', phase: '', reviewDue: 0, priorityTasks: [], weekProgress: [], scoreCenter: null };
  const { service } = await createQuery({ snapshot: { ...createSnapshot(), userId: 'u-empty' }, adapterResult });
  const result = await service.getTodayPlanCompat('u-empty', new Date('2026-08-24T08:00:00.000Z'));
  assert.deepEqual(result, adapterResult);
});

test('query service keeps the legacy delegate optional and free of other dependencies', async () => {
  const source = await readFile(new URL('../apps/api/src/study/today-plan-query.service.ts', import.meta.url), 'utf8');
  // 过渡期契约：compat 查询允许以 @Optional 方式委托遗留 StudyService（投影链未达
  // parity 的字段见服务内注释）；无遗留实例时仍走投影链。其余脏依赖依旧禁止。
  assert.match(source, /@Optional\(\) private readonly legacy\?: StudyService/);
  assert.equal(source.includes('Controller'), false);
  assert.equal(source.includes('Prisma'), false);
  assert.equal(source.includes('Repository'), false);
});
