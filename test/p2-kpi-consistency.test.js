import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('P2-06: 预计提分空间 remains in the report instead of competing with the homepage route', async () => {
  const launchpad = await source('apps/web/src/features/onboarding/StudentLaunchpad.tsx');
  assert.doesNotMatch(launchpad, /预计提分空间/, 'homepage should lead with the actionable route');

  const overview = await source('apps/web/src/features/dashboard/StudentProgressOverview.tsx');
  assert.match(
    overview,
    /<Metric title="预计提分空间" value=\{`\$\{report\.estimatedGain\} 分`\} caption="基于薄弱点和目标分估算"/,
    'report metrics grid keeps the same label and source',
  );
});

test('P2-06: 预测分数 is the single name for the predicted score estimate', async () => {
  const report = await source('apps/web/src/features/report/ReportSummaryPanel.tsx');
  assert.match(report, /<h4>预测分数<\/h4>/, 'conclusion card should use the same 预测分数 name as the metrics grid');
  assert.doesNotMatch(report, /<h4>本周预计提升<\/h4>/, 'the ambiguous 本周预计提升 name must be gone');
});

test('P2-06: sprint plan minutes remain distinct from the route time summary', async () => {
  const overview = await source('apps/web/src/features/dashboard/StudentProgressOverview.tsx');
  assert.match(
    overview,
    /计划 \{day\.minutes\} 分钟/,
    'sprint day should say 计划 X 分钟 instead of a bare X 分钟',
  );

  const route = await source('apps/web/src/features/onboarding/TodayLearningRouteView.tsx');
  assert.match(route, /预计 \{totalMinutes\} 分钟 · 已完成 \{completedMinutes\} 分钟/);
});
