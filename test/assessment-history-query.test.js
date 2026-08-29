import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadQuery() {
  const source = await readFile(new URL('../apps/api/src/study/assessment-history-query.service.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { fileName: 'assessment-history-query.service.ts', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)((specifier) => {
    const key = ({
      'assessment-history.projection.service': 'projection',
      'assessment-history.adapter': 'adapter',
    })[Object.keys({
      'assessment-history.projection.service': 'projection',
      'assessment-history.adapter': 'adapter',
    }).find((candidate) => specifier.includes(candidate))];
    if (key === 'projection') return { AssessmentHistoryProjectionService: class {} };
    if (key === 'adapter') return { toLegacyAssessmentHistory: () => ({ userId: 'u-1', items: [], summary: { attemptCount: 0, bestScore: 0, latestAccuracyRate: 0, improvementText: '' } }) };
    if (specifier.includes('@nestjs/common')) return { Injectable: () => (target) => target, Optional: () => (target, _key, _index) => undefined };
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
  return module.exports;
}

const asOf = new Date('2026-08-24T08:00:00.000Z');

const snapshot = {
  source: 'assessment_history_facts',
  userId: 'u-1',
  asOf: asOf.toISOString(),
  items: [],
  summaryFacts: { attemptCount: 0, bestScore: 0, latestAccuracyRate: 0, improvementText: '' },
  latestSubmittedAt: null,
};

test('query calls projection then adapter and returns DTO', async () => {
  const calls = { projection: [], adapter: [] };
  const query = await loadQuery();
  const service = new query.AssessmentHistoryQueryService({
    getSnapshot: async (...args) => {
      calls.projection.push(args);
      return snapshot;
    },
  }, {
    toLegacyAssessmentHistory: (...args) => {
      calls.adapter.push(args);
      return { userId: 'u-1', items: [], summary: { attemptCount: 0, bestScore: 0, latestAccuracyRate: 0, improvementText: '' } };
    },
  });
  const dto = await service.getAssessmentHistoryCompat('u-1', asOf);
  assert.equal(calls.projection.length, 1);
  assert.equal(calls.projection[0][0], 'u-1');
  assert.equal(calls.projection[0][1], asOf);
  assert.equal(calls.adapter.length, 1);
  assert.deepEqual(dto, { userId: 'u-1', items: [], summary: { attemptCount: 0, bestScore: 0, latestAccuracyRate: 0, improvementText: '' } });
});

test('query uses default asOf and does not mutate snapshot', async () => {
  const query = await loadQuery();
  const snap = structuredClone(snapshot);
  const service = new query.AssessmentHistoryQueryService({ getSnapshot: async () => snap }, { toLegacyAssessmentHistory: (value) => ({ userId: value.userId, items: value.items, summary: value.summaryFacts }) });
  const before = JSON.stringify(snap);
  const dto = await service.getAssessmentHistoryCompat('u-1');
  assert.equal(dto.userId, 'u-1');
  assert.equal(JSON.stringify(snap), before);
});

test('query has no StudyService, Prisma, Controller, or repository dependencies', async () => {
  const source = await readFile(new URL('../apps/api/src/study/assessment-history-query.service.ts', import.meta.url), 'utf8');
  for (const forbidden of ['StudyService', 'Controller', 'Prisma', 'Repository']) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must not be present`);
  }
});
