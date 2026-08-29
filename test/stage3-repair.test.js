import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('today plan shows only one next-step entry and keeps the plan primary action focused', async () => {
  const todayPlan = await source('apps/web/src/components/TodayPlan.tsx');
  assert.match(todayPlan, /<NextLearningStepCard step={nextLearningStep} onNavigate={onNavigate} compact \/>/);
  assert.doesNotMatch(todayPlan, /today-plan-next-step-banner/);
  assert.match(todayPlan, /progressSummary/);
  assert.match(todayPlan, /今日任务待生成/);
});

test('responsive styles exist for the new first-day, wrong-review, and report insight surfaces', async () => {
  const styles = await source('apps/web/src/styles.css');
  assert.match(styles, /\.first-day-primary-action/);
  assert.match(styles, /\.wrong-today-task-panel/);
  assert.match(styles, /\.report-insight-grid/);
  assert.match(styles, /\.report-insight-card/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*first-day-primary-action/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*wrong-today-task-panel/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*report-insight-grid/);
});

test('report workspace keeps report inputs real and does not fabricate today plan data', async () => {
  const workspace = await source('apps/web/src/features/report/ReportWorkspace.tsx');
  assert.doesNotMatch(workspace, /todayPlan=\{props\.plan/);
  assert.match(workspace, /wrongQuestionSummary=\{props\.wrongQuestionSummary\.data\}/);
  assert.match(workspace, /ReportSummaryPanel/);
});

test('report summary falls back to honest empty-state copy when inputs are missing', async () => {
  const summary = await source('apps/web/src/features/report/ReportSummaryPanel.tsx');
  assert.match(summary, /完成入学诊断/);
  assert.match(summary, /暂无足够对比数据，坚持一周学习后自动生成/);
  assert.match(summary, /暂无明确薄弱点时，用推荐题组继续积累数据。/);
  assert.match(summary, /暂无今日任务数据，先完成诊断或重新加载计划。/);
  assert.match(summary, /完成入学诊断后，系统会为你生成唯一主行动。/);
});
