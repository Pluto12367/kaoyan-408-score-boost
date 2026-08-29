import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadQuery() {
  const source = await readFile(new URL('../apps/api/src/study/exam-score-history.query.service.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { fileName: 'exam-score-history.query.service.ts', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)((specifier) => {
    if (specifier.includes('exam-score-history.adapter')) return { toLegacyExamScoreHistory: () => ({ userId: 'u-1', totalExams: 0, latestAccuracyRate: 0, trend: 0, trendLabel: '与上次持平', history: [] }) };
    if (specifier.includes('exam-score-history.projection.service')) return { ExamScoreHistoryProjectionService: class {} };
    if (specifier.includes('@nestjs/common')) return { Injectable: () => (target) => target, Optional: () => (target, _key, _index) => undefined };
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
  return module.exports;
}

const asOf = new Date('2026-08-24T08:00:00.000Z');
const snapshot = { source: 'exam_score_history_facts', userId: 'u-1', asOf: asOf.toISOString(), exams: [] };

test('query calls projection then adapter', async () => {
  const calls = { projection: [], adapter: [] };
  const { ExamScoreHistoryQueryService } = await loadQuery();
  const service = new ExamScoreHistoryQueryService({
    getSnapshot: async (...args) => {
      calls.projection.push(args);
      return structuredClone(snapshot);
    },
  }, {
    toLegacyExamScoreHistory: (...args) => {
      calls.adapter.push(args);
      return { userId: 'u-1', totalExams: 0, latestAccuracyRate: 0, trend: 0, trendLabel: '与上次持平', history: [] };
    },
  });
  const dto = await service.getExamScoreHistoryCompat('u-1', asOf);
  assert.equal(calls.projection.length, 1);
  assert.equal(calls.adapter.length, 1);
  assert.deepEqual(dto, { userId: 'u-1', totalExams: 0, latestAccuracyRate: 0, trend: 0, trendLabel: '与上次持平', history: [] });
});

test('query passes userId and asOf through unchanged', async () => {
  const { ExamScoreHistoryQueryService } = await loadQuery();
  const service = new ExamScoreHistoryQueryService({ getSnapshot: async (...args) => {
    assert.equal(args[0], 'u-1');
    assert.equal(args[1], asOf);
    return structuredClone(snapshot);
  } }, { toLegacyExamScoreHistory: () => ({ userId: 'u-1', totalExams: 0, latestAccuracyRate: 0, trend: 0, trendLabel: '与上次持平', history: [] }) });
  const dto = await service.getExamScoreHistoryCompat('u-1', asOf);
  assert.equal(dto.userId, 'u-1');
});

test('query does not mutate snapshot', async () => {
  const { ExamScoreHistoryQueryService } = await loadQuery();
  const snap = structuredClone(snapshot);
  const before = JSON.stringify(snap);
  const service = new ExamScoreHistoryQueryService({ getSnapshot: async () => snap }, { toLegacyExamScoreHistory: (value) => ({ userId: value.userId, totalExams: 0, latestAccuracyRate: 0, trend: 0, trendLabel: '与上次持平', history: [] }) });
  await service.getExamScoreHistoryCompat('u-1', asOf);
  assert.equal(JSON.stringify(snap), before);
});

test('query has no Prisma, Repository, StudyService, Controller or DTO calculations', async () => {
  const source = await readFile(new URL('../apps/api/src/study/exam-score-history.query.service.ts', import.meta.url), 'utf8');
  for (const forbidden of ['Prisma', 'Repository', 'StudyService', 'Controller', 'accuracyRate', 'trendLabel']) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must not be present`);
  }
});
