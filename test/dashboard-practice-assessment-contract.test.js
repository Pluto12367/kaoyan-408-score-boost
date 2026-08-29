import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadSnapshot() {
  const source = await readFile(new URL('../apps/api/src/study/dashboard.snapshot.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    fileName: 'dashboard.snapshot.ts',
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)((specifier) => { throw new Error(`Unexpected dependency: ${specifier}`); }, module, module.exports);
  return module.exports;
}

const asOf = '2026-08-24T08:00:00.000Z';

const practiceFacts = {
  source: 'practice_record',
  totalCount: 2,
  latestSubmittedAt: asOf,
  records: [{
    id: 'record-1', userId: 'user-1', questionId: 'question-1', knowledgePointId: 'node-1',
    correct: false, timeSpentSec: 90, mistakeReason: '概念不清', submittedAt: asOf, variantQuestionId: null,
  }],
};

const assessmentFacts = {
  source: 'assessment',
  attemptCount: 2,
  bestScore: 86,
  latestScore: 82,
  latestAccuracyRate: 0.8,
  latestSubmittedAt: asOf,
};

test('practiceFacts preserve PracticeRecord fact boundaries', async () => {
  const { buildDashboardSnapshot } = await loadSnapshot();
  const snapshot = buildDashboardSnapshot({ userId: 'user-1', asOf, practiceFacts, assessmentFacts });
  assert.equal(snapshot.practiceFacts.source, 'practice_record');
  assert.equal(snapshot.practiceFacts.totalCount, 2);
  assert.equal(snapshot.practiceFacts.records[0].id, 'record-1');
  assert.equal(snapshot.practiceFacts.records[0].questionId, 'question-1');
  assert.equal(snapshot.practiceFacts.records[0].correct, false);
  assert.equal(snapshot.practiceFacts.records[0].timeSpentSec, 90);
  assert.equal(snapshot.practiceFacts.records[0].mistakeReason, '概念不清');
  assert.equal(snapshot.practiceFacts.records[0].submittedAt, asOf);
});

test('assessmentFacts preserve assessment history fact boundaries', async () => {
  const { buildDashboardSnapshot } = await loadSnapshot();
  const snapshot = buildDashboardSnapshot({ userId: 'user-1', asOf, practiceFacts, assessmentFacts });
  assert.equal(snapshot.assessmentFacts.source, 'assessment');
  assert.equal(snapshot.assessmentFacts.attemptCount, 2);
  assert.equal(snapshot.assessmentFacts.bestScore, 86);
  assert.equal(snapshot.assessmentFacts.latestScore, 82);
  assert.equal(snapshot.assessmentFacts.latestAccuracyRate, 0.8);
  assert.equal(snapshot.assessmentFacts.latestSubmittedAt, asOf);
});

test('empty practice and assessment facts are explicit and do not invent recommendations', async () => {
  const { buildDashboardSnapshot } = await loadSnapshot();
  const snapshot = buildDashboardSnapshot({ userId: 'user-empty', asOf });
  assert.equal(snapshot.practiceFacts.source, 'empty');
  assert.deepEqual(snapshot.practiceFacts.records, []);
  assert.equal(snapshot.assessmentFacts.source, 'empty');
  assert.equal(snapshot.assessmentFacts.bestScore, null);
  assert.equal(snapshot.assessmentFacts.latestScore, null);
  assert.equal(snapshot.assessmentFacts.latestAccuracyRate, null);
});

test('practice and assessment facts exclude presentation strategy and UI copy', async () => {
  const { buildDashboardSnapshot } = await loadSnapshot();
  const snapshot = buildDashboardSnapshot({ userId: 'user-1', asOf, practiceFacts, assessmentFacts });
  for (const forbidden of ['recommendation', 'nextAction', 'priority', 'priorityCard', 'checkpointMessage', 'actionText', 'actionAnchor']) {
    assert.equal(JSON.stringify(snapshot.practiceFacts).includes(`"${forbidden}"`), false, `${forbidden} must not be in practiceFacts`);
    assert.equal(JSON.stringify(snapshot.assessmentFacts).includes(`"${forbidden}"`), false, `${forbidden} must not be in assessmentFacts`);
  }
});

test('contract documents PracticeRecord, LearningSession, and assessment source boundaries', async () => {
  const source = await readFile(new URL('../apps/api/src/study/dashboard.snapshot.ts', import.meta.url), 'utf8');
  assert.match(source, /PracticeRecord/);
  assert.match(source, /LearningSession/);
  assert.match(source, /assessment persistence\/projection facts/);
  assert.doesNotMatch(source, /StudyService|Controller|Repository|PrismaService/);
});
