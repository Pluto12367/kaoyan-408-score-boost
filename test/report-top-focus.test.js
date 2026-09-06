import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// V8 backlog #9 — single next-step arbitration shared by home & report.
// Home already arbitrates via selectCanonicalNextAction (session → today →
// review → redo → assessment). The report must present the SAME first step;
// weakness becomes the "after that" line, never a competing headline.

async function loadModule() {
  const source = await readFile(
    new URL('../apps/web/src/features/student/actions/reportTopFocus.ts', import.meta.url),
    'utf8',
  );
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(() => {
    throw new Error('reportTopFocus must stay dependency-free');
  }, module, module.exports);
  return module.exports;
}

const planTask = (overrides = {}) => ({
  id: 'task-1',
  title: 'Cache 映射与替换',
  subject: '计算机组成原理',
  chapter: '存储系统',
  minutes: 45,
  completed: false,
  status: 'pending',
  ...overrides,
});

test('an open today task outranks weakness, with weakness as the after-line', async () => {
  const { resolveReportTopFocus } = await loadModule();
  const focus = resolveReportTopFocus({
    todayPlan: { priorityTasks: [planTask()] },
    canonicalNodeWeakness: { title: '先序遍历', masteryRate: 41.6462 },
    topMasteryWeakPoint: null,
  });
  assert.match(focus.headline, /先完成今日任务「Cache 映射与替换」/);
  assert.match(focus.basis, /today-plan/);
  assert.match(focus.afterLine, /先序遍历/, 'weakness stays visible as the next step after today');
  assert.doesNotMatch(focus.headline, /先序遍历/, 'weakness must not headline while a today task is open');
});

test('without an open today task, weakness headlines with its caliber label', async () => {
  const { resolveReportTopFocus } = await loadModule();
  const focus = resolveReportTopFocus({
    todayPlan: { priorityTasks: [planTask({ completed: true, status: 'done' })] },
    canonicalNodeWeakness: { title: '先序遍历', masteryRate: 41.6462 },
    topMasteryWeakPoint: null,
  });
  assert.match(focus.headline, /优先补强「先序遍历」/);
  assert.match(focus.basis, /node-weakness/);
  assert.equal(focus.afterLine, null);
});

test('all tasks done and no weakness yields a maintenance headline', async () => {
  const { resolveReportTopFocus } = await loadModule();
  const focus = resolveReportTopFocus({
    todayPlan: { priorityTasks: [] },
    canonicalNodeWeakness: null,
    topMasteryWeakPoint: null,
  });
  assert.match(focus.headline, /保持节奏|推荐练习/);
  assert.equal(focus.basis.length > 0, true);
});

test('legacy (non-canonical) data falls back to the mastery map weak point', async () => {
  const { resolveReportTopFocus } = await loadModule();
  const focus = resolveReportTopFocus({
    todayPlan: null,
    canonicalNodeWeakness: null,
    topMasteryWeakPoint: { title: '线性表定义', masteryRate: 74 },
  });
  assert.match(focus.headline, /线性表定义/);
  assert.match(focus.basis, /mastery-map/);
});

test('ReportSummaryPanel actually wires the arbitration (no independent headline)', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync('apps/web/src/features/report/ReportSummaryPanel.tsx', 'utf8');
  assert.match(source, /import \{ resolveReportTopFocus \} from '\.\.\/\.\.\/features\/student\/actions\/reportTopFocus'|import \{ resolveReportTopFocus \} from '\.\.\/student\/actions\/reportTopFocus'/);
  assert.match(source, /const topFocus = resolveReportTopFocus\(\{/);
  assert.match(source, /canonicalOverview\s*\?\s*\(topFocus\.afterLine \? `\$\{topFocus\.headline\}；\$\{topFocus\.afterLine\}。` : topFocus\.headline\)/);
});
