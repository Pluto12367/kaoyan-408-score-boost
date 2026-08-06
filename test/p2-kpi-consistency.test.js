import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('P2-06: 预计提分空间 uses one label, format and caption across homepage and report', async () => {
  const launchpad = await source('apps/web/src/features/onboarding/StudentLaunchpad.tsx');
  assert.match(launchpad, /label: '预计提分空间'/, 'homepage KPI should use the unified label');
  assert.match(
    launchpad,
    /value: report && \(report\.completionRate > 0 \|\| report\.weakPoints\.length > 0\)\s*\? `\$\{report\.estimatedGain\} 分`/,
    'homepage KPI should use the same X 分 format as the report metrics grid',
  );
  assert.match(launchpad, /基于薄弱点和目标分估算（与报告口径一致）/, 'homepage helper should state the definition');

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

test('P2-06: sprint plan minutes are labelled as plan duration, distinct from today remaining time', async () => {
  const overview = await source('apps/web/src/features/dashboard/StudentProgressOverview.tsx');
  assert.match(
    overview,
    /计划 \{day\.minutes\} 分钟/,
    'sprint day should say 计划 X 分钟 instead of a bare X 分钟',
  );

  const launchpad = await source('apps/web/src/features/onboarding/StudentLaunchpad.tsx');
  assert.match(
    launchpad,
    /剩余约 \$\{todayPlanRemainingMinutes\} 分钟/,
    'today remaining time stays labelled as 剩余约',
  );
});
