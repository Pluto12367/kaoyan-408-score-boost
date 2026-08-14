import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('report summary prefers the mastery weakest point for the top task and next-step card', () => {
  const source = readFileSync('apps/web/src/features/report/ReportSummaryPanel.tsx', 'utf8');
  assert.match(source, /stageReport\?\.mastery\.weakestPoints\[0\]/);
  assert.match(source, /buildReportNextLearningStep\(\s*report,\s*stageReport\?\.mastery\.weakestPoints\[0\]\?\.title\s*\?\?\s*null/);
  assert.match(source, /基于练习记录/);
  assert.match(source, /基于掌握度地图/);
});
