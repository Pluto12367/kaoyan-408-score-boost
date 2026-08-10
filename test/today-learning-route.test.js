import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

async function loadPolicy() {
  const url = new URL('../apps/web/src/features/onboarding/todayLearningRoute.ts', import.meta.url);
  const source = await fs.readFile(url, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

const task = (overrides = {}) => ({
  id: 'task-1', knowledgePointId: 'kp-1', subject: '数据结构', chapter: '树',
  title: '二叉树专项', minutes: 20, questionCount: 10, mode: '专项训练',
  priority: '中', reason: '近期错误较多', nextAction: '完成专项训练',
  scheduledDate: '2026-08-09', status: 'pending', postponeCount: 0,
  ...overrides,
});

test('selects the highest-priority actionable unfinished task stably', async () => {
  const { resolveTodayRoute } = await loadPolicy();
  const result = resolveTodayRoute([
    task({ id: 'medium-first' }),
    task({ id: 'high-first', priority: '高' }),
    task({ id: 'high-second', priority: '高' }),
    task({ id: 'done', priority: '高', status: 'completed', completed: true }),
  ], Date.parse('2026-08-09T10:00:00+08:00'));
  assert.equal(result.currentTask.id, 'high-first');
  assert.deepEqual(result.orderedTasks.map((item) => item.id), [
    'high-first', 'high-second', 'done', 'medium-first',
  ]);
  assert.equal(result.allCompleted, false);
});

test('waits for the earliest future postponed task', async () => {
  const { resolveTodayRoute } = await loadPolicy();
  const result = resolveTodayRoute([
    task({ id: 'later', status: 'postponed', nextAvailableAt: '2026-08-10T10:00:00+08:00' }),
    task({ id: 'sooner', status: 'postponed', nextAvailableAt: '2026-08-09T15:00:00+08:00' }),
  ], Date.parse('2026-08-09T10:00:00+08:00'));
  assert.equal(result.currentTask, null);
  assert.equal(result.nextAvailableAt, '2026-08-09T15:00:00+08:00');
  assert.equal(result.allCompleted, false);
});

test('makes a postponed task actionable at its availability time', async () => {
  const { resolveTodayRoute } = await loadPolicy();
  const result = resolveTodayRoute([
    task({ status: 'postponed', nextAvailableAt: '2026-08-09T10:00:00+08:00' }),
  ], Date.parse('2026-08-09T10:00:00+08:00'));
  assert.equal(result.currentTask.id, 'task-1');
  assert.equal(result.nextAvailableAt, null);
});

test('reports an empty or completed route as fully completed', async () => {
  const { resolveTodayRoute } = await loadPolicy();
  assert.deepEqual(resolveTodayRoute([], Date.parse('2026-08-09T10:00:00+08:00')), {
    orderedTasks: [], currentTask: null, nextAvailableAt: null, allCompleted: true,
  });
  const result = resolveTodayRoute([task({ status: 'completed', completed: true })]);
  assert.equal(result.currentTask, null);
  assert.equal(result.allCompleted, true);
});

test('uses a continue action label for an in-progress task', async () => {
  const { getTodayTaskActionLabel } = await loadPolicy();
  assert.equal(getTodayTaskActionLabel(task({ status: 'in_progress' }), 'question'), '继续练习');
  assert.equal(getTodayTaskActionLabel(task(), 'wrong-book'), '开始复盘');
  assert.equal(getTodayTaskActionLabel(task(), 'plan'), '查看任务');
});

test('maps only known modes and safely falls back to plan', async () => {
  const { resolveTodayTaskDestination } = await loadPolicy();
  assert.equal(resolveTodayTaskDestination('基础例题'), 'question');
  assert.equal(resolveTodayTaskDestination('专项训练'), 'question');
  assert.equal(resolveTodayTaskDestination('阶段巩固'), 'question');
  assert.equal(resolveTodayTaskDestination('诊断复盘'), 'wrong-book');
  assert.equal(resolveTodayTaskDestination('考后复盘'), 'wrong-book');
  assert.equal(resolveTodayTaskDestination('新服务端模式'), 'plan');
});

test('preflight rejects missing content before a task can start', async () => {
  const { preflightTodayTaskLaunch } = await loadPolicy();
  assert.deepEqual(preflightTodayTaskLaunch(task(), [], []), {
    kind: 'error', message: '该知识点暂无可用题目，请先调整今日计划。',
  });
  assert.deepEqual(preflightTodayTaskLaunch(task({ mode: '诊断复盘' }), [], []), {
    kind: 'error', message: '该知识点暂无待复盘错题，请先调整今日计划。',
  });
  assert.deepEqual(preflightTodayTaskLaunch(task({ mode: '未知' }), [], []), {
    kind: 'navigate-plan', taskId: 'task-1',
  });
});

test('preflight returns launch context only when matching content exists', async () => {
  const { preflightTodayTaskLaunch } = await loadPolicy();
  assert.deepEqual(preflightTodayTaskLaunch(task(), [{ id: 'q-1', knowledgePointIds: ['kp-1'] }], []), {
    kind: 'ready', context: { taskId: 'task-1', knowledgePointId: 'kp-1', destination: 'question' },
  });
  assert.deepEqual(preflightTodayTaskLaunch(task({ mode: '考后复盘' }), [], [{ questionId: 'q-2', knowledgePointId: 'kp-1' }]), {
    kind: 'ready', context: { taskId: 'task-1', knowledgePointId: 'kp-1', destination: 'wrong-book' },
  });
});

test('finds the next launchable today task when the current task has no content', async () => {
  const { resolveLaunchableTodayTask } = await loadPolicy();
  const result = resolveLaunchableTodayTask([
    task({ id: 'missing-review', priority: '高', mode: '诊断复盘', knowledgePointId: 'kp-review' }),
    task({ id: 'ready-practice', priority: '低', mode: '专项训练', knowledgePointId: 'kp-practice' }),
  ], task({ id: 'missing-review', priority: '高', mode: '诊断复盘', knowledgePointId: 'kp-review' }), [
    { id: 'q-1', knowledgePointIds: ['kp-practice'] },
  ], [], Date.parse('2026-08-09T10:00:00+08:00'));

  assert.equal(result.kind, 'ready');
  assert.equal(result.task.id, 'ready-practice');
  assert.deepEqual(result.preflight.context, {
    taskId: 'ready-practice',
    knowledgePointId: 'kp-practice',
    destination: 'question',
  });
  assert.equal(result.skippedTaskIds.includes('missing-review'), true);
});

test('does not fallback to completed or future postponed tasks', async () => {
  const { resolveLaunchableTodayTask } = await loadPolicy();
  const now = Date.parse('2026-08-09T10:00:00+08:00');
  const result = resolveLaunchableTodayTask([
    task({ id: 'missing-review', priority: '高', mode: '诊断复盘', knowledgePointId: 'kp-review' }),
    task({ id: 'done', priority: '中', status: 'completed', completed: true, knowledgePointId: 'kp-ready' }),
    task({ id: 'future', priority: '低', status: 'postponed', nextAvailableAt: '2026-08-10T10:00:00+08:00', knowledgePointId: 'kp-ready' }),
  ], task({ id: 'missing-review', priority: '高', mode: '诊断复盘', knowledgePointId: 'kp-review' }), [
    { id: 'q-1', knowledgePointIds: ['kp-ready'] },
  ], [], now);

  assert.equal(result.kind, 'error');
  assert.equal(result.message, '今日任务暂无可用题目或错题，请调整今日计划。');
});

test('recommends the next unfinished task after a today task is completed', async () => {
  const { deriveTodayTaskNextStep } = await loadPolicy();
  const step = deriveTodayTaskNextStep({
    priorityTasks: [
      task({ id: 'done-now', title: '图专项训练', status: 'pending' }),
      task({ id: 'next-task', title: '树复盘', status: 'pending', priority: '低' }),
    ],
  }, 'done-now', 0);

  assert.equal(step.kind, 'next-task');
  assert.equal(step.nextTaskId, 'next-task');
  assert.equal(step.actionLabel, '继续下一项');
  assert.equal(step.targetSection, 'dashboard');
  assert.match(step.message, /已完成今日任务：图专项训练/);
  assert.match(step.message, /下一步建议：回到学习中控台开始「树复盘」/);
});

test('recommends wrong-book review when all today tasks are done and wrong questions are pending', async () => {
  const { deriveTodayTaskNextStep } = await loadPolicy();
  const step = deriveTodayTaskNextStep({
    priorityTasks: [
      task({ id: 'done-now', title: 'Cache 训练', status: 'completed', completed: true }),
    ],
  }, 'done-now', 3);

  assert.equal(step.kind, 'wrong-book');
  assert.equal(step.actionLabel, '去复盘错题');
  assert.equal(step.targetSection, 'wrong-book');
  assert.match(step.message, /还有 3 道错题待复盘/);
});

test('recommends report review when no today task or wrong-book action remains', async () => {
  const { deriveTodayTaskNextStep } = await loadPolicy();
  const step = deriveTodayTaskNextStep({
    priorityTasks: [
      task({ id: 'done-now', title: '操作系统同步', status: 'completed', completed: true }),
    ],
  }, 'done-now', 0);

  assert.equal(step.kind, 'report');
  assert.equal(step.actionLabel, '查看学习报告');
  assert.equal(step.targetSection, 'report');
  assert.match(step.message, /今日任务已完成/);
});

test('keeps postponed tasks without a valid availability time non-actionable', async () => {
  const { resolveTodayRoute } = await loadPolicy();
  for (const nextAvailableAt of [undefined, 'not-a-date']) {
    const result = resolveTodayRoute([
      task({ status: 'postponed', nextAvailableAt }),
    ], Date.parse('2026-08-09T10:00:00+08:00'));
    assert.equal(result.currentTask, null);
    assert.equal(result.nextAvailableAt, null);
    assert.equal(result.allCompleted, false);
  }
});

test('computes a bounded refresh delay only for a valid future availability time', async () => {
  const { getTodayRouteRefreshDelay } = await loadPolicy();
  const now = Date.parse('2026-08-09T10:00:00+08:00');
  assert.equal(getTodayRouteRefreshDelay('2026-08-09T10:00:05+08:00', now), 5_025);
  assert.equal(getTodayRouteRefreshDelay(null, now), null);
  assert.equal(getTodayRouteRefreshDelay('not-a-date', now), null);
});

test('clears a task launch only after its owning student changes or disappears', async () => {
  const { shouldClearTodayTaskLaunch } = await loadPolicy();
  assert.equal(shouldClearTodayTaskLaunch(undefined, 'u-001'), false);
  assert.equal(shouldClearTodayTaskLaunch('u-001', 'u-001'), false);
  assert.equal(shouldClearTodayTaskLaunch('u-001', 'u-002'), true);
  assert.equal(shouldClearTodayTaskLaunch('u-001', undefined), true);
});

test('does not commit a deferred task start after its owner generation is invalidated', async () => {
  const { startTodayTaskIfCurrent } = await loadPolicy();
  let finishStart;
  let current = true;
  const startFinished = new Promise((resolve) => { finishStart = resolve; });
  const resultPromise = startTodayTaskIfCurrent('task-1', () => startFinished, () => current);
  current = false;
  finishStart();
  assert.equal(await resultPromise, false);
});

test('commits a completed task start while its owner generation remains current', async () => {
  const { startTodayTaskIfCurrent } = await loadPolicy();
  const result = await startTodayTaskIfCurrent('task-1', async () => undefined, () => true);
  assert.equal(result, true);
});
