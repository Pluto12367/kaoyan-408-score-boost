import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function compileModule(path, dependencies = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)((specifier) => {
    if (specifier in dependencies) return dependencies[specifier];
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
  return module.exports;
}

async function loadTodayAdapter() {
  const route = await compileModule('apps/web/src/features/onboarding/todayLearningRoute.ts');
  return compileModule('apps/web/src/features/student/actions/adapters/todayActionAdapter.ts', {
    '../../../onboarding/todayLearningRoute': route,
  });
}

async function loadReviewAdapter() {
  return compileModule('apps/web/src/features/student/actions/adapters/reviewActionAdapter.ts');
}

function task(overrides = {}) {
  return {
    id: 'task-1', knowledgePointId: 'kp-1', subject: '数据结构', chapter: '树',
    title: '二叉树专项', minutes: 20, questionCount: 10, mode: '专项训练',
    priority: '中', reason: '近期错误较多', nextAction: '完成专项训练',
    scheduledDate: '2026-08-09', status: 'pending', postponeCount: 0,
    ...overrides,
  };
}

test('Today: turns the highest-priority pending task into a today action', async () => {
  const { buildTodayAction } = await loadTodayAdapter();
  const result = buildTodayAction({ priorityTasks: [
    task({ id: 'low', priority: '低' }),
    task({ id: 'high', priority: '高', title: '高优先级任务', reason: '高优先级原因' }),
  ] }, Date.parse('2026-08-09T10:00:00+08:00'));

  assert.deepEqual(result, {
    id: 'today-task:high', type: 'today_task', title: '高优先级任务',
    destination: 'practice', source: 'today-plan', reason: '高优先级原因', priority: '高',
    context: { taskId: 'high', knowledgeNodeId: 'kp-1' },
  });
});

test('Today: preserves an in-progress task ID and source priority', async () => {
  const { buildTodayAction } = await loadTodayAdapter();
  const result = buildTodayAction({ priorityTasks: [
    task({ id: 'in-progress', status: 'in_progress', priority: '中' }),
  ] });

  assert.equal(result.id, 'today-task:in-progress');
  assert.equal(result.context.taskId, 'in-progress');
  assert.equal(result.priority, '中');
});

test('Today: returns null when the only task is completed', async () => {
  const { buildTodayAction } = await loadTodayAdapter();
  assert.equal(buildTodayAction({ priorityTasks: [
    task({ status: 'completed', completed: true }),
  ] }), null);
});

test('Today: waits for postponed tasks until the route makes them current', async () => {
  const { buildTodayAction } = await loadTodayAdapter();
  const nextAvailableAt = '2026-08-09T11:00:00+08:00';
  const plan = { priorityTasks: [task({ status: 'postponed', nextAvailableAt })] };

  assert.equal(buildTodayAction(plan, Date.parse('2026-08-09T10:00:00+08:00')), null);
  assert.equal(buildTodayAction(plan, Date.parse(nextAvailableAt)).context.taskId, 'task-1');
});

test('Today: maps task modes through the route destination helper without question counts', async () => {
  const { buildTodayAction } = await loadTodayAdapter();
  for (const [mode, destination] of [
    ['专项训练', 'practice'],
    ['诊断复盘', 'review'],
    ['服务端新模式', 'home'],
  ]) {
    const result = buildTodayAction({ priorityTasks: [task({ mode, questionCount: 999 })] });
    assert.equal(result.destination, destination);
  }
});

function dueReview(overrides = {}) {
  return {
    questionId: 'due-1', userId: 'u-1', selfReportedReason: '概念混淆', redoCorrect: false,
    timeSpentSec: 60, consecutiveCorrect: 0, stability: 'learning', nextReviewAt: '2026-08-08T08:00:00.000Z',
    reviewCount: 1, lastReviewedAt: '2026-08-07T08:00:00.000Z', stem: '到期题目',
    knowledgePointTitle: '二叉树', subject: '数据结构', ...overrides,
  };
}

function priorityRedo(overrides = {}) {
  return {
    questionId: 'redo-1', stem: '优先重做题目', knowledgePointTitle: '缓存映射', wrongCount: 3,
    latestMistakeReason: '概念混淆', reviewStatus: 'pending', nextAction: '先复盘再重做', ...overrides,
  };
}

function wrongQuestion(overrides = {}) {
  return {
    questionId: 'fallback-1', stem: '展示兜底题目', knowledgePointId: 'kp-1', knowledgePointTitle: '进程管理',
    subject: '操作系统', chapter: '进程', wrongCount: 1, latestMistakeReason: '审题问题',
    latestSubmittedAt: '2026-08-08T08:00:00.000Z', reviewStatus: 'pending', masteryStatus: '未掌握',
    nextAction: '回看解析', ...overrides,
  };
}

test('Review: due items precede server priority redo items', async () => {
  const { buildReviewActions } = await loadReviewAdapter();
  const result = buildReviewActions({
    dueReviews: [dueReview()], priorityRedoItems: [priorityRedo()],
  });

  assert.deepEqual(result.map((action) => action.id), ['review-due:due-1', 'redo-wrong-question:redo-1']);
  assert.equal(result[0].type, 'review_due');
  assert.equal(result[1].type, 'redo_wrong_question');
});

test('Review: overdue and due items keep their source data', async () => {
  const { buildReviewActions } = await loadReviewAdapter();
  const result = buildReviewActions({
    dueReviews: [
      dueReview({ questionId: 'overdue', stem: '逾期题', inferredReason: '推断错因' }),
      dueReview({ questionId: 'due', stem: '到期题', selfReportedReason: '自述错因' }),
    ],
    priorityRedoItems: [],
  });

  assert.deepEqual(result, [
    {
      id: 'review-due:overdue', type: 'review_due', title: '逾期题', destination: 'review',
      source: 'review-due', reason: '推断错因', context: { questionId: 'overdue' },
    },
    {
      id: 'review-due:due', type: 'review_due', title: '到期题', destination: 'review',
      source: 'review-due', reason: '自述错因', context: { questionId: 'due' },
    },
  ]);
});

test('Wrong: uses server priority redo items when no due review exists', async () => {
  const { buildReviewActions } = await loadReviewAdapter();
  const result = buildReviewActions({ dueReviews: [], priorityRedoItems: [priorityRedo()] });

  assert.deepEqual(result, [{
    id: 'redo-wrong-question:redo-1', type: 'redo_wrong_question', title: '先复盘再重做',
    destination: 'practice', source: 'wrong-summary', reason: '概念混淆',
    context: { questionId: 'redo-1' },
  }]);
});

test('Wrong: uses display fallback last and identifies its source without priority', async () => {
  const { buildReviewActions } = await loadReviewAdapter();
  const result = buildReviewActions({
    dueReviews: [], priorityRedoItems: [priorityRedo()], displayFallbackItems: [wrongQuestion()],
  });

  assert.deepEqual(result.at(-1), {
    id: 'redo-wrong-question:fallback-1', type: 'redo_wrong_question', title: '展示兜底：回看解析',
    destination: 'review', source: 'wrong-summary-fallback', reason: '审题问题', context: { questionId: 'fallback-1' },
  });
});

test('Wrong: duplicate question IDs keep the due occurrence', async () => {
  const { buildReviewActions } = await loadReviewAdapter();
  const result = buildReviewActions({
    dueReviews: [dueReview({ questionId: 'same', stem: '到期版本' })],
    priorityRedoItems: [priorityRedo({ questionId: 'same', stem: '服务端版本' })],
    displayFallbackItems: [wrongQuestion({ questionId: 'same', stem: '展示版本' })],
  });

  assert.deepEqual(result, [{
    id: 'review-due:same', type: 'review_due', title: '到期版本', destination: 'review',
    source: 'review-due', reason: '概念混淆', context: { questionId: 'same' },
  }]);
});

test('Wrong: review adapter does not call a risk or priority engine', async () => {
  const source = await readFile(new URL('../apps/web/src/features/student/actions/adapters/reviewActionAdapter.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /wrongReviewPriority|buildWrongReviewPriority|rankWrongReviewItems|scoreWrongQuestion/);
});
