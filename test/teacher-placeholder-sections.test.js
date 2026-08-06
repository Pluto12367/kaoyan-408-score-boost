import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('P3-1: App passes the active section into the teacher workspace', async () => {
  const app = await source('apps/web/src/App.tsx');
  assert.match(
    app,
    /<TeacherWorkspace\s+activeSection=\{visibleSection\}/,
    'teacher workspace should receive the active navigation section',
  );
});

test('P3-1: teacher 学情报告 section shows the real class analytics page', async () => {
  const workspace = await source('apps/web/src/features/teacher/TeacherWorkspace.tsx');
  assert.match(workspace, /activeSection: RoleSection;/, 'workspace should accept the section prop');
  assert.match(
    workspace,
    /if \(activeSection === 'report'\) \{[\s\S]*?<h3>班级学情报告<\/h3>/,
    'report section should render the class analytics page',
  );
  assert.match(workspace, /classAnalyticsPanel/, 'report page should reuse the same analytics source as 题库与班级');
});

test('P3-1: teacher AI 辅助 is an honest under-construction page, not a fake feature', async () => {
  const workspace = await source('apps/web/src/features/teacher/TeacherWorkspace.tsx');
  assert.match(
    workspace,
    /if \(activeSection === 'ai'\) \{[\s\S]*?<h3>AI 辅助（建设中）<\/h3>/,
    'AI section should be clearly marked as under construction',
  );
  assert.match(workspace, /不会展示未经实现的功能/, 'placeholder must not imply working AI features');
  assert.doesNotMatch(
    workspace.slice(workspace.indexOf("if (activeSection === 'ai')"), workspace.indexOf('return (\n    <section id="teacher"')),
    /onAskTutor|AI 助教正在|requestAiFollowUp/,
    'AI placeholder must not wire up fake tutor flows',
  );
});
