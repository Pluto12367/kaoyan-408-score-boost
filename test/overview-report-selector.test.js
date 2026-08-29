import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadSelector() {
  const source = await readFile(new URL('../apps/api/src/study/overview-report.selector.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { fileName: 'overview-report.selector.ts', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  // The require stub throws on any runtime dependency, enforcing selector purity.
  Function('require', 'module', 'exports', output)((specifier) => { throw new Error(`Unexpected dependency: ${specifier}`); }, module, module.exports);
  return module.exports;
}

const asOf = '2026-08-28T08:00:00.000Z';

function practiceRecords(records = []) {
  const correctCount = records.filter((record) => record.correct).length;
  return {
    totalCount: records.length,
    correctCount,
    accuracyRate: records.length ? Math.round((correctCount / records.length) * 1000) / 10 : 0,
    averageTimeSpentSec: 0,
    records,
  };
}

function masteryFacts(overrides = {}) {
  return {
    source: 'user_knowledge_mastery',
    nodeCount: 0,
    practicedNodeCount: 0,
    averageMastery: 0,
    weakCount: 0,
    reviewCount: 0,
    masteredCount: 0,
    lastUpdatedAt: null,
    nodes: [],
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    source: 'overview_report_facts',
    userId: 'u-1',
    asOf,
    goalFacts: { targetScore: 120, currentScore: 90, remainingDays: 60, studyStage: '强化', weakestSubject: '操作系统' },
    practiceFacts: practiceRecords(),
    knowledgePointFacts: [],
    masteryFacts: masteryFacts(),
    ...overrides,
  };
}

function record(id, knowledgePointId, { correct = true, timeSpentSec = 60, expectedTimeSec = 100, mistakeReason = null } = {}) {
  return { id, questionId: `q-${id}`, knowledgePointId, submittedAt: '2026-08-27', correct, timeSpentSec, expectedTimeSec, mistakeReason };
}

test('empty snapshot produces empty selections without throwing', async () => {
  const { OverviewReportSelector } = await loadSelector();
  const result = new OverviewReportSelector().select(snapshot());
  assert.deepEqual(result.weakPointSelection.candidates, []);
  assert.deepEqual(result.speedRiskSelection.candidates, []);
  assert.deepEqual(result.masteryWeakCandidates, []);
  assert.deepEqual(result.mistakePatternSummary.reasons, []);
  assert.equal(result.mistakePatternSummary.totalRecordCount, 0);
  assert.equal(result.mistakePatternSummary.totalWrongCount, 0);
  assert.equal(result.weakPointSelection.source, 'practice_facts');
  assert.equal(result.meta.algorithmVersion, 'overview-selector-v1');
  assert.equal(result.meta.masterySource, 'user_knowledge_mastery');
  assert.equal(result.meta.weakPointLimit, 5);
  assert.equal(result.userId, 'u-1');
  assert.equal(result.asOf, asOf);
});

test('weak points rank by deterministic weaknessScore with stable id tie-break', async () => {
  const { OverviewReportSelector } = await loadSelector();
  // kp-b: 50 + 40 + 24 = 114, kp-a: 100 + 24 + 18 = 142, kp-c: 50 + 40 + 24 = 114 (tie with kp-b)
  const source = snapshot({
    practiceFacts: practiceRecords([
      record('r-a-1', 'kp-a', { correct: false, mistakeReason: '概念不清' }),
      record('r-b-1', 'kp-b', { correct: false, mistakeReason: '计算失误' }),
      record('r-b-2', 'kp-b', { correct: true }),
      record('r-c-1', 'kp-c', { correct: false, mistakeReason: '概念不清' }),
      record('r-c-2', 'kp-c', { correct: true }),
    ]),
    knowledgePointFacts: [
      { id: 'kp-a', subject: 'OS', chapter: '内存', title: 'A', importance: 3, frequency: 3, prerequisites: [] },
      { id: 'kp-b', subject: 'OS', chapter: '调度', title: 'B', importance: 5, frequency: 4, prerequisites: [] },
      { id: 'kp-c', subject: 'OS', chapter: 'IO', title: 'C', importance: 5, frequency: 4, prerequisites: [] },
    ],
  });
  const result = new OverviewReportSelector().select(source);
  const ids = result.weakPointSelection.candidates.map((candidate) => candidate.knowledgePointId);
  assert.deepEqual(ids, ['kp-a', 'kp-b', 'kp-c']);
  assert.deepEqual(result.weakPointSelection.candidates.map((candidate) => candidate.rank), [1, 2, 3]);
  assert.equal(result.weakPointSelection.candidates[0].weaknessScore, 142);
  assert.equal(result.weakPointSelection.candidates[1].weaknessScore, 114);
  assert.deepEqual(result.weakPointSelection.candidates[0].evidenceRecordIds, ['r-a-1']);
  assert.equal(result.weakPointSelection.candidates[0].topReason, '概念不清');
});

test('weak point selection truncates to the configured limit and clamps it', async () => {
  const { OverviewReportSelector } = await loadSelector();
  const records = [];
  const points = [];
  for (let index = 1; index <= 7; index += 1) {
    const id = `kp-${index}`;
    records.push(record(`r-${index}`, id, { correct: false }));
    points.push({ id, subject: 'OS', chapter: 'C', title: id, importance: 3, frequency: 3, prerequisites: [] });
  }
  const source = snapshot({ practiceFacts: practiceRecords(records), knowledgePointFacts: points });
  const selector = new OverviewReportSelector();
  const limited = selector.select(source, { weakPointLimit: 3 });
  assert.equal(limited.weakPointSelection.candidates.length, 3);
  assert.equal(limited.meta.weakPointLimit, 3);
  assert.deepEqual(limited.weakPointSelection.candidates.map((candidate) => candidate.knowledgePointId), ['kp-1', 'kp-2', 'kp-3']);
  // All tied at 66; tie-break keeps deterministic id ordering.
  const clampedLow = selector.select(source, { weakPointLimit: 0 });
  assert.equal(clampedLow.meta.weakPointLimit, 1);
  assert.equal(clampedLow.weakPointSelection.candidates.length, 1);
  const clampedHigh = selector.select(source, { weakPointLimit: 99 });
  assert.equal(clampedHigh.meta.weakPointLimit, 10);
  assert.equal(clampedHigh.weakPointSelection.candidates.length, 7);
});

test('speed risks only cover never-wrong points with slow answer evidence', async () => {
  const { OverviewReportSelector } = await loadSelector();
  const source = snapshot({
    practiceFacts: practiceRecords([
      // kp-slow-a: two slow-but-correct answers (timeSpentSec > expectedTimeSec * 1.45)
      record('r-sa-1', 'kp-slow-a', { correct: true, timeSpentSec: 146, expectedTimeSec: 100 }),
      record('r-sa-2', 'kp-slow-a', { correct: true, timeSpentSec: 150, expectedTimeSec: 100 }),
      // kp-slow-b: one slow correct answer
      record('r-sb-1', 'kp-slow-b', { correct: true, timeSpentSec: 200, expectedTimeSec: 100 }),
      // kp-mixed: slow answers exist but the point was answered wrong -> excluded
      record('r-m-1', 'kp-mixed', { correct: false, timeSpentSec: 200, expectedTimeSec: 100, mistakeReason: '审题失误' }),
      record('r-m-2', 'kp-mixed', { correct: true, timeSpentSec: 160, expectedTimeSec: 100 }),
      // kp-fast: never slow -> excluded
      record('r-f-1', 'kp-fast', { correct: true, timeSpentSec: 50, expectedTimeSec: 100 }),
      // kp-borderline: exactly at the threshold is NOT slow (strictly greater)
      record('r-bl-1', 'kp-borderline', { correct: true, timeSpentSec: 145, expectedTimeSec: 100 }),
    ]),
  });
  const result = new OverviewReportSelector().select(source);
  assert.deepEqual(result.speedRiskSelection.candidates.map((candidate) => candidate.knowledgePointId), ['kp-slow-a', 'kp-slow-b']);
  assert.deepEqual(result.speedRiskSelection.candidates.map((candidate) => candidate.slowCount), [2, 1]);
  assert.deepEqual(result.speedRiskSelection.candidates.map((candidate) => candidate.rank), [1, 2]);
  assert.deepEqual(result.speedRiskSelection.candidates[0].evidenceRecordIds, ['r-sa-1', 'r-sa-2']);
});

test('mistake pattern summary counts all records and sorts by count desc then reason asc', async () => {
  const { OverviewReportSelector } = await loadSelector();
  const source = snapshot({
    practiceFacts: practiceRecords([
      record('r-1', 'kp-a', { correct: false, mistakeReason: '计算失误' }),
      record('r-2', 'kp-b', { correct: false, mistakeReason: '概念不清' }),
      record('r-3', 'kp-a', { correct: false, mistakeReason: '概念不清' }),
      record('r-4', 'kp-b', { correct: false, mistakeReason: '概念不清' }),
      record('r-5', 'kp-c', { correct: false, mistakeReason: '审题失误' }),
      record('r-6', 'kp-c', { correct: true }),
      // Correct answers with a reason still count toward the pattern (mirrors legacy countReasons).
      record('r-7', 'kp-c', { correct: true, mistakeReason: '审题失误' }),
    ]),
  });
  const summary = new OverviewReportSelector().select(source).mistakePatternSummary;
  assert.equal(summary.totalRecordCount, 7);
  assert.equal(summary.totalWrongCount, 5);
  assert.deepEqual(summary.reasons.map((entry) => entry.reason), ['概念不清', '审题失误', '计算失误']);
  assert.deepEqual(summary.reasons.map((entry) => entry.count), [3, 2, 1]);
  assert.equal(summary.reasons[0].share, 42.9);
});

test('practice weak points and mastery weak nodes stay in separate id spaces', async () => {
  const { OverviewReportSelector } = await loadSelector();
  const source = snapshot({
    practiceFacts: practiceRecords([record('r-1', 'kp-legacy', { correct: false })]),
    masteryFacts: masteryFacts({
      weakCount: 2,
      nodes: [
        { knowledgeNodeId: 'node-x', masteryRate: 30, attempts: 4, correctCount: 2, wrongCount: 2, status: 'weak', updatedAt: null },
        { knowledgeNodeId: 'node-y', masteryRate: 60, attempts: 2, correctCount: 1, wrongCount: 1, status: 'weak', updatedAt: null },
        { knowledgeNodeId: 'node-z', masteryRate: 90, attempts: 5, correctCount: 5, wrongCount: 0, status: 'mastered', updatedAt: null },
      ],
    }),
  });
  const result = new OverviewReportSelector().select(source);
  assert.equal(result.weakPointSelection.idType, 'knowledgePointId');
  assert.deepEqual(result.weakPointSelection.candidates.map((candidate) => candidate.knowledgePointId), ['kp-legacy']);
  assert.ok(result.weakPointSelection.candidates.every((candidate) => candidate.idType === 'knowledgePointId'));
  assert.deepEqual(result.masteryWeakCandidates.map((candidate) => candidate.knowledgeNodeId), ['node-x', 'node-y']);
  assert.ok(result.masteryWeakCandidates.every((candidate) => candidate.idType === 'knowledgeNodeId'));
  assert.deepEqual(result.masteryWeakCandidates.map((candidate) => candidate.weaknessScore), [70, 40]);
  assert.deepEqual(result.masteryWeakCandidates.map((candidate) => candidate.rank), [1, 2]);
  // No id space may leak into the other selection.
  const flat = JSON.stringify(result);
  assert.ok(!flat.includes('"knowledgePointId":"node-'));
  assert.ok(!flat.includes('"knowledgeNodeId":"kp-'));
});

test('selection output contains no recommendation or UI fields', async () => {
  const { OverviewReportSelector } = await loadSelector();
  const source = snapshot({
    practiceFacts: practiceRecords([
      record('r-1', 'kp-a', { correct: false, mistakeReason: '概念不清', timeSpentSec: 200, expectedTimeSec: 100 }),
    ]),
    masteryFacts: masteryFacts({
      weakCount: 1,
      nodes: [{ knowledgeNodeId: 'node-x', masteryRate: 20, attempts: 1, correctCount: 0, wrongCount: 1, status: 'weak', updatedAt: null }],
    }),
  });
  const flat = JSON.stringify(new OverviewReportSelector().select(source));
  for (const forbidden of ['suggestion', 'nextAction', 'recommendation', 'summary', 'actionText', 'actionAnchor']) {
    assert.ok(!flat.includes(forbidden), `output must not contain "${forbidden}"`);
  }
});

test('meta.masterySource passes through every snapshot source variant', async () => {
  const { OverviewReportSelector } = await loadSelector();
  const selector = new OverviewReportSelector();
  for (const source of ['user_knowledge_mastery', 'empty', 'node_mastery']) {
    const result = selector.select(snapshot({ masteryFacts: masteryFacts({ source }) }));
    assert.equal(result.meta.masterySource, source);
  }
});
