// V14 — 题库浏览/自由刷题 frontend source contract（任务书
// docs/v14-question-bank-browser-design.md §6；Owner 批准 D-B-1..4 按建议冻结）。
// 钉死：子标签接线、App 启动链路与互斥清理、纯客户端零写入、投影防泄答案。

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('D-B-1: 题库训练区内「自由刷题」子标签接线完整', async () => {
  const sections = await source('apps/web/src/features/student/StudentSections.tsx');
  assert.match(sections, /import \{ FreePracticeBrowser \} from '\.\.\/practice\/FreePracticeBrowser'/);
  assert.match(sections, /推荐训练/);
  assert.match(sections, /自由刷题/);
  assert.match(sections, /questionMode === 'browse'/);
  // 启动练习即切回推荐训练视图（练习面板在该侧），再交 App 层启动。
  assert.match(sections, /setQuestionMode\('recommended'\)/);
  assert.match(sections, /props\.onStartFreePractice\(title, ids\)/);
});

test('D-B-3: App 自由刷题启动链路——显式题单、互斥清理、既有练习流复用', async () => {
  const app = await source('apps/web/src/App.tsx');
  assert.match(app, /freePracticeContext/);
  assert.match(app, /handleStartFreePractice/);
  // activePracticeQuestions 分支：题单经既有 questions 目录解析，零新取数。
  assert.match(app, /freePracticeContext\s*\?\s*questions\.filter\(\(question\) => freePracticeContext\.questionIds\.includes\(question\.id\)\)/);
  // 互斥：quest 启动与今日任务启动都清理自由刷题上下文。
  assert.match(app, /setFreePracticeContext\(null\)/);
  // 离开练习区自动释放。
  assert.match(app, /if \(freePracticeContext && activeSection !== 'question'\)/);
});

test('投影防泄：浏览列表不渲染选项/答案/解析，也不发起任何写请求', async () => {
  const browser = await source('apps/web/src/features/practice/FreePracticeBrowser.tsx');
  // 只渲染 stemPreview 与元数据徽标——不触碰 options/answer/analysis。
  assert.doesNotMatch(browser, /question\.options|\.answer|\.analysis|optionAnalyses/);
  // 浏览零写入：组件内不得出现 fetch/提交调用（RULE-07：浏览 ≠ 活动证据）。
  assert.doesNotMatch(browser, /fetch|submit|axios/);
  // 空态诚实，不回退推荐组。
  assert.match(browser, /该条件下暂无题目/);
});

test('D-B-2/D-B-3 常量：组卷上限 50、四维筛选存在于纯模块', async () => {
  const pure = await source('apps/web/src/features/practice/questionBankBrowser.ts');
  assert.match(pure, /FREE_PRACTICE_MAX_QUESTIONS = 50/);
  for (const key of ['subject', 'type', 'year', 'status']) {
    assert.match(pure, new RegExp(`${key}:`), `filters.${key} must exist`);
  }
});

test('Phase 2（Owner 2026-09-26 追加）：难度筛选、题干搜索、年份+题号定位', async () => {
  const pure = await source('apps/web/src/features/practice/questionBankBrowser.ts');
  // 纯模块：difficulty/query 进 filters；findRowIndex 未找到 = -1。
  assert.match(pure, /difficulty: 'all' \| Question\['difficulty'\]/);
  assert.match(pure, /query: string/);
  assert.match(pure, /export function findRowIndex/);
  assert.match(pure, /question\.stem\.toLowerCase\(\)\.includes\(needle\)/);

  const browser = await source('apps/web/src/features/practice/FreePracticeBrowser.tsx');
  assert.match(browser, /难度/);
  assert.match(browser, /题干搜索/);
  assert.match(browser, /type="search"/);
  assert.match(browser, /定位真题/);
  assert.match(browser, /findRowIndex\(rows, Number\(locateYear\), examNo\)/);
  assert.match(browser, /当前筛选范围内没有该题/, '定位失败必须显式提示，不静默');
});

test('目录投影 additive 扩展：examNo/maxScore 随 GET /questions 下发', async () => {
  const service = await source('apps/api/src/questions/questions.service.ts');
  assert.match(service, /examNo: row\.examNo \?\? undefined/);
  assert.match(service, /maxScore: row\.maxScore \?\? undefined/);
});
