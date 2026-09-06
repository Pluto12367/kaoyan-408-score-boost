import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('report summary prefers the mastery weakest point for the top task and next-step card', () => {
  const source = readFileSync('apps/web/src/features/report/ReportSummaryPanel.tsx', 'utf8');
  // canonical 路径优先 Node 薄弱；legacy 路径取掌握度地图最弱点（提取为 topMasteryWeakPoint）
  assert.match(source, /const topMasteryWeakPoint = stageReport\?\.mastery\.weakestPoints\[0\] \?\? null;/);
  assert.match(source, /const canonicalNodeWeakness = canonicalOverview\?\.weaknesses\.nodeWeaknesses\[0\] \?\? null;/);
  assert.match(source, /buildReportNextLearningStep\(\s*report,\s*topMasteryWeakPoint\?\.title\s*\?\?\s*null,?\s*\)/);
  assert.match(source, /基于练习记录/);
  assert.match(source, /基于掌握度地图/);
});
