import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('wrong-book header uses the same pending-review metric as the stats grid', async () => {
  const source = await readFile(new URL('../apps/web/src/features/mistakes/MistakeWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(
    source,
    /summaryData\?\.pendingCount \?\? wrongQuestions\.length/,
    'header should prefer the authoritative pending count over the full list length',
  );
  assert.doesNotMatch(
    source,
    /<span>\{wrongQuestions\.length\} 道待复盘<\/span>/,
    'header must not label the full current wrong-question list as pending review',
  );
});

test('homepage KPI and report panels derive pending review from the same summary field', async () => {
  const launchpad = await readFile(new URL('../apps/web/src/features/onboarding/StudentLaunchpad.tsx', import.meta.url), 'utf8');
  assert.match(
    launchpad,
    /value: wrongQuestionSummary \? `\$\{wrongQuestionSummary\.pendingCount\} 题`/,
    'homepage KPI should use summary.pendingCount',
  );

  const report = await readFile(new URL('../apps/web/src/features/report/ReportSummaryPanel.tsx', import.meta.url), 'utf8');
  assert.match(
    report,
    /stageReport\?\.wrong\.pendingCount/,
    'report conclusion should use the stage report pending count',
  );

  const stage = await readFile(new URL('../apps/web/src/features/report/StageReportPanel.tsx', import.meta.url), 'utf8');
  assert.match(
    stage,
    /report\.wrong\.pendingCount/,
    'stage report should use the same pending field',
  );
});
