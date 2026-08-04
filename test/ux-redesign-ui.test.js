import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('role navigation is state-driven instead of anchor-scroll driven', async () => {
  const navigation = await source('apps/web/src/layouts/RoleNavigation.tsx');

  assert.match(navigation, /activeSection/);
  assert.match(navigation, /onNavigate/);
  assert.doesNotMatch(navigation, /href="#/);
  assert.match(navigation, /aria-current/);
  assert.match(navigation, /题库文档导入/);
  assert.match(navigation, /学习总览/);
});

test('App switches role workspaces by active section instead of rendering every section in one long page', async () => {
  const app = await source('apps/web/src/App.tsx');

  assert.match(app, /useRoleSectionNavigation/);
  assert.match(app, /activeSection/);
  assert.match(app, /visibleSection/);
  assert.match(app, /resetSectionForRole/);
  assert.doesNotMatch(app, /scrollIntoView\(\{ behavior: 'smooth'/);
});

test('redesigned student workspace exposes preview-aligned learning dashboard sections', async () => {
  const launchpad = await source('apps/web/src/features/onboarding/StudentLaunchpad.tsx');

  assert.match(launchpad, /student-dashboard-hero/);
  assert.match(launchpad, /student-subject-grid/);
  assert.match(launchpad, /student-focus-grid/);
  assert.match(launchpad, /继续刷题/);
  assert.match(launchpad, /薄弱知识点 TOP5/);
  assert.match(launchpad, /掌握度趋势/);
});

test('auth gate uses the redesigned entry shell and role value proposition', async () => {
  const app = await source('apps/web/src/App.tsx');
  const styles = await source('apps/web/src/styles.css');

  assert.match(app, /auth-feature-grid/);
  assert.match(app, /学生 \/ 教师 \/ 管理员/);
  assert.match(styles, /auth-shell-redesign/);
  assert.match(styles, /auth-orb/);
});

test('question import workspace shows a clear import stepper and feedback summary', async () => {
  const workspace = await source('apps/web/src/features/admin/question-import/QuestionImportWorkspace.tsx');
  const styles = await source('apps/web/src/styles.css');

  assert.match(workspace, /question-import-stepper/);
  assert.match(workspace, /上传文件/);
  assert.match(workspace, /审核候选题/);
  assert.match(workspace, /确认入库/);
  assert.match(workspace, /完成/);
  assert.match(workspace, /导入流程/);
  assert.match(styles, /question-import-stepper/);
});
