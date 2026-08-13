import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('student recommendations explain evidence, confidence, and learning impact in decision areas', async () => {
  const component = await readFile('apps/web/src/features/student/RecommendationEvidence.tsx', 'utf8');
  const consoleSource = await readFile('apps/web/src/features/student/StudentLearningConsole.tsx', 'utf8');
  const reportSource = await readFile('apps/web/src/features/report/ReportSummaryPanel.tsx', 'utf8');
  const practiceSource = await readFile('apps/web/src/features/practice/PracticePanel.tsx', 'utf8');
  const mistakeSource = await readFile('apps/web/src/features/mistakes/MistakeWorkspace.tsx', 'utf8');

  assert.match(component, /aria-label=\{TEXT\.ariaLabel\}/);
  assert.match(component, /TEXT\.reason/);
  assert.match(component, /TEXT\.evidence/);
  assert.match(component, /TEXT\.confidence/);
  assert.match(component, /TEXT\.impact/);
  assert.match(component, /confidenceLevelLabel/);

  assert.match(consoleSource, /<RecommendationEvidence[\s\S]*?confidence=/);
  assert.match(reportSource, /<RecommendationEvidence[\s\S]*?confidence=/);
  assert.match(practiceSource, /<RecommendationEvidence[\s\S]*?confidence=/);
  assert.match(mistakeSource, /<RecommendationEvidence[\s\S]*?confidence=/);
});
