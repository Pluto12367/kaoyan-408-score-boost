import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadModule() {
  const source = await readFile(new URL('../packages/shared/src/learningInsight.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

const masteryMap = {
  weakestPoints: [
    { title: '二叉树' },
    { title: '进程同步' },
  ],
};

const wrongSummary = { pendingCount: 4 };
const todayPlan = {
  summary: { completedTasks: 2, totalTasks: 4 },
  priorityTasks: [{ status: 'pending', completed: false, title: '二叉树专项' }],
};
const learningProfile = { summary: { accuracyRate: 70, streakDays: 3 } };

test('learning insight helper exposes the planned output contract', async () => {
  const source = await readFile(new URL('../packages/shared/src/learningInsight.ts', import.meta.url), 'utf8');
  assert.match(source, /export interface LearningInsight/);
  assert.match(source, /title: string/);
  assert.match(source, /evidence: string/);
  assert.match(source, /impact: string/);
  assert.match(source, /action: string/);
  assert.match(source, /export function buildLearningInsights/);
});

test('learning insight helper builds progress, risk, and next-step insights', async () => {
  const { buildLearningInsights } = await loadModule();
  const insights = buildLearningInsights({ masteryMap, wrongSummary, todayPlan, learningProfile });
  assert.equal(insights.length, 3);
  assert.equal(insights[0].type, 'progress');
  assert.equal(insights[1].type, 'risk');
  assert.equal(insights[2].type, 'next-step');
  assert.match(insights[0].title, /进步点/);
  assert.match(insights[1].title, /风险点/);
  assert.match(insights[2].title, /下一步建议/);
  assert.match(insights[0].evidence, /二叉树/);
  assert.match(insights[1].evidence, /4 道错题待处理/);
  assert.match(insights[2].action, /去错题本/);
});

test('learning insight helper falls back safely when data is sparse', async () => {
  const { buildLearningInsights } = await loadModule();
  const insights = buildLearningInsights({ masteryMap: null, wrongSummary: null, todayPlan: null, learningProfile: null });
  assert.equal(insights.length, 3);
  assert.match(insights[0].evidence, /完成入学诊断/);
  assert.match(insights[1].action, /完成入学诊断/);
  assert.match(insights[2].action, /完成入学诊断/);
});

test('report summary panel exposes why-judgment copy and concrete action buttons', async () => {
  const source = await readFile(new URL('../apps/web/src/features/report/ReportSummaryPanel.tsx', import.meta.url), 'utf8');
  assert.match(source, /report-insight-grid/);
  assert.match(source, /为什么这样判断/);
  assert.match(source, /进步点/);
  assert.match(source, /风险点/);
  assert.match(source, /下一步建议/);
  assert.match(source, /去错题本|去练习|回到今日任务|查看报告/);
});
