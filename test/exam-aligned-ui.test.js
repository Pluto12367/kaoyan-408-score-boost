import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// LE-V10 F1 M3/M4 — exam-aligned frontend. Honesty rules under test:
//   - the estimate line exists only with a value and ALWAYS carries 估算
//   - missing mastery renders 尚未练习 (never 0%), missing snapshot never 0 次
//   - plain-mode panels stay untouched (components mount only with data)
// Design rules (DESIGN.md): token-only css, zero hex/rgb.

const DIR = new URL('../apps/web/src/features/practice/exam-aligned/', import.meta.url);
const readSource = (file) => readFile(new URL(file, DIR), 'utf8');

async function loadView() {
  const source = await readSource('examAlignmentView.ts');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(() => {
    throw new Error('examAlignmentView must stay dependency-free');
  }, module, module.exports);
  return module.exports;
}

const item = (overrides = {}) => ({
  questionId: 'q-1',
  primaryNode: { knowledgeNodeId: 'DS-TREE-BST', name: '二叉排序树', subject: '数据结构' },
  stars: 5,
  recent3Frequency: 3,
  recent5Frequency: 6,
  allTimeEvidence: 8,
  frequencyConfidence: 'HIGH',
  trendDirection: 'UP',
  lastSeenYear: 2025,
  mastery: 0.62,
  attempts: 14,
  predictedGainEstimate: 3,
  examHits: [
    { year: 2025, subject: '数据结构', questionNo: 8 },
    { year: 2024, subject: '数据结构', questionNo: 10 },
  ],
  evidence: {
    frequencySource: { table: 'KnowledgeFrequencySnapshot', nodeId: 'DS-TREE-BST' },
    masterySource: { table: 'UserKnowledgeMastery', nodeId: 'DS-TREE-BST' },
    gainFormula: 'round(primaryScore5y × (1 − mastery) × 0.6)',
  },
  ...overrides,
});

test('vm: stars/labels/mastery format with honest fallbacks', async () => {
  const { formatStars, frequencyLabel, masteryText, coveredYearsText } = await loadView();
  assert.equal(formatStars(5), '★★★★★');
  assert.equal(formatStars(0), '');
  assert.equal(frequencyLabel(5), '高频考点');
  assert.equal(frequencyLabel(4), '常考考点');
  assert.equal(frequencyLabel(3), '偶考考点');
  assert.equal(frequencyLabel(0), '暂无真题数据');
  assert.equal(masteryText(0.62), '62%');
  assert.equal(masteryText(null), '尚未练习', 'missing mastery is never rendered as 0%');
  assert.equal(coveredYearsText([]), '暂无真题数据');
  assert.equal(coveredYearsText([2025]), '2025 年');
  assert.equal(coveredYearsText([2025, 2022]), '2025-2022 年');
});

test('vm: the estimate text always carries the 估算 marker; null estimate yields no line', async () => {
  const { gainEstimateText } = await loadView();
  const withValue = gainEstimateText(item());
  assert.match(withValue, /^预计收益：/);
  assert.match(withValue, /估算/);
  assert.match(withValue, /3 分/);
  assert.equal(gainEstimateText(item({ predictedGainEstimate: null })), null);
});

test('vm: per-question reason line and coverage summary build from the projection', async () => {
  const { reasonLineFor, buildCoverageSummary } = await loadView();
  const line = reasonLineFor(item());
  assert.match(line, /★★★★★ 高频考点/);
  assert.match(line, /近 5 年 6 次/);
  assert.equal(reasonLineFor(item({ recent5Frequency: null, stars: 0 })), null, 'no snapshot → no reason line');

  const summary = buildCoverageSummary({
    summary: { coveredNodeCount: 2, coveredYears: [2025, 2023], highFrequencyCount: 2 },
    items: [item(), item({ questionId: 'q-2', primaryNode: { knowledgeNodeId: 'CN-TCP-CONG', name: 'TCP 拥塞控制', subject: '计算机网络' }, stars: 4, recent5Frequency: 4, recent3Frequency: 2, mastery: 0.3 })],
  });
  assert.match(summary.coverageLine, /覆盖 2 个真题知识点/);
  assert.match(summary.highFrequencyLine, /2 个/);
  assert.equal(summary.nodeRows.length, 2);

  assert.equal(buildCoverageSummary(null), null);
  assert.equal(
    buildCoverageSummary({ summary: { coveredNodeCount: 0, coveredYears: [], highFrequencyCount: 0 }, items: [] }),
    null,
    'zero coverage renders nothing instead of an empty box',
  );
});

test('M3 wiring: PracticePanel mounts the toggle, badge, reasons, and coverage honestly', async () => {
  const panel = await readFile(new URL('../apps/web/src/features/practice/PracticePanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /onExamAlignedPractice\?: \(enabled: boolean\) => void/);
  assert.match(panel, /aria-pressed=\{examAlignedOn\}/);
  assert.match(panel, /exam-aligned-badge/);
  assert.match(panel, /真题强化 · 覆盖/);
  assert.match(panel, /reasonLineFor\(/, 'per-question reason lines come from the pure vm');
  assert.match(panel, /ExamCoverageSummary alignment=\{examAlignment\}/, 'coverage mounts only with alignment data');
  assert.match(panel, /RecommendationReasonCard/);
  assert.match(panel, /展开逐题推荐理由/);
  assert.doesNotMatch(panel, /#[0-9a-fA-F]{6}\b/, 'TSX stays hex-free (DESIGN.md §7)');
});

test('M3 data flow: mode reaches the API and App wires the toggle', async () => {
  const endpoint = await readFile(new URL('../apps/web/src/api/endpoints/dashboard.ts', import.meta.url), 'utf8');
  assert.match(endpoint, /params\.set\('mode', mode\)/);
  const hook = await readFile(new URL('../apps/web/src/hooks/useStudentLearningData.ts', import.meta.url), 'utf8');
  assert.match(hook, /\(minutesBudget\?: number, mode\?: string\)/);
  const app = await readFile(new URL('../apps/web/src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /onExamAlignedPractice=\{\(enabled\) => refreshPracticeSet\(undefined, enabled \? 'exam_aligned' : undefined\)\}/);
  const types = await readFile(new URL('../apps/web/src/api/types.ts', import.meta.url), 'utf8');
  assert.match(types, /examAlignment\?: PracticeSetExamAlignment \| null/);
});

test('M4 design: coverage css consumes tokens only', async () => {
  const css = await readSource('exam-aligned.css');
  assert.doesNotMatch(css, /#[0-9a-fA-F]{6}\b/);
  assert.doesNotMatch(css, /rgba?\(/);
  assert.match(css, /var\(--space-/);
  assert.match(css, /var\(--primary/);
});
