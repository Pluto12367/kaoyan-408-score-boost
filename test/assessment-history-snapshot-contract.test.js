import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadSnapshot() {
  const source = await readFile(new URL('../apps/api/src/study/assessment-history.snapshot.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { fileName: 'assessment-history.snapshot.ts', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)((specifier) => { throw new Error(`Unexpected dependency: ${specifier}`); }, module, module.exports);
  return module.exports;
}

const asOf = '2026-08-24T08:00:00.000Z';

function items() {
  return [
    { id: 'a-1', title: '阶段测评 A', submittedAt: '2026-08-22T08:00:00.000Z', score: 82, totalScore: 100, accuracyRate: 82, elapsedSec: 600, unansweredCount: 2, weakPointTitle: '页表', reviewSuggestion: '复盘错题' },
    { id: 'a-2', title: '阶段测评 B', submittedAt: '2026-08-23T08:00:00.000Z', score: 86, totalScore: 100, accuracyRate: 86, elapsedSec: 580, unansweredCount: 1, weakPointTitle: '进程调度', reviewSuggestion: '继续训练' },
  ];
}

test('snapshot captures assessment history facts with ordered items', async () => {
  const { buildAssessmentHistorySnapshot } = await loadSnapshot();
  const snapshot = buildAssessmentHistorySnapshot({ userId: 'u-1', asOf, items: items() });
  assert.equal(snapshot.source, 'assessment_history_facts');
  assert.equal(snapshot.userId, 'u-1');
  assert.equal(snapshot.asOf, asOf);
  assert.equal(snapshot.items.length, 2);
  assert.equal(snapshot.items[0].id, 'a-2');
  assert.equal(snapshot.latestSubmittedAt, '2026-08-23T08:00:00.000Z');
});

test('empty snapshot is safe with explicit empty facts', async () => {
  const { buildAssessmentHistorySnapshot } = await loadSnapshot();
  const snapshot = buildAssessmentHistorySnapshot({ userId: 'u-empty', asOf });
  assert.equal(snapshot.items.length, 0);
  assert.equal(snapshot.summaryFacts.attemptCount, 0);
  assert.equal(snapshot.summaryFacts.bestScore, 0);
  assert.equal(snapshot.summaryFacts.latestAccuracyRate, 0);
  assert.equal(snapshot.latestSubmittedAt, null);
});

test('snapshot excludes DTO and recommendation fields at root', async () => {
  const { buildAssessmentHistorySnapshot } = await loadSnapshot();
  const snapshot = buildAssessmentHistorySnapshot({ userId: 'u-1', asOf, items: items() });
  const root = JSON.stringify(snapshot);
  for (const forbidden of ['recommendation', 'nextAction', 'reason', 'selectedQuestions', 'questionLimit', 'titleText', 'ui', 'description']) {
    assert.equal(root.includes(`"${forbidden}"`), false, `${forbidden} must not be present`);
  }
});

test('summary facts are stable and derived from items', async () => {
  const { buildAssessmentHistorySnapshot } = await loadSnapshot();
  const snapshot = buildAssessmentHistorySnapshot({ userId: 'u-1', asOf, items: items() });
  assert.equal(snapshot.summaryFacts.attemptCount, 2);
  assert.equal(snapshot.summaryFacts.bestScore, 86);
  assert.equal(snapshot.summaryFacts.latestAccuracyRate, 86);
  assert.match(snapshot.summaryFacts.improvementText, /较上次提升/);
});

test('contract documents no database or controller dependencies', async () => {
  const source = await readFile(new URL('../apps/api/src/study/assessment-history.snapshot.ts', import.meta.url), 'utf8');
  for (const forbidden of ['StudyService', 'Controller', 'Prisma', 'Repository']) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must not be present`);
  }
  assert.doesNotMatch(source, /from '\.\/assessment-history\.(projection|adapter|query)\.service'/);
  assert.doesNotMatch(source, /findMany\(|findFirst\(/);
});