import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = (path) => fs.readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('today route is an ordered presentational workflow with one task primary action', async () => {
  const ui = await source('apps/web/src/features/onboarding/TodayLearningRouteView.tsx');
  assert.match(ui, /<ol[^>]*className="today-route-list"/);
  assert.match(ui, /resolveTodayRoute\(/);
  assert.match(ui, /getTodayTaskActionLabel\(/);
  assert.match(ui, /className="primary-action today-route-primary"/);
  assert.equal((ui.match(/today-route-primary/g) ?? []).length, 1);
  assert.match(ui, /role="status"/);
  assert.doesNotMatch(ui, /startTask|fetchTodayPlan|setActiveSection/);
});

test('the current route task owns the dashboard visual primary action', async () => {
  const ui = await source('apps/web/src/features/onboarding/TodayLearningRouteView.tsx');
  const launchpad = await source('apps/web/src/features/onboarding/StudentLaunchpad.tsx');
  const resumeBanner = await source('apps/web/src/components/ResumeSessionBanner.tsx');
  assert.equal((ui.match(/primary-action/g) ?? []).length, 1);
  assert.match(ui, /className="primary-action today-route-primary"/);
  assert.match(launchpad, /className="secondary-action"[^>]*>[\s\S]{0,120}生成并开始考试/);
  assert.doesNotMatch(launchpad, /className="primary-action"[^>]*>[\s\S]{0,120}生成并开始考试/);
  assert.match(launchpad, /<ResumeSessionBanner[\s\S]{0,180}actionClassName="secondary-action"/);
  assert.match(resumeBanner, /actionClassName = 'primary-action'/);
  assert.match(resumeBanner, /className=\{actionClassName\}/);
});

test('today route renders loading, fetch error, complete, and postponed-only states', async () => {
  const ui = await source('apps/web/src/features/onboarding/TodayLearningRouteView.tsx');
  for (const token of [
    'today-route-skeleton', '重新加载', '今日任务已完成', '下一项任务可开始时间',
  ]) assert.match(ui, new RegExp(token));
  assert.match(ui, /getTodayRouteRefreshDelay/);
  assert.match(ui, /setTimeout/);
  assert.match(ui, /today-route-unavailable/);
});

test('App preflights content before starting and navigating a today task', async () => {
  const app = await source('apps/web/src/App.tsx');
  assert.match(app, /preflightTodayTaskLaunch\(task, questions, wrongQuestions\)/);
  assert.match(app, /if \(preflight\.kind === 'error'\)/);
  assert.match(app, /if \(preflight\.kind === 'navigate-plan'\)/);
  assert.match(app, /await startTodayTaskIfCurrent\(task\.id, startTask, isCurrentLaunch\)/);
  assert.match(app, /setTodayTaskLaunchContext\(preflight\.context\)/);
  assert.match(app, /setActiveSection\(preflight\.context\.destination\)/);
});

test('App clears task launch state when the owning student changes or logs out', async () => {
  const app = await source('apps/web/src/App.tsx');
  assert.match(app, /shouldClearTodayTaskLaunch\(/);
  assert.match(app, /todayTaskLaunchOwnerRef/);
  assert.match(app, /todayTaskLaunchGenerationRef/);
  assert.match(app, /startTodayTaskIfCurrent\(/);
  assert.match(app, /setTodayTaskLaunchContext\(null\)/);
  assert.match(app, /setTodayTaskLaunchingId\(null\)/);
  assert.match(app, /setTodayTaskLaunchError\(''\)/);
  assert.match(app, /invalidatePracticeAttempt\(practiceSubmissionGateRef\.current\)/);
});

test('task-scoped question navigation never advances through the full question bank', async () => {
  const app = await source('apps/web/src/App.tsx');
  assert.match(app, /const activePracticeQuestions = todayTaskLaunchContext\?\.destination === 'question'/);
  assert.match(app, /questions\.filter/);
  assert.match(app, /practiceIndex >= activePracticeQuestions\.length - 1/);
  assert.match(app, /activePracticeQuestions\[Math\.min\(/);
});

test('student sections receives launch status and delegates route launches to the App', async () => {
  const studentSections = await source('apps/web/src/features/student/StudentSections.tsx');
  assert.match(studentSections, /todayTaskLaunchingId: string \| null/);
  assert.match(studentSections, /todayTaskLaunchError: string/);
  assert.match(studentSections, /todayTaskLaunchContext: TodayTaskLaunchContext \| null/);
  assert.match(studentSections, /onLaunchTodayTask: \(task: TodayPlanTask\) => void/);
  assert.match(studentSections, /onRetryTodayPlan: \(\) => void/);
});

test('student sections seeds only wrong-book launches into the mistake filter', async () => {
  const studentSections = await source('apps/web/src/features/student/StudentSections.tsx');
  assert.match(studentSections, /initialKnowledgePointId=\{props\.todayTaskLaunchContext\?\.destination === 'wrong-book'/);
});
