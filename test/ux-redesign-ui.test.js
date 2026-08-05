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
  assert.match(launchpad, /student-kpi-strip/);
  assert.match(launchpad, /student-action-grid/);
  assert.match(launchpad, /student-schedule-card/);
  assert.match(launchpad, /student-insight-card/);
  assert.match(launchpad, /student-subject-grid/);
  assert.match(launchpad, /student-focus-grid/);
  assert.match(launchpad, /继续刷题/);
  assert.match(launchpad, /开始专项训练/);
  assert.match(launchpad, /查看错题复盘/);
  assert.match(launchpad, /本周学习节奏/);
  assert.match(launchpad, /薄弱知识点 TOP5/);
  assert.match(launchpad, /掌握度趋势/);

  const styles = await source('apps/web/src/styles.css');
  assert.match(styles, /student-kpi-strip/);
  assert.match(styles, /student-action-grid/);
  assert.match(styles, /student-schedule-card/);
});

test('auth gate uses the redesigned entry shell and role value proposition', async () => {
  const app = await source('apps/web/src/App.tsx');
  const styles = await source('apps/web/src/styles.css');

  assert.match(app, /auth-feature-grid/);
  assert.match(app, /学生 \/ 教师 \/ 管理员/);
  assert.match(styles, /auth-shell-redesign/);
  assert.match(styles, /auth-orb/);
});

test('auth gate overrides the workspace two-column shell on desktop', async () => {
  const styles = await source('apps/web/src/styles.css');
  const authShellRule = styles.match(/\.auth-shell\s*\{[^}]+\}/)?.[0] ?? '';
  const authGateRule = styles.match(/\.auth-gate\s*\{[^}]+\}/)?.[0] ?? '';

  assert.match(authShellRule, /grid-template-columns:\s*1fr;/);
  assert.match(authGateRule, /grid-column:\s*1\s*\/\s*-1;/);
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

test('admin workspace exposes richer operations dashboard sections', async () => {
  const workspace = await source('apps/web/src/features/admin/AdminWorkspace.tsx');
  const styles = await source('apps/web/src/styles.css');

  assert.match(workspace, /admin-ops-hero/);
  assert.match(workspace, /admin-alert-strip/);
  assert.match(workspace, /admin-workflow-grid/);
  assert.match(workspace, /admin-health-card/);
  assert.match(workspace, /运营总览/);
  assert.match(workspace, /今日处理优先级/);
  assert.match(styles, /admin-ops-hero/);
  assert.match(styles, /admin-workflow-grid/);
});
