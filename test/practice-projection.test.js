import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadModule() {
  const source = await readFile(new URL('../apps/api/src/study/practice-projection.service.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { fileName: 'practice-projection.service.ts', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)((specifier) => {
    if (specifier.includes('@nestjs/common')) return { Injectable: () => (target) => target, Optional: () => (target, _key, _index) => undefined };
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
  return module.exports;
}

const asOf = new Date('2026-08-24T08:00:00.000Z');
const record = (id, submittedAt, correct) => ({ id, userId: 'u-1', questionId: `q-${id}`, knowledgePointId: 'kp-1', correct, timeSpentSec: 60, mistakeReason: null, submittedAt: new Date(submittedAt), variantQuestionId: null });

test('empty database returns empty practice facts', async () => {
  const { PracticeProjectionService } = await loadModule();
  const previous = process.env.DATABASE_URL; delete process.env.DATABASE_URL;
  try { assert.deepEqual(await new PracticeProjectionService({}).getFacts('u-1', asOf), { source: 'empty', totalCount: 0, todayCount: 0, correctCount: 0, accuracy: 0, lastPracticeAt: null, studyDuration: 0, latestSubmittedAt: null, records: [] }); }
  finally { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; }
});

test('aggregates records, accuracy, today count, and sessions using fixed asOf', async () => {
  const { PracticeProjectionService } = await loadModule();
  const records = [record('old', '2026-08-23T23:00:00.000Z', false), record('today-1', '2026-08-24T01:00:00.000Z', true), record('today-2', '2026-08-24T07:00:00.000Z', true)];
  const calls = [];
  const service = new PracticeProjectionService({
    practiceRecord: { findMany: async (query) => { calls.push(query); return records; } },
    learningSession: { findMany: async (query) => { calls.push(query); return [{ totalActiveMs: 120000 }, { totalActiveMs: 30000 }]; } },
  });
  const previous = process.env.DATABASE_URL; process.env.DATABASE_URL = 'postgres://test';
  try {
    const facts = await service.getFacts('u-1', asOf);
    assert.equal(facts.totalCount, 3); assert.equal(facts.todayCount, 2); assert.equal(facts.correctCount, 2); assert.equal(facts.accuracy, 2 / 3); assert.equal(facts.lastPracticeAt, '2026-08-24T07:00:00.000Z'); assert.equal(facts.studyDuration, 150000); assert.equal(calls[0].where.submittedAt.lte, asOf); assert.equal(calls[1].where.startedAt.lte, asOf);
  } finally { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; }
});

test('projection has no service, controller, adapter, recommendation, or write dependencies', async () => {
  const source = await readFile(new URL('../apps/api/src/study/practice-projection.service.ts', import.meta.url), 'utf8');
  for (const forbidden of ['StudyService', 'Controller', 'Adapter', 'recommendation', 'nextAction', 'create(', 'update(', 'delete(']) assert.equal(source.includes(forbidden), false, `${forbidden} must not be present`);
});
