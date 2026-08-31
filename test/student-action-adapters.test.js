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
