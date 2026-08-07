import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('P2-01: TodayPlan renders only in the plan section; the homepage keeps progress + one main action', async () => {
  const app = await source('apps/web/src/App.tsx');
  const usages = [...app.matchAll(/<TodayPlan\b/g)];
  assert.equal(usages.length, 1, 'TodayPlan should render exactly once');
  assert.match(
    app,
    /visibleSection === 'plan' \? ?\(?\s*(?:studentOverviewReady \? )?<>[\s\S]*?<TodayPlan\b/,
    'TodayPlan should live under the plan section',
  );
  const usageRegion = app.slice(usages[0].index, usages[0].index + 320);
  assert.match(usageRegion, /focusTaskId=\{planFocusTaskId\}/, 'TodayPlan receives the focused task');

  const launchpad = await source('apps/web/src/features/onboarding/StudentLaunchpad.tsx');
  assert.doesNotMatch(launchpad, /<TodayPlan\b/, 'homepage must not render the full task-card list');
  assert.doesNotMatch(launchpad, /完成并调整计划/, 'homepage must not include the manual completion form');
});

test('P2-03: the session workspace is a full-screen overlay, so mobile never shows two question areas', async () => {
  const app = await source('apps/web/src/App.tsx');
  assert.match(
    app,
    /{learningSessionType \? \(\s*<div className="exam-workspace-overlay">/,
    'ExamSession should only render inside the overlay',
  );

  const styles = await source('apps/web/src/styles.css');
  assert.match(styles, /\.exam-workspace-overlay \{\s*position: fixed;\s*inset: 0;/, 'overlay should cover the viewport');
  assert.match(
    styles,
    /@media \(max-width: 720px\) \{[\s\S]*?\.exam-workspace-overlay \{\s*padding: 0;/,
    'mobile overlay should take the full screen',
  );
});

test('P2-05: wrong-book empty state is consistent with the resolved-history stat card', async () => {
  const mistakes = await source('apps/web/src/features/mistakes/MistakeWorkspace.tsx');
  assert.match(
    mistakes,
    /summaryData\?\.resolvedCount \?\? 0\) > 0[\s\S]*?历史已通过重做解决/,
    'empty state should mention resolved history when 重做解决 > 0',
  );
  assert.match(mistakes, /没有符合当前筛选条件的错题/, 'filter-empty state stays distinct from never-had-wrong-questions');
});
