import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadAdapter() {
  const source = await readFile(new URL('../apps/api/src/study/exam-score-history.adapter.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { fileName: 'exam-score-history.adapter.ts', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)((specifier) => {
    if (specifier.includes('study-date')) return { studyDateKey: (value) => (typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10)) };
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
  return module.exports;
}

const asOf = '2026-08-24T08:00:00.000Z';

function snapshot(exams) {
  return { source: 'exam_score_history_facts', userId: 'u-1', asOf, exams };
}

function exams() {
  return [
    { sessionId: 's-2', lastActiveAt: '2026-08-23T08:00:00.000Z', totalQuestions: 25, correctCount: 20, totalActiveMs: 2100000 },
    { sessionId: 's-1', lastActiveAt: '2026-08-22T08:00:00.000Z', totalQuestions: 20, correctCount: 16, totalActiveMs: 1800000 },
  ];
}

test('snapshot converts to DTO', async () => {
  const { toLegacyExamScoreHistory } = await loadAdapter();
  const dto = toLegacyExamScoreHistory(snapshot(exams()));
  assert.equal(dto.userId, 'u-1');
  assert.equal(dto.totalExams, 2);
  assert.equal(dto.history.length, 2);
});

test('accuracyRate is calculated', async () => {
  const { toLegacyExamScoreHistory } = await loadAdapter();
  const dto = toLegacyExamScoreHistory(snapshot(exams()));
  assert.equal(dto.history[0].accuracyRate, 80);
  assert.equal(dto.history[1].accuracyRate, 80);
});

test('totalTimeMin is calculated', async () => {
  const { toLegacyExamScoreHistory } = await loadAdapter();
  const dto = toLegacyExamScoreHistory(snapshot(exams()));
  assert.equal(dto.history[0].totalTimeMin, 30);
  assert.equal(dto.history[1].totalTimeMin, 35);
});

test('date conversion uses studyDateKey(lastActiveAt)', async () => {
  const { toLegacyExamScoreHistory } = await loadAdapter();
  const dto = toLegacyExamScoreHistory(snapshot(exams()));
  assert.equal(dto.history[0].date, '2026-08-22');
  assert.equal(dto.history[1].date, '2026-08-23');
});

test('history sorts by date ascending', async () => {
  const { toLegacyExamScoreHistory } = await loadAdapter();
  const dto = toLegacyExamScoreHistory(snapshot(exams()));
  assert.equal(dto.history[0].sessionId, 's-1');
  assert.equal(dto.history[1].sessionId, 's-2');
});

test('trend positive is computed', async () => {
  const { toLegacyExamScoreHistory } = await loadAdapter();
  const dto = toLegacyExamScoreHistory(snapshot([
    { sessionId: 's-1', lastActiveAt: '2026-08-22T08:00:00.000Z', totalQuestions: 20, correctCount: 14, totalActiveMs: 1800000 },
    { sessionId: 's-2', lastActiveAt: '2026-08-23T08:00:00.000Z', totalQuestions: 20, correctCount: 18, totalActiveMs: 1800000 },
  ]));
  assert.equal(dto.trend, 20);
  assert.equal(dto.trendLabel, '较上次提升 20 分');
});

test('trend zero is computed', async () => {
  const { toLegacyExamScoreHistory } = await loadAdapter();
  const dto = toLegacyExamScoreHistory(snapshot([
    { sessionId: 's-1', lastActiveAt: '2026-08-22T08:00:00.000Z', totalQuestions: 20, correctCount: 16, totalActiveMs: 1800000 },
    { sessionId: 's-2', lastActiveAt: '2026-08-23T08:00:00.000Z', totalQuestions: 25, correctCount: 20, totalActiveMs: 2100000 },
  ]));
  assert.equal(dto.trend, 0);
  assert.equal(dto.trendLabel, '与上次持平');
});

test('trend negative is computed', async () => {
  const { toLegacyExamScoreHistory } = await loadAdapter();
  const dto = toLegacyExamScoreHistory(snapshot([
    { sessionId: 's-1', lastActiveAt: '2026-08-22T08:00:00.000Z', totalQuestions: 20, correctCount: 18, totalActiveMs: 1800000 },
    { sessionId: 's-2', lastActiveAt: '2026-08-23T08:00:00.000Z', totalQuestions: 20, correctCount: 14, totalActiveMs: 1800000 },
  ]));
  assert.equal(dto.trend, -20);
  assert.equal(dto.trendLabel, '较上次下降 20 分');
});

test('empty snapshot fallback is safe', async () => {
  const { toLegacyExamScoreHistory } = await loadAdapter();
  const dto = toLegacyExamScoreHistory(snapshot([]));
  assert.equal(dto.totalExams, 0);
  assert.equal(dto.latestAccuracyRate, 0);
  assert.equal(dto.trend, 0);
  assert.equal(dto.trendLabel, '与上次持平');
  assert.deepEqual(dto.history, []);
});

test('adapter does not mutate snapshot', async () => {
  const { toLegacyExamScoreHistory } = await loadAdapter();
  const snap = snapshot(exams());
  const before = JSON.stringify(snap);
  toLegacyExamScoreHistory(snap);
  assert.equal(JSON.stringify(snap), before);
});
