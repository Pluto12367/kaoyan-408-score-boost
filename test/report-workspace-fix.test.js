import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function load(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('today plan only exposes one next-step entry point', async () => {
  const source = await load('apps/web/src/components/TodayPlan.tsx');
  assert.match(source, /<NextLearningStepCard step={nextLearningStep} onNavigate={onNavigate} compact \/>/);
  assert.doesNotMatch(source, /today-plan-next-step-banner/);
});

test('report workspace forwards only real props and no fabricated plan data', async () => {
  const source = await load('apps/web/src/features/report/ReportWorkspace.tsx');
  assert.match(source, /wrongQuestionSummary=\{props\.wrongQuestionSummary\.data\}/);
  assert.match(source, /todayPlan=\{props\.todayPlan\}/);
  assert.doesNotMatch(source, /new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(source, /wrongQuestionSummary=\{props\.report \? undefined : undefined\}/);
});

test('report summary panel keeps responsive insight cards and honest empty-state copy', async () => {
  const source = await load('apps/web/src/features/report/ReportSummaryPanel.tsx');
  assert.match(source, /report-insight-grid/);
  assert.match(source, /report-insight-card/);
  assert.match(source, /const learningInsights = buildLearningInsights/);
  assert.match(source, /完成入学诊断/);
});
