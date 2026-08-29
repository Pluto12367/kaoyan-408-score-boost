import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadModule() {
  const source = await readFile(new URL('../apps/api/src/study/assessment-projection.service.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { fileName: 'assessment-projection.service.ts', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)((specifier) => {
    if (specifier.includes('@nestjs/common')) return { Injectable: () => (target) => target, Optional: () => (target, _key, _index) => undefined };
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
  return module.exports;
}

const asOf = new Date('2026-08-24T08:00:00.000Z');

test('empty data returns empty assessment facts', async () => {
  const { AssessmentProjectionService } = await loadModule();
  const previous = process.env.DATABASE_URL; delete process.env.DATABASE_URL;
  try { assert.deepEqual(await new AssessmentProjectionService({}).getFacts('u-1', asOf), { source: 'empty', attemptCount: 0, bestScore: null, latestScore: null, lastAssessmentAt: null, latestAccuracyRate: null, latestSubmittedAt: null, history: [] }); }
  finally { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; }
});

test('aggregates bestScore, latestScore, lastAssessmentAt, and history with fixed asOf', async () => {
  const { AssessmentProjectionService } = await loadModule();
  const pr = new AssessmentProjectionService({
    assessmentHistoryItem: { findMany: async (query) => {
      assert.equal(query.where.userId, 'u-1'); assert.equal(query.where.submittedAt.lte, asOf);
      return [{ id: 'a-1', score: 82, submittedAt: new Date('2026-08-20T00:00:00.000Z'), accuracyRate: 0.8 }, { id: 'a-2', score: 86, submittedAt: new Date('2026-08-22T00:00:00.000Z'), accuracyRate: 0.82 }];
    }},
  });
  const previous = process.env.DATABASE_URL; process.env.DATABASE_URL = 'postgres://test';
  try {
    const facts = await pr.getFacts('u-1', asOf);
    assert.equal(facts.source, 'assessment'); assert.equal(facts.attemptCount, 2); assert.equal(facts.bestScore, 86); assert.equal(facts.latestScore, 86); assert.equal(facts.lastAssessmentAt, '2026-08-22T00:00:00.000Z'); assert.deepEqual(facts.history, [{ id: 'a-1', score: 82, submittedAt: '2026-08-20T00:00:00.000Z' }, { id: 'a-2', score: 86, submittedAt: '2026-08-22T00:00:00.000Z' }]);
  } finally { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; }
});

test('projection boundary excludes forbidden dependencies and presentation logic', async () => {
  const source = await readFile(new URL('../apps/api/src/study/assessment-projection.service.ts', import.meta.url), 'utf8');
  for (const forbidden of ['StudyService', 'Controller', 'Adapter', 'recommendation', 'nextAction', 'create(', 'update(', 'delete(']) assert.equal(source.includes(forbidden), false, `${forbidden} must not be present`);
});
