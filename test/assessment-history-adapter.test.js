import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadAdapter() {
  const source = await readFile(new URL('../apps/api/src/study/assessment-history.adapter.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { fileName: 'assessment-history.adapter.ts', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)((specifier) => { throw new Error(`Unexpected dependency: ${specifier}`); }, module, module.exports);
  return module.exports;
}

const asOf = '2026-08-24T08:00:00.000Z';

function snapshot(overrides = {}) {
  return {
    source: 'assessment_history_facts',
    userId: 'u-1',
    asOf,
    items: [
      { id: 'a-2', title: '阶段测评 B', submittedAt: '2026-08-23T08:00:00.000Z', score: 86, totalScore: 100, accuracyRate: 86, elapsedSec: 580, unansweredCount: 1, weakPointTitle: '进程调度', reviewSuggestion: '继续训练' },
      { id: 'a-1', title: '阶段测评 A', submittedAt: '2026-08-22T08:00:00.000Z', score: 82, totalScore: 100, accuracyRate: 82, elapsedSec: 600, unansweredCount: 2, weakPointTitle: '页表', reviewSuggestion: '复盘错题' },
    ],
    summaryFacts: { attemptCount: 2, bestScore: 86, latestAccuracyRate: 86, improvementText: '' },
    latestSubmittedAt: '2026-08-23T08:00:00.000Z',
    ...overrides,
  };
}

test('adapter maps snapshot to legacy DTO with userId and items', async () => {
  const { toLegacyAssessmentHistory } = await loadAdapter();
  const dto = toLegacyAssessmentHistory(snapshot());
  assert.equal(dto.userId, 'u-1');
  assert.equal(dto.items.length, 2);
  assert.equal(dto.items[0].id, 'a-2');
  assert.equal(dto.items[1].id, 'a-1');
});

test('adapter outputs summary fields from snapshot', async () => {
  const { toLegacyAssessmentHistory } = await loadAdapter();
  const dto = toLegacyAssessmentHistory(snapshot());
  assert.equal(dto.summary.attemptCount, 2);
  assert.equal(dto.summary.bestScore, 86);
  assert.equal(dto.summary.latestAccuracyRate, 86);
});

test('adapter generates improvementText from items', async () => {
  const { toLegacyAssessmentHistory } = await loadAdapter();
  const dto = toLegacyAssessmentHistory(snapshot());
  assert.equal(typeof dto.summary.improvementText, 'string');
  assert.match(dto.summary.improvementText, /较上次提升/);
});

test('empty snapshot produces legacy-safe DTO with fallbacks', async () => {
  const { toLegacyAssessmentHistory } = await loadAdapter();
  const empty = snapshot({ items: [], summaryFacts: { attemptCount: 0, bestScore: 0, latestAccuracyRate: 0, improvementText: '' }, latestSubmittedAt: null });
  const dto = toLegacyAssessmentHistory(empty);
  assert.equal(dto.userId, 'u-1');
  assert.deepEqual(dto.items, []);
  assert.equal(dto.summary.attemptCount, 0);
  assert.equal(dto.summary.bestScore, 0);
  assert.equal(dto.summary.latestAccuracyRate, 0);
  assert.equal(dto.summary.improvementText, '还没有测评记录，先完成一套模拟卷建立基线。');
});

test('single item snapshot produces correct improvementText', async () => {
  const { toLegacyAssessmentHistory } = await loadAdapter();
  const single = snapshot({ items: [{ id: 'a-1', title: '阶段测评 A', submittedAt: '2026-08-22T08:00:00.000Z', score: 82, totalScore: 100, accuracyRate: 82, elapsedSec: 600, unansweredCount: 2, weakPointTitle: '页表', reviewSuggestion: '复盘错题' }], summaryFacts: { attemptCount: 1, bestScore: 82, latestAccuracyRate: 82, improvementText: '' }, latestSubmittedAt: '2026-08-22T08:00:00.000Z' });
  const dto = toLegacyAssessmentHistory(single);
  assert.match(dto.summary.improvementText, /已建立第一次测评基线/);
});

test('adapter does not mutate snapshot', async () => {
  const { toLegacyAssessmentHistory } = await loadAdapter();
  const snap = snapshot();
  const before = JSON.stringify(snap);
  toLegacyAssessmentHistory(snap);
  assert.equal(JSON.stringify(snap), before);
});

test('adapter has no database, service, or controller dependencies', async () => {
  const source = await readFile(new URL('../apps/api/src/study/assessment-history.adapter.ts', import.meta.url), 'utf8');
  for (const forbidden of ['StudyService', 'Controller', 'Prisma', 'Repository', 'findMany', 'findFirst']) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must not be present`);
  }
});
