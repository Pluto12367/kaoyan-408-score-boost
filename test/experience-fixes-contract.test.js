// V14 体验批次 A（Owner 批准 D-F-1..5，2026-09-28）— D1/D2 源码契约。
// 任务书 docs/v14-experience-fixes-design.md「落地级详细设计」D1/D2。

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('D1: 目录刷新端点存在且 admin-only，无 DB 显式 503', async () => {
  const controller = await source('apps/api/src/questions/questions.controller.ts');
  assert.match(controller, /directory-refresh/);
  // admin-only：同一装饰器段内 Roles('admin')（student/teacher 不得命中）。
  const refreshBlock = controller.match(/@Post\('questions\/directory-refresh'\)[\s\S]{0,200}/)?.[0] ?? '';
  assert.match(refreshBlock, /@Roles\('admin'\)/);
  assert.doesNotMatch(refreshBlock, /'student'/);
  const service = await source('apps/api/src/questions/questions.service.ts');
  assert.match(service, /refreshDirectory\(/, 'service must expose refreshDirectory()');
  assert.match(service, /ServiceUnavailableException/, 'no-DB must 503 explicitly');
});

test('D1: 导入器收尾接线——仅成功导入后调用刷新，失败仅警告', async () => {
  for (const importer of ['scripts/import-real-exams.mjs', 'scripts/import-questions.mjs']) {
    const src = await source(importer);
    assert.match(src, /tryRefreshDirectory/, `${importer} must wire tryRefreshDirectory`);
    assert.match(src, /created \+ updated > 0|created\+updated>0/, 'only after real writes');
    // 警告不阻断：失败路径不含 process.exit / throw。
    const fn = src.match(/async function tryRefreshDirectory[\s\S]*?\n\}/)?.[0] ?? '';
    assert.ok(fn.length > 0, `${importer} tryRefreshDirectory body missing`);
    assert.doesNotMatch(fn, /process\.exit|throw new Error/, 'refresh failure must warn, not abort');
  }
  // 记忆卡导入器不接（与题目目录无关——D1 审计修正）。
  const cards = await source('scripts/import-memory-cards.mjs');
  assert.doesNotMatch(cards, /tryRefreshDirectory/);
});

test('D2: TutorPanel 无当前题时按钮与 chips 禁用 + 显式提示', async () => {
  const panel = await source('apps/web/src/features/tutor/TutorPanel.tsx');
  // 锁定开关：questionLocked 由 hasActiveQuestion 派生。
  assert.match(panel, /questionLocked = hasActiveQuestion !== true/);
  // 主按钮：无题时 disabled。
  assert.match(panel, /disabled=\{questionLocked\}/);
  // 提示文案存在。
  assert.match(panel, /先去做一道题/);
  // chips 受同一开关（可见但禁用）。
  const chips = panel.match(/tutor-quick-mode[\s\S]{0,160}/)?.[0] ?? '';
  assert.match(chips, /disabled/, 'quick chips must respect the same switch');
});

test('D2: 接线——App 经 StudentSections 传递当前题，TutorPanel 侧派生 hasActiveQuestion', async () => {
  const app = await source('apps/web/src/App.tsx');
  // App 把 currentQuestion 交给 StudentSections（hasActiveQuestion 由其派生）。
  assert.match(app, /currentQuestion=\{currentQuestion\}/);
  const sections = await source('apps/web/src/features/student/StudentSections.tsx');
  assert.match(sections, /hasActiveQuestion=\{Boolean\(props\.currentQuestion\?\.id\)\}/);
});

test('批次 B D4: 微反馈仅练习模式、1.2s 自清除、paper 不显示', async () => {
  const exam = await source('apps/web/src/components/ExamSession.tsx');
  assert.match(exam, /showRecordedToast/);
  assert.match(exam, /if \(!isPaperMode\) \{\s*setShowRecordedToast\(true\);/);
  assert.match(exam, /已记录 · 交卷后查看解析/);
  assert.match(exam, /role="status"/);
});

test('批次 B D6: 约定卡默认折叠（details/summary + 开始使用后收起）', async () => {
  const card = await source('apps/web/src/features/guidance/GuidanceCards.tsx');
  assert.match(card, /<details className="gd-contract-details">/);
  assert.doesNotMatch(card, /<details className="gd-contract-details" open/);
  assert.match(card, /details\.open = false/);
});

test('批次 B D5: today-actions 第四源接线（controller 传 memoryCards + 面板分支）', async () => {
  const controller = await source('apps/api/src/study/daily-brief.controller.ts');
  assert.match(controller, /memoryCards: \{ dueCount: memoryCardDueCount \}/);
  const panel = await source('apps/web/src/features/student/TodayActionsPanel.tsx');
  assert.match(panel, /memory_due: '记忆卡复习'/);
  assert.match(panel, /'memory_cards'\) onNavigate\('memory-card'\)/);
});
