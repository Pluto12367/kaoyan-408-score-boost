import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('stage 6: student bottom navigation keeps five unique tabs', async () => {
  const navigation = await source('apps/web/src/layouts/RoleNavigation.tsx');

  const bottomItems = navigation.match(/const studentBottomItems: NavigationItem\[\] = \[([\s\S]*?)\];/)?.[1] ?? '';
  const ids = [...bottomItems.matchAll(/\{ id: '([^']+)'/g)].map((match) => match[1]);
  const labels = [...bottomItems.matchAll(/label: '([^']+)'/g)].map((match) => match[1]);

  assert.equal(ids.length, 5, `expected 5 bottom tabs, got ${ids.length}`);
  assert.equal(new Set(ids).size, 5, 'bottom tab ids must be unique');
  assert.deepEqual(labels, ['首页', '答疑', '练习', '错题', '报告']);
  // dashboard tab stays active when the merged plan section is open
  assert.match(navigation, /item\.id === 'dashboard'[\s\S]*?activeSection === 'plan'/);
  assert.match(navigation, /className="bottom-nav"/);
  assert.match(navigation, /export function StudentBottomNav/);
});

test('stage 6: bottom nav is rendered outside the hidden sidebar', async () => {
  const app = await source('apps/web/src/App.tsx');

  assert.match(app, /StudentBottomNav/);
  const aside = app.match(/<aside[\s\S]*?<\/aside>/)?.[0] ?? '';
  assert.doesNotMatch(aside, /bottom-nav/);
  assert.match(app, /<\/aside>\s*\n\s*<StudentBottomNav/);
});

test('stage 6: refresh restores the last section via sessionStorage', async () => {
  const app = await source('apps/web/src/App.tsx');

  assert.match(app, /SECTION_STORAGE_KEY/);
  assert.match(app, /readStoredSection/);
  assert.match(app, /sessionStorage\.setItem\(SECTION_STORAGE_KEY, activeSection\)/);
  assert.match(app, /useState<RoleSection>\(\(\) => readStoredSection\(resolvedRole\)\)/);
  // student sidebar is hidden on mobile so the bottom nav takes over
  assert.match(app, /sidebar sidebar-student/);
});

test('stage 6: AI tutor surfaces timeout or failure with a retry action', async () => {
  const app = await source('apps/web/src/App.tsx');
  const tutor = await source('apps/web/src/features/tutor/TutorPanel.tsx');

  assert.match(app, /function withTimeout/);
  assert.match(app, /tutorFailed/);
  assert.match(app, /failed=\{tutorFailed\}/);
  assert.match(app, /onRetry=\{handleAskTutor\}/);
  assert.match(tutor, /failed\?: boolean/);
  assert.match(tutor, /module-error/);
  assert.match(tutor, /重试/);
});

test('stage 6: mobile styles hide the student sidebar and show the bottom nav', async () => {
  const styles = await source('apps/web/src/styles.css');

  assert.match(styles, /\.bottom-nav \{/);
  assert.match(styles, /\.bottom-nav[\s\S]*?display: none/);
  assert.match(styles, /@media \(max-width: 720px\)/);
  assert.match(styles, /\.sidebar-student \{\s*display: none/);
  assert.match(styles, /\.bottom-nav \{[\s\S]*?position: fixed/);
  // option tap target is at least 44px on mobile
  assert.match(styles, /\.options button \{\s*background: #eef2ff;\s*color: #1e3a8a;\s*min-height: 44px;/);
});
