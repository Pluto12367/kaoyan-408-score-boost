import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Behavior tests for the B2 Review Center read model (reviewCenterViewModel +
// wrongReviewPriority). These replace the pre-B2 canonical action-spine
// source-contract assertions with direct invariant checks on the current
// architecture.

async function loadModule(relPath) {
  const source = await readFile(new URL(relPath, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(() => {
    throw new Error('review center modules must stay type-only in their imports');
  }, module, module.exports);
  return module.exports;
}

const DAY = 86_400_000;
const iso = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString();

const dueReview = (overrides = {}) => ({
  questionId: 'q-due',
  knowledgePointTitle: 'Cache 映射与替换',
  subject: '计算机组成原理',
  stem: '题干',
  nextReviewAt: iso(0),
  reviewCount: 1,
  stability: 'learning',
  ...overrides,
});

const wrongQuestion = (overrides = {}) => ({
  questionId: 'q-1',
  knowledgePointId: 'kp-1',
  knowledgePointTitle: '先序遍历',
  subject: '数据结构',
  chapter: '树与二叉树',
  stem: '题干',
  masteryStatus: '未掌握',
  reviewStatus: 'pending',
  wrongCount: 3,
  importance: 4,
  reviewedAt: null,
  latestSubmittedAt: iso(-1),
  nextAction: '打开详情，确认复盘动作。',
  ...overrides,
});

const masteryMap = () => ({
  subjects: [
    {
      subject: '数据结构',
      points: [{ knowledgePointId: 'kp-1', masteryRate: 42, status: 'weak' }],
    },
  ],
  weakestPoints: [
    { knowledgePointId: 'kp-1', title: '先序遍历', chapter: '树与二叉树', masteryRate: 42, status: 'weak', wrongCount: 3, nextAction: '回归基础' },
  ],
});

test('priority item prefers review-due, then priority-redo, then display fallback', async () => {
  const { buildReviewCenterViewModel } = await loadModule('../apps/web/src/features/mistakes/reviewCenterViewModel.ts');

  const due = buildReviewCenterViewModel({
    dueReviews: [dueReview()],
    wrongQuestions: [wrongQuestion()],
    priorityRedoItems: [{ questionId: 'q-redo', knowledgePointTitle: '信号量', stem: '题干', reviewStatus: 'pending', wrongCount: 2, latestMistakeReason: '概念混淆', nextAction: '重做验证' }],
    masteryMap: masteryMap(),
    displayFallbackItem: wrongQuestion({ questionId: 'q-fb' }),
  });
  assert.equal(due.priorityItem.source, 'review-due');
  assert.equal(due.priorityItem.questionId, 'q-due');

  const redo = buildReviewCenterViewModel({
    dueReviews: [],
    wrongQuestions: [wrongQuestion()],
    priorityRedoItems: [{ questionId: 'q-redo', knowledgePointTitle: '信号量', stem: '题干', reviewStatus: 'pending', wrongCount: 2, latestMistakeReason: '概念混淆', nextAction: '重做验证' }],
    masteryMap: masteryMap(),
    displayFallbackItem: wrongQuestion({ questionId: 'q-fb' }),
  });
  assert.equal(redo.priorityItem.source, 'priority-redo');
  assert.match(redo.priorityItem.reason, /概念混淆/);
  assert.equal(redo.priorityItem.suggestedAction, '重做验证');

  const fallback = buildReviewCenterViewModel({
    dueReviews: [],
    wrongQuestions: [wrongQuestion({ questionId: 'q-fb' })],
    priorityRedoItems: [],
    masteryMap: masteryMap(),
    displayFallbackItem: wrongQuestion({ questionId: 'q-fb' }),
  });
  assert.equal(fallback.priorityItem.source, 'display-fallback');
  assert.match(fallback.priorityItem.reason, /当前没有到期或服务端优先项/, 'fallback reason must stay honest about its basis');

  const empty = buildReviewCenterViewModel({
    dueReviews: [],
    wrongQuestions: [],
    priorityRedoItems: [],
    masteryMap: masteryMap(),
    displayFallbackItem: null,
  });
  assert.equal(empty.priorityItem, null);
});

test('queue buckets split by due date and metrics count today/overdue/pending', async () => {
  const { buildReviewCenterViewModel } = await loadModule('../apps/web/src/features/mistakes/reviewCenterViewModel.ts');
  const vm = buildReviewCenterViewModel({
    dueReviews: [
      dueReview({ questionId: 'q-today', nextReviewAt: iso(0) }),
      dueReview({ questionId: 'q-overdue', nextReviewAt: iso(-2) }),
    ],
    wrongQuestions: [wrongQuestion()],
    priorityRedoItems: [],
    masteryMap: masteryMap(),
    pendingCount: 7,
  });
  assert.deepEqual(vm.queue.today.flatMap((group) => group.questionIds), ['q-today']);
  assert.deepEqual(vm.queue.overdue.flatMap((group) => group.questionIds), ['q-overdue']);
  assert.equal(vm.metrics.todayDueCount, 1);
  assert.equal(vm.metrics.overdueCount, 1);
  assert.equal(vm.metrics.pendingCount, 7, 'pendingCount must use the server summary, not the list length');
});

test('queue groups same-point due items so identical cards never repeat', async () => {
  const { buildReviewCenterViewModel } = await loadModule('../apps/web/src/features/mistakes/reviewCenterViewModel.ts');
  const vm = buildReviewCenterViewModel({
    dueReviews: [
      dueReview({ questionId: 'q-c1' }),
      dueReview({ questionId: 'q-c2' }),
      dueReview({ questionId: 'q-c3' }),
      dueReview({ questionId: 'q-other', knowledgePointTitle: '信号量' }),
    ],
    wrongQuestions: [],
    priorityRedoItems: [],
    masteryMap: null,
  });
  assert.equal(vm.queue.today.length, 2, '5 same-point cards must collapse to per-point groups');
  const cacheGroup = vm.queue.today[0];
  assert.equal(cacheGroup.knowledgePointTitle, 'Cache 映射与替换');
  assert.equal(cacheGroup.count, 3);
  assert.deepEqual(cacheGroup.questionIds, ['q-c1', 'q-c2', 'q-c3'], 'group keeps every question id for the detail entry');
  assert.equal(vm.queue.today[1].knowledgePointTitle, '信号量');
});

test('queue items enrich mastery through Point→Node resolution and keep honest 未评估', async () => {
  const { buildReviewCenterViewModel } = await loadModule('../apps/web/src/features/mistakes/reviewCenterViewModel.ts');
  const vm = buildReviewCenterViewModel({
    dueReviews: [
      dueReview({ questionId: 'q-1' }),
      dueReview({ questionId: 'q-unknown', knowledgePointTitle: '无映射考点' }),
    ],
    wrongQuestions: [wrongQuestion({ knowledgeNodeIds: ['node-a'] })],
    priorityRedoItems: [],
    masteryMap: masteryMap(),
  });
  const known = vm.queue.today.find((group) => group.questionIds.includes('q-1'));
  const unknown = vm.queue.today.find((group) => group.questionIds.includes('q-unknown'));
  assert.equal(known.masteryLabel, '42%', 'wrong question kp-1 must resolve through the mastery index');
  assert.equal(unknown.masteryLabel, '未评估', 'missing mastery must read 未评估, never 0%');
});

test('weak knowledge prefers the mastery map weakest points and keeps next actions', async () => {
  const { buildReviewCenterViewModel } = await loadModule('../apps/web/src/features/mistakes/reviewCenterViewModel.ts');
  const vm = buildReviewCenterViewModel({
    dueReviews: [],
    wrongQuestions: [wrongQuestion()],
    priorityRedoItems: [],
    masteryMap: masteryMap(),
  });
  assert.equal(vm.weakKnowledge[0].title, '先序遍历');
  assert.equal(vm.weakKnowledge[0].masteryLabel, '42%');
  assert.equal(vm.weakKnowledge[0].nextAction, '回归基础');
});

test('buildWrongReviewPriority derives priority tiers, honest reasons, and tiered actions', async () => {
  const { buildWrongReviewPriority, rankWrongReviewItems } = await loadModule('../apps/web/src/features/mistakes/wrongReviewPriority.ts');

  const hot = buildWrongReviewPriority(wrongQuestion({ wrongCount: 5, importance: 5, masteryStatus: '未掌握', reviewedAt: null }));
  assert.equal(hot.priority, '高');
  assert.match(hot.reason, /错了 5 次/);
  assert.match(hot.reason, /还没有完整复盘记录/);
  assert.match(hot.suggestedAction, /先复盘标准解析/);

  const calm = buildWrongReviewPriority(wrongQuestion({ wrongCount: 1, importance: 1, masteryStatus: '已掌握', reviewedAt: iso(-30) }));
  assert.equal(calm.priority, '低');
  assert.match(calm.suggestedAction, /确认掌握后再做一题验证/);

  const ranked = rankWrongReviewItems([
    wrongQuestion({ questionId: 'low', wrongCount: 1, importance: 1 }),
    wrongQuestion({ questionId: 'high', wrongCount: 5, importance: 5 }),
  ]);
  assert.deepEqual(ranked.map((item) => item.questionId), ['high', 'low']);
});
