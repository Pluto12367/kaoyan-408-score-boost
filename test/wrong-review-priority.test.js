import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function loadSource() {
  return readFile(new URL('../apps/web/src/features/mistakes/wrongReviewPriority.ts', import.meta.url), 'utf8');
}

test('wrong review priority helper exposes the source contract', async () => {
  const source = await loadSource();
  assert.match(source, /export interface WrongReviewPriorityResult/);
  assert.match(source, /priority: '高' \| '中' \| '低'/);
  assert.match(source, /reason: string/);
  assert.match(source, /suggestedAction: string/);
  assert.match(source, /export function rankWrongReviewItems/);
  assert.match(source, /export function buildWrongReviewPriority/);
});

test('wrong review priority helper prefers repeated, important and due items', async () => {
  const source = await loadSource();
  assert.match(source, /const repeated = Math\.min\(item\.wrongCount, 5\) \* 18/);
  assert.match(source, /const importance = \(item\.importance \?\? 3\) \* 12/);
  assert.match(source, /const dueBoost = item\.reviewedAt/);
  assert.match(source, /const notReviewedBoost = item\.reviewStatus === 'pending'/);
  assert.match(source, /const masteryBoost = item\.masteryStatus === '未掌握'/);
  assert.match(source, /const sameTypePenalty = item\.masteryCriteria\?\.variantCorrectCount === 0/);
  assert.match(source, /priority = score >= 80 \? '高' : score >= 55 \? '中' : '低'/);
  assert.match(source, /先复盘标准解析，再做同考点变式/);
  assert.match(source, /先回看错因，再做一次重做/);
  assert.match(source, /确认掌握后再做一题验证/);
});

test('wrong review priority surface is wired into the mistake workspace and detail view', async () => {
  const workspace = await readFile(new URL('../apps/web/src/features/mistakes/MistakeWorkspace.tsx', import.meta.url), 'utf8');
  const detail = await readFile(new URL('../apps/web/src/components/WrongQuestionDetail.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /wrong-today-task-panel/);
  assert.match(workspace, /今日最该复盘/);
  assert.match(workspace, /先复盘这题/);
  assert.match(workspace, /重做这题/);
  assert.match(workspace, /看详情与笔记/);
  assert.match(detail, /本题考点/);
  assert.match(detail, /我的错因/);
  assert.match(detail, /我的掌握度/);
  assert.match(detail, /下一步怎么学/);
  assert.match(detail, /复测路径/);
});
