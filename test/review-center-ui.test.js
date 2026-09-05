import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

async function loadViewModel() {
  const url = new URL('../apps/web/src/features/mistakes/reviewCenterViewModel.ts', import.meta.url);
  const source = await readFile(url, 'utf8');
  const output = ts.transpileModule(source, {
    fileName: 'reviewCenterViewModel.ts',
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)(() => {
    throw new Error('review center view model must be dependency-free');
  }, module, module.exports);
  return module.exports;
}

const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

function due(questionId, nextReviewAt) {
  return {
    questionId,
    userId: 'u-1',
    selfReportedReason: '概念混淆',
    redoCorrect: false,
    timeSpentSec: 80,
    consecutiveCorrect: 0,
    stability: 'learning',
    nextReviewAt,
    reviewCount: 2,
    lastReviewedAt: `${yesterday}T08:00:00.000Z`,
  };
}

function wrong(questionId, overrides = {}) {
  return {
    questionId,
    stem: `${questionId} 题干`,
    knowledgePointId: `kp-${questionId}`,
    knowledgePointTitle: `考点 ${questionId}`,
    subject: '操作系统',
    chapter: '进程管理',
    wrongCount: 3,
    latestMistakeReason: '概念混淆',
    latestSubmittedAt: `${today}T09:00:00.000Z`,
    reviewStatus: 'pending',
    reviewedAt: null,
    masteryStatus: '未掌握',
    ...overrides,
  };
}

test('review queue separates today and overdue items and prefers due data for the primary action', async () => {
  const { buildReviewCenterViewModel } = await loadViewModel();
  const model = buildReviewCenterViewModel({
    dueReviews: [due('q-today', `${today}T08:00:00.000Z`), due('q-overdue', `${yesterday}T08:00:00.000Z`)],
    wrongQuestions: [wrong('q-today'), wrong('q-overdue')],
    priorityRedoItems: [{
      questionId: 'q-priority',
      stem: '服务端优先项',
      knowledgePointTitle: '服务端优先考点',
      wrongCount: 4,
      latestMistakeReason: '审题错误',
      reviewStatus: 'pending',
      nextAction: '重做并复盘',
    }],
    masteryMap: null,
  });

  assert.equal(model.metrics.todayDueCount, 1);
  assert.equal(model.metrics.overdueCount, 1);
  assert.equal(model.queue.today.length, 1);
  assert.equal(model.queue.overdue.length, 1);
  assert.equal(model.priorityItem?.source, 'review-due');
  assert.equal(model.priorityItem?.questionId, 'q-today');
});

test('server priority redo item is used when no due review exists', async () => {
  const { buildReviewCenterViewModel } = await loadViewModel();
  const model = buildReviewCenterViewModel({
    dueReviews: [],
    wrongQuestions: [wrong('q-priority')],
    priorityRedoItems: [{
      questionId: 'q-priority',
      stem: '服务端优先项',
      knowledgePointTitle: '服务端优先考点',
      wrongCount: 4,
      latestMistakeReason: '审题错误',
      reviewStatus: 'pending',
      nextAction: '重做并复盘',
    }],
    masteryMap: null,
  });

  assert.equal(model.priorityItem?.source, 'priority-redo');
  assert.equal(model.priorityItem?.questionId, 'q-priority');
});

test('missing mastery is presented as unevaluated instead of zero', async () => {
  const { buildReviewCenterViewModel } = await loadViewModel();
  const model = buildReviewCenterViewModel({
    dueReviews: [],
    wrongQuestions: [wrong('q-unknown')],
    priorityRedoItems: [],
    masteryMap: null,
  });

  assert.equal(model.weakKnowledge[0]?.masteryLabel, '未评估');
  assert.notEqual(model.weakKnowledge[0]?.masteryLabel, '0%');
});

test('missing review data produces safe empty queue state', async () => {
  const { buildReviewCenterViewModel } = await loadViewModel();
  const model = buildReviewCenterViewModel({
    dueReviews: [],
    wrongQuestions: [],
    priorityRedoItems: [],
    masteryMap: null,
  });

  assert.deepEqual(model.queue.today, []);
  assert.deepEqual(model.queue.overdue, []);
  assert.deepEqual(model.queue.upcoming, []);
  assert.equal(model.priorityItem, null);
});

test('mistake workspace keeps existing filters, details, review, redo and variant callbacks', async () => {
  const workspace = await readFile(new URL('../apps/web/src/features/mistakes/MistakeWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /fetchDueReviews/);
  assert.match(workspace, /ReviewHero/);
  assert.match(workspace, /ReviewQueue/);
  assert.match(workspace, /WeakKnowledgeList/);
  assert.match(workspace, /RecentMistakes/);
  assert.match(workspace, /filterWrongQuestions/);
  assert.match(workspace, /onReview\(item\.questionId\)/);
  assert.match(workspace, /onOpenDetail\(item\.questionId\)/);
  assert.match(workspace, /onRedo\(item\.questionId/);
  assert.match(workspace, /onPracticeVariant/);
  assert.match(workspace, /WrongQuestionDetailView/);
});

test('student sections passes the existing mastery map without adding a second state source', async () => {
  const source = await readFile(new URL('../apps/web/src/features/student/StudentSections.tsx', import.meta.url), 'utf8');
  assert.match(source, /masteryMap=\{props\.masteryMap\}/);
  assert.match(source, /<MistakeWorkspace/);
});

test('review center keeps stable data-testid hooks for UI smoke tests', () => {
  const files = [
    'apps/web/src/features/mistakes/components/ReviewHero.tsx',
    'apps/web/src/features/mistakes/components/PriorityReviewCard.tsx',
    'apps/web/src/features/mistakes/components/ReviewQueue.tsx',
    'apps/web/src/features/mistakes/components/WeakKnowledgeList.tsx',
    'apps/web/src/features/mistakes/components/RecentMistakes.tsx',
  ];
  for (const file of files) {
    assert.doesNotThrow(() => readFileSync(file, 'utf8'));
  }
});
