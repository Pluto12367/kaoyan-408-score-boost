import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

test('report overview tab receives canonical overview without changing report legacy tabs', () => {
  const workspace = read('apps/web/src/features/report/ReportWorkspace.tsx');
  const testSection = read('apps/web/src/features/test/TestSection.tsx');
  const sections = read('apps/web/src/features/student/StudentSections.tsx');
  const progress = read('apps/web/src/features/dashboard/StudentProgressOverview.tsx');
  assert.match(workspace, /canonicalOverview/);
  assert.match(workspace, /<ReportSummaryPanel[\s\S]*canonicalOverview=\{props\.canonicalOverview\}/);
  assert.match(testSection, /canonicalOverview/);
  assert.match(sections, /canonicalOverview=\{props\.canonicalOverview\}/);
  assert.match(progress, /canonicalOverview/);
  assert.match(workspace, /<AssessmentHistoryPanel/);
  assert.match(workspace, /<ReviewResourcesPanel/);
});

test('report summary reads canonical mastery, node weakness, progress and review facts', () => {
  const summary = read('apps/web/src/features/report/ReportSummaryPanel.tsx');
  const progress = read('apps/web/src/features/dashboard/StudentProgressOverview.tsx');
  assert.match(summary, /canonicalOverview\.mastery\.averageMastery/);
  assert.match(summary, /canonicalOverview\.weaknesses\.nodeWeaknesses/);
  assert.match(summary, /canonicalOverview\.progress\.last7d/);
  assert.match(summary, /canonicalOverview\.reviewStatus\.pendingWrongQuestionCount/);
  assert.match(progress, /canonicalOverview\.mastery\.nodes/);
  assert.match(progress, /canonicalOverview\.progress\.last7d/);
  assert.doesNotMatch(summary, /canonicalOverview\.weaknesses\.nodeWeaknesses[\s\S]{0,500}knowledgePointId/);
});

test('report summary keeps legacy report available only as an explicit compatibility branch', () => {
  const summary = read('apps/web/src/features/report/ReportSummaryPanel.tsx');
  assert.match(summary, /canonicalOverview\s*\?/);
  assert.match(summary, /: report\.weakPoints/);
});
