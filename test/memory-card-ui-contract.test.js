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

test('M3+: node-scoped entry — drawer button, App wiring, workspace filter banner', async () => {
  const drawer = await source('apps/web/src/features/knowledge-catalog/KnowledgePointDetailDrawer.tsx');
  const catalog = await source('apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx');
  const app = await source('apps/web/src/App.tsx');
  const sections = await source('apps/web/src/features/student/StudentSections.tsx');
  const workspace = await source('apps/web/src/features/memory-card/MemoryCardWorkspace.tsx');
  const api = await source('apps/web/src/api/endpoints/memoryCard.ts');

  assert.match(drawer, /复习本节点记忆卡/);
  assert.match(drawer, /onReviewCards\?: \(\) => void/);
  assert.match(catalog, /onReviewNodeCards\?: \(nodeId: string\) => void/);
  assert.match(app, /handleReviewNodeCards/);
  assert.match(app, /memoryCardNodeId=\{memoryCardNodeId\}/);
  assert.match(sections, /nodeId=\{props\.memoryCardNodeId \?\? null\}/);
  assert.match(workspace, /memory-card-node-filter/);
  assert.match(workspace, /查看全部卡片/);
  assert.match(api, /nodeId/);
});

test('M3+: intra-session retry — 没记住 resurfaces once at the queue tail via the shared helper', async () => {
  const workspace = await source('apps/web/src/features/memory-card/MemoryCardWorkspace.tsx');
  const shared = await source('packages/shared/src/score-center/memory-card.ts');

  assert.match(workspace, /collectIntraSessionRetries/);
  assert.match(workspace, /没记住重现/);
  assert.match(workspace, /含重现/);
  // Shared policy source (tested by memory-card-scheduler.test.js), not inline logic.
  assert.match(shared, /export function collectIntraSessionRetries/);
  assert.match(shared, /evaluation\.rating !== 'forgot'/);
});

test('S2: card→practice loop — lazy candidate entry wired to the EXISTING practice handler', async () => {
  const workspace = await source('apps/web/src/features/memory-card/MemoryCardWorkspace.tsx');
  const api = await source('apps/web/src/api/endpoints/memoryCard.ts');
  const sections = await source('apps/web/src/features/student/StudentSections.tsx');
  const app = await source('apps/web/src/App.tsx');

  // Entry only after flip + only with a real candidate; lazy per-node cache.
  assert.match(workspace, /revealed && practiceCandidate && onPracticeCandidate/);
  assert.match(workspace, /做一道「/);
  assert.match(workspace, /fetchMemoryCardPracticeCandidate/);
  assert.match(workspace, /onPracticeCandidate\?: \(questionId: string, title: string\) => void/);
  // The click goes through the App's EXISTING practice handler (no new flow).
  assert.match(sections, /onPracticeCandidate=\{props\.onPracticeFromMemoryCard\}/);
  assert.match(app, /onPracticeFromMemoryCard=\{handlePracticeQuestionFromCatalog\}/);
  // API layer defines the candidate fetcher against the read-only endpoint.
  assert.match(api, /memory-cards\/practice-candidate/);
});
