// V14-② — memory-card frontend source contract tests (task book
// docs/v14-memory-card-design.md §7.3, following the R4-A source-contract
// pattern). Pins: nav wiring, section dispatch, demo refusal, explicit-error
// API layer, honest view helpers, and the semantic caption that card
// retention is NOT mastery (RULE-08 presentation fence).

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('M3: 记忆卡 is a first-class student section wired end to end', async () => {
  const navigation = await source('apps/web/src/layouts/RoleNavigation.tsx');
  const sections = await source('apps/web/src/features/student/StudentSections.tsx');

  assert.match(navigation, /'memory-card'/);
  assert.match(navigation, /\{ id: 'memory-card', label: '记忆卡', icon: Layers \}/);
  const compat = navigation.match(/const studentCompatSections: RoleSection\[\] = \[([\s\S]*?)\];/)?.[1] ?? '';
  assert.match(compat, /'memory-card'/, 'compat sections must include memory-card');
  assert.match(sections, /import\('\.\.\/memory-card\/MemoryCardWorkspace'\)/);
  assert.match(sections, /visibleSection === 'memory-card'/);
});

test('M3: demo mode refuses explicitly — card content cannot be fabricated', async () => {
  const workspace = await source('apps/web/src/features/memory-card/MemoryCardWorkspace.tsx');

  assert.match(workspace, /isStaticDemoMode/);
  assert.match(workspace, /演示模式无法伪造卡片内容/);
  // No silent catch: failures surface to the student with a retry.
  assert.match(workspace, /role="alert"/);
  assert.match(workspace, /重试/);
  assert.doesNotMatch(workspace, /mockData|fallbackToDemo|演示数据（回退）/);
});

test('M3: API layer throws on failure — no silent demo fallback', async () => {
  const api = await source('apps/web/src/api/endpoints/memoryCard.ts');

  assert.match(api, /throw new Error\(`记忆卡队列加载失败/);
  assert.match(api, /throw new Error\(`记忆卡自评提交失败/);
  assert.doesNotMatch(api, /catch[\s\S]*?return null/);
});

test('M3: view helpers stay honest — null retention is a status, not a number', async () => {
  const view = await source('apps/web/src/features/memory-card/memoryCardView.ts');

  assert.match(view, /if \(retention == null\) return '未复习';/);
  assert.match(view, /value: 'forgot'/);
  assert.match(view, /value: 'fuzzy'/);
  assert.match(view, /value: 'remembered'/);
});

test('M3: the workspace states the semantic fence — cards schedule cards, not mastery', async () => {
  const workspace = await source('apps/web/src/features/memory-card/MemoryCardWorkspace.tsx');

  // Presentation-level RULE-08 fence: the surface must say what the review does.
  assert.match(workspace, /不改变掌握度/);
  // Three controlled ratings only (记住/模糊/没记住 → quality 4/2/0 backend-side).
  assert.match(workspace, /RATING_OPTIONS/);
  assert.match(workspace, /'记住'[\s\S]*?'模糊'[\s\S]*?'没记住'/);
});
