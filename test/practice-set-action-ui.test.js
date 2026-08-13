import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('PracticePanel turns completed practice sets into concrete next actions', async () => {
  const panel = await source('apps/web/src/features/practice/PracticePanel.tsx');
  const sections = await source('apps/web/src/features/student/StudentSections.tsx');

  assert.match(panel, /RoleSection/, 'practice set actions should navigate to existing student sections');
  assert.match(panel, /onNavigate\?: \(section: RoleSection\) => void;/, 'PracticePanel should accept a navigation callback');
  assert.match(panel, /practice-set-action-panel/, 'completed set results should render an action panel');
  assert.match(panel, /训练结论/, 'students should see a completed-set verdict');
  assert.match(panel, /本组薄弱点/, 'students should see which weak point to work on next');
  assert.match(panel, /下一步行动/, 'students should see what to do after a set');
  assert.match(panel, /再练一组/, 'students should be able to keep practicing the same set');
  assert.match(panel, /错题复盘/, 'students should be able to review mistakes');
  assert.match(panel, /回到今日计划/, 'students should be able to return to today plan');
  assert.match(panel, /查看报告/, 'students should be able to inspect report evidence');
  assert.match(panel, /onNavigate\?\.\('wrong-book'\)/, 'wrong-book action should route to mistake review');
  assert.match(panel, /onNavigate\?\.\('plan'\)/, 'plan action should route to today plan');
  assert.match(panel, /onNavigate\?\.\('report'\)/, 'report action should route to the report page');
  assert.match(sections, /onNavigate=\{props\.onNavigate\}/, 'StudentSections should wire navigation into PracticePanel');
});
