import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadCommonJs(path, dependencies = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const localRequire = (specifier) => {
    const key = Object.keys(dependencies).find((candidate) => specifier.includes(candidate));
    if (key) return dependencies[key];
    throw new Error(`Unexpected dependency: ${specifier}`);
  };
  Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
  return module.exports;
}

const asOf = '2026-08-24T08:00:00.000Z';

function legacyHistory(items) {
  const sorted = [...items].sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
  const latest = sorted[0];
  const previous = sorted[1];
  const bestScore = sorted.length ? Math.max(...sorted.map((item) => item.score)) : 0;
  const improvementText = !latest
    ? '还没有测评记录，先完成一套模拟卷建立基线。'
    : !previous
      ? '已建立第一次测评基线，下一次可重点观察正确率和用时变化。'
      : latest.score > previous.score
        ? `较上次提升 ${latest.score - previous.score} 分，继续巩固本次薄弱点。`
        : latest.score === previous.score
          ? '与上次持平，建议通过限时训练和错题复盘提高稳定性。'
          : `较上次下降 ${previous.score - latest.score} 分，先复盘本次错题再进入新题训练。`;

  return {
    userId: 'u-1',
    items: sorted,
    summary: {
      attemptCount: sorted.length,
      bestScore,
      latestAccuracyRate: latest?.accuracyRate ?? 0,
      improvementText,
    },
  };
}

async function snapshot(items) {
  const snapshotModule = await loadCommonJs('apps/api/src/study/assessment-history.snapshot.ts');
  const { buildAssessmentHistorySnapshot } = snapshotModule;
  return buildAssessmentHistorySnapshot({ userId: 'u-1', asOf, items });
}

async function loadAdapter() {
  return loadCommonJs('apps/api/src/study/assessment-history.adapter.ts', {
    'assessment-history.snapshot': {},
  });
}

function toItems(rows) {
  return rows.map((row, index) => ({
    id: `a-${index + 1}`,
    title: row.title,
    submittedAt: row.submittedAt,
    score: row.score,
    totalScore: row.totalScore,
    accuracyRate: row.accuracyRate,
    elapsedSec: row.elapsedSec,
    unansweredCount: row.unansweredCount,
    weakPointTitle: row.weakPointTitle,
    reviewSuggestion: row.reviewSuggestion,
  }));
}

test('parity: empty data matches legacy output', async () => {
  const { toLegacyAssessmentHistory } = await loadAdapter();
  const items = [];
  const legacy = legacyHistory(items);
  const dto = toLegacyAssessmentHistory(await snapshot(items));
  assert.deepEqual(dto, legacy);
});

test('parity: single item matches legacy output', async () => {
  const { toLegacyAssessmentHistory } = await loadAdapter();
  const rows = toItems([
    { title: '阶段测评 A', submittedAt: '2026-08-22T08:00:00.000Z', score: 82, totalScore: 100, accuracyRate: 82, elapsedSec: 600, unansweredCount: 2, weakPointTitle: '页表', reviewSuggestion: '复盘错题' },
  ]);
  assert.deepEqual(toLegacyAssessmentHistory(await snapshot(rows)), legacyHistory(rows));
});

test('parity: multiple items match legacy output and ordering', async () => {
  const { toLegacyAssessmentHistory } = await loadAdapter();
  const rows = toItems([
    { title: '阶段测评 A', submittedAt: '2026-08-22T08:00:00.000Z', score: 82, totalScore: 100, accuracyRate: 82, elapsedSec: 600, unansweredCount: 2, weakPointTitle: '页表', reviewSuggestion: '复盘错题' },
    { title: '阶段测评 B', submittedAt: '2026-08-23T08:00:00.000Z', score: 86, totalScore: 100, accuracyRate: 86, elapsedSec: 580, unansweredCount: 1, weakPointTitle: '进程调度', reviewSuggestion: '继续训练' },
    { title: '阶段测评 C', submittedAt: '2026-08-21T08:00:00.000Z', score: 78, totalScore: 100, accuracyRate: 78, elapsedSec: 620, unansweredCount: 3, weakPointTitle: '内存管理', reviewSuggestion: '加强训练' },
  ]);
  const dto = toLegacyAssessmentHistory(await snapshot(rows));
  const legacy = legacyHistory(rows);
  assert.equal(dto.items[0].submittedAt, '2026-08-23T08:00:00.000Z');
  assert.deepEqual(dto, legacy);
});

test('parity: bestScore latestAccuracyRate and improvementText all match', async () => {
  const { toLegacyAssessmentHistory } = await loadAdapter();
  const rows = toItems([
    { title: '阶段测评 A', submittedAt: '2026-08-22T08:00:00.000Z', score: 72, totalScore: 100, accuracyRate: 72, elapsedSec: 600, unansweredCount: 2, weakPointTitle: '页表', reviewSuggestion: '复盘错题' },
    { title: '阶段测评 B', submittedAt: '2026-08-23T08:00:00.000Z', score: 86, totalScore: 100, accuracyRate: 86, elapsedSec: 580, unansweredCount: 1, weakPointTitle: '进程调度', reviewSuggestion: '继续训练' },
  ]);
  const dto = toLegacyAssessmentHistory(await snapshot(rows));
  assert.equal(dto.summary.bestScore, 86);
  assert.equal(dto.summary.latestAccuracyRate, 86);
  assert.equal(dto.summary.improvementText, '较上次提升 14 分，继续巩固本次薄弱点。');
});

test('parity: stable generated text and no production mutation assumptions', async () => {
  const { toLegacyAssessmentHistory } = await loadAdapter();
  const rows = toItems([
    { title: '阶段测评 A', submittedAt: '2026-08-22T08:00:00.000Z', score: 82, totalScore: 100, accuracyRate: 82, elapsedSec: 600, unansweredCount: 2, weakPointTitle: '页表', reviewSuggestion: '复盘错题' },
  ]);
  const before = JSON.stringify(rows);
  const dto = toLegacyAssessmentHistory(await snapshot(rows));
  assert.equal(JSON.stringify(rows), before);
  assert.match(dto.summary.improvementText, /已建立第一次测评基线/);
});

test('parity: documented differences are kept explicit', async () => {
  const { toLegacyAssessmentHistory } = await loadAdapter();
  const rows = toItems([
    { title: '阶段测评 A', submittedAt: '2026-08-22T08:00:00.000Z', score: 82, totalScore: 100, accuracyRate: 82, elapsedSec: 600, unansweredCount: 2, weakPointTitle: '页表', reviewSuggestion: '复盘错题' },
  ]);
  const dto = toLegacyAssessmentHistory(await snapshot(rows));
  assert.equal(dto.summary.attemptCount, 1);
  assert.equal(dto.items.length, 1);
  assert.equal(dto.items[0].title, '阶段测评 A');
});