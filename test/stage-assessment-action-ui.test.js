import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('stage assessment results turn score feedback into direct student actions', async () => {
  const panel = await source('apps/web/src/features/assessment/StageAssessmentPanel.tsx');
  const app = await source('apps/web/src/App.tsx');

  assert.match(panel, /RoleSection/, 'result actions should navigate to existing student sections');
  assert.match(panel, /onNavigate\?: \(section: RoleSection, command\?: StudentActionCommandDescriptor\) => void/, 'the panel should accept a navigation callback with optional action context');
  assert.match(panel, /assessment-action-panel/, 'the submitted result should render an action panel');
  assert.match(panel, /测评结论/, 'students should see the assessment verdict, not only a raw score');
  assert.match(panel, /下一步行动/, 'students should see what to do after the assessment');
  assert.match(panel, /去错题本复盘/, 'students should be able to review mistakes immediately');
  assert.match(panel, /去专项训练/, 'students should be able to start targeted practice immediately');
  assert.match(panel, /回到今日计划/, 'students should be able to return to today plan');
  assert.match(panel, /查看学习报告/, 'students should be able to inspect report evidence');
  assert.match(panel, /target: 'wrong-book'/, 'mistake review action should route to the wrong-book section');
  assert.match(panel, /target: 'question'/, 'targeted practice action should route to question training');
  assert.match(panel, /target: 'plan'/, 'today plan action should route to the plan section');
  assert.match(panel, /target: 'report'/, 'report action should route to the report section');
  assert.match(app, /onNavigate=\{setActiveSection\}/, 'App should wire the panel actions to section navigation');
});
