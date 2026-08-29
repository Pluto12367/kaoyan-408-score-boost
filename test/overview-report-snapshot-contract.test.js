import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadSnapshot() {
  const source = await readFile(new URL('../apps/api/src/study/overview-report.snapshot.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { fileName: 'overview-report.snapshot.ts', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)((specifier) => { throw new Error(`Unexpected dependency: ${specifier}`); }, module, module.exports);
  return module.exports;
}

const asOf = '2026-08-24T08:00:00.000Z';

function buildInput() {
  return {
    userId: 'u-1',
    asOf,
    goalFacts: {
      targetScore: 120,
      currentScore: 92,
      remainingDays: 40,
      studyStage: '强化',
      weakestSubject: '数据结构',
    },
    practiceFacts: {
      totalCount: 2,
      correctCount: 1,
      accuracyRate: 50,
      averageTimeSpentSec: 600,
      records: [
        { id: 'r-1', questionId: 'q-1', knowledgePointId: 'kp-1', submittedAt: '2026-08-22T08:00:00.000Z', correct: true, timeSpentSec: 500, expectedTimeSec: 480, mistakeReason: null },
        { id: 'r-2', questionId: 'q-2', knowledgePointId: 'kp-2', submittedAt: '2026-08-23T08:00:00.000Z', correct: false, timeSpentSec: 700, expectedTimeSec: 600, mistakeReason: '概念不清' },
      ],
    },
    knowledgePointFacts: [
      { id: 'kp-1', subject: '数据结构', chapter: '栈', title: '栈的应用', importance: 5, frequency: 3, prerequisites: ['kp-0'] },
      { id: 'kp-2', subject: '计算机网络', chapter: 'HTTP', title: 'HTTP 缓存', importance: 4, frequency: 2, prerequisites: [] },
    ],
    masteryFacts: {
      source: 'user_knowledge_mastery',
      nodeCount: 2,
      practicedNodeCount: 2,
      averageMastery: 68,
      weakCount: 1,
      reviewCount: 1,
      masteredCount: 0,
      lastUpdatedAt: '2026-08-23T08:00:00.000Z',
      nodes: [
        { knowledgeNodeId: 'kp-1', masteryRate: 45, attempts: 3, correctCount: 1, wrongCount: 2, status: 'weak', updatedAt: '2026-08-23T08:00:00.000Z' },
        { knowledgeNodeId: 'kp-2', masteryRate: 90, attempts: 5, correctCount: 5, wrongCount: 0, status: 'mastered', updatedAt: '2026-08-22T08:00:00.000Z' },
      ],
    },
  };
}

test('overview snapshot structure is correct', async () => {
  const { buildOverviewReportSnapshot } = await loadSnapshot();
  const snapshot = buildOverviewReportSnapshot(buildInput());
  assert.equal(snapshot.source, 'overview_report_facts');
  assert.equal(snapshot.userId, 'u-1');
  assert.equal(snapshot.asOf, asOf);
  assert.equal(snapshot.goalFacts.targetScore, 120);
  assert.equal(snapshot.practiceFacts.totalCount, 2);
  assert.equal(snapshot.knowledgePointFacts.length, 2);
  assert.equal(snapshot.masteryFacts.nodeCount, 2);
});

test('empty snapshot is valid', async () => {
  const { buildOverviewReportSnapshot } = await loadSnapshot();
  const snapshot = buildOverviewReportSnapshot({ userId: 'u-empty', asOf });
  assert.equal(snapshot.source, 'overview_report_facts');
  assert.equal(snapshot.goalFacts.targetScore, null);
  assert.equal(snapshot.practiceFacts.totalCount, 0);
  assert.equal(snapshot.knowledgePointFacts.length, 0);
  assert.equal(snapshot.masteryFacts.source, 'empty');
});

test('snapshot excludes recommendation and UI fields', async () => {
  const { buildOverviewReportSnapshot } = await loadSnapshot();
  const snapshot = buildOverviewReportSnapshot(buildInput());
  const root = JSON.stringify(snapshot);
  for (const forbidden of ['recommendation', 'nextAction', 'reason', 'titleText', 'description', 'weakPoints', 'speedRisks', 'ui', 'agent']) {
    assert.equal(root.includes(`"${forbidden}"`), false, `${forbidden} must not be present`);
  }
});

test('snapshot keeps only facts and no selector results', async () => {
  const { buildOverviewReportSnapshot } = await loadSnapshot();
  const snapshot = buildOverviewReportSnapshot(buildInput());
  assert.equal(snapshot.practiceFacts.records.length, 2);
  assert.equal(snapshot.masteryFacts.nodes.length, 2);
  assert.equal(snapshot.knowledgePointFacts[0].prerequisites[0], 'kp-0');
});

test('contract documents no service or repository dependencies', async () => {
  const source = await readFile(new URL('../apps/api/src/study/overview-report.snapshot.ts', import.meta.url), 'utf8');
  for (const forbidden of ['StudyService', 'Controller', 'Prisma', 'Repository', 'computeWeaknessReport', 'recommendation']) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must not be present`);
  }
});
