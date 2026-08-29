import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadSnapshot() {
  const source = await readFile(new URL('../apps/api/src/study/exam-score-history.snapshot.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { fileName: 'exam-score-history.snapshot.ts', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)((specifier) => { throw new Error(`Unexpected dependency: ${specifier}`); }, module, module.exports);
  return module.exports;
}

const asOf = '2026-08-24T08:00:00.000Z';

function exams() {
  return [
    { sessionId: 's-1', lastActiveAt: '2026-08-22T08:00:00.000Z', totalQuestions: 20, correctCount: 16, totalActiveMs: 1800000 },
    { sessionId: 's-2', lastActiveAt: '2026-08-23T08:00:00.000Z', totalQuestions: 25, correctCount: 20, totalActiveMs: 2100000 },
  ];
}

test('snapshot structure is correct', async () => {
  const { buildExamScoreHistorySnapshot } = await loadSnapshot();
  const snapshot = buildExamScoreHistorySnapshot({ userId: 'u-1', asOf, exams: exams() });
  assert.equal(snapshot.source, 'exam_score_history_facts');
  assert.equal(snapshot.userId, 'u-1');
  assert.equal(snapshot.asOf, asOf);
  assert.equal(snapshot.exams.length, 2);
});

test('source is correct', async () => {
  const { buildExamScoreHistorySnapshot } = await loadSnapshot();
  const snapshot = buildExamScoreHistorySnapshot({ userId: 'u-1', asOf, exams: exams() });
  assert.equal(snapshot.source, 'exam_score_history_facts');
});

test('asOf exists and is ISO string', async () => {
  const { buildExamScoreHistorySnapshot } = await loadSnapshot();
  const snapshot = buildExamScoreHistorySnapshot({ userId: 'u-1', asOf, exams: exams() });
  assert.equal(snapshot.asOf, asOf);
  assert.match(snapshot.asOf, /^\d{4}-\d{2}-\d{2}T/);
});

test('exam facts fields are complete', async () => {
  const { buildExamScoreHistorySnapshot } = await loadSnapshot();
  const snapshot = buildExamScoreHistorySnapshot({ userId: 'u-1', asOf, exams: exams() });
  assert.deepEqual(Object.keys(snapshot.exams[0]).sort(), ['correctCount', 'lastActiveAt', 'sessionId', 'totalActiveMs', 'totalQuestions'].sort());
});

test('snapshot excludes DTO fields', async () => {
  const { buildExamScoreHistorySnapshot } = await loadSnapshot();
  const snapshot = buildExamScoreHistorySnapshot({ userId: 'u-1', asOf, exams: exams() });
  const root = JSON.stringify(snapshot);
  for (const forbidden of ['accuracyRate', 'trend', 'trendLabel', 'latestAccuracyRate', 'recommendation', 'nextAction', 'reason', 'ui', 'description']) {
    assert.equal(root.includes(`"${forbidden}"`), false, `${forbidden} must not be present`);
  }
});

test('empty snapshot is valid', async () => {
  const { buildExamScoreHistorySnapshot } = await loadSnapshot();
  const snapshot = buildExamScoreHistorySnapshot({ userId: 'u-empty', asOf });
  assert.equal(snapshot.userId, 'u-empty');
  assert.equal(snapshot.exams.length, 0);
});
