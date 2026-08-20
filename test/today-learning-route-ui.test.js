import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = (path) => fs.readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('today route is an ordered presentational workflow with one task primary action', async () => {
  const ui = await source('apps/web/src/features/onboarding/TodayLearningRouteView.tsx');
  assert.match(ui, /<ol[^>]*className="today-route-list"/);
  assert.match(ui, /resolveTodayRoute\(/);
  assert.match(ui, /getTodayTaskActionLabel\(/);
  assert.match(ui, /today-route-first-step/);
  assert.match(ui, /今日第一步/);
  assert.match(ui, /完成后系统会更新掌握度、错题和下一步建议/);
  assert.match(ui, /className="primary-action today-route-primary"/);
  assert.match(ui, /role="status"/);
  assert.match(ui, /today-route-first-action/);
  assert.match(ui, /任务名：/);
  assert.match(ui, /预计收益：完成后更新掌握度、错题和下一步建议/);
  assert.doesNotMatch(ui, /startTask|fetchTodayPlan|setActiveSection/);
});

test('the current route task owns the dashboard visual primary action', async () => {
  const ui = await source('apps/web/src/features/onboarding/TodayLearningRouteView.tsx');
  const launchpad = await source('apps/web/src/features/onboarding/StudentLaunchpad.tsx');
  const resumeBanner = await source('apps/web/src/components/ResumeSessionBanner.tsx');
  assert.match(ui, /className="primary-action today-route-primary"/);
  assert.match(launchpad, /className="secondary-action"/);
  assert.match(launchpad, /<ClipboardCheck/);
  assert.doesNotMatch(launchpad, /className="primary-action"[^>]*>\s*<ClipboardCheck/);
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
  assert.match(ui, /today-route-first-action-meta/);
});

test('App preflights content before starting and navigating a today task', async () => {
  const app = await source('apps/web/src/App.tsx');
  assert.match(app, /resolveLaunchableTodayTask\(/);
  assert.match(app, /launch\.kind === 'error'/);
  assert.match(app, /launch\.kind === 'navigate-plan'/);
  assert.match(app, /await startTodayTaskIfCurrent\(launch\.task\.id, startTask, isCurrentLaunch\)/);
  assert.match(app, /setTodayTaskLaunchContext\(launch\.preflight\.context\)/);
  assert.match(app, /setActiveSection\(launch\.preflight\.context\.destination\)/);
  assert.match(app, /已跳过暂无内容的任务/);
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
  assert.match(app, /const activePracticeQuestionIds = activePracticeQuestions\.map\(\(question\) => question\.id\);/);
  assert.match(app, /hasNextQuestionByCurrentId\(\s*activePracticeQuestionIds,\s*currentQuestion\.id,\s*practiceIndex,\s*\)/);
  assert.match(app, /advanceQuestionByCurrentId\(readPracticeAttemptState\(\), activePracticeQuestionIds, currentQuestion\.id\)/);
  assert.doesNotMatch(app, /practiceIndex >= activePracticeQuestions\.length - 1/);
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
