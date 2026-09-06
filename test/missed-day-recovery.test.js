import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// V8 backlog #13 — missed-day recovery. When the 7-day window lapses, the
// old plan is dropped; open overdue tasks used to vanish silently (audit P9:
// August 考后复盘 leftovers, returning students restarting from zero).
// The recovery module harvests the most overdue open tasks and re-anchors
// them into the fresh window.

async function loadModule() {
  const source = await readFile(
    new URL('../apps/api/src/study/missed-day-recovery.ts', import.meta.url),
    'utf8',
  );
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(() => {
    throw new Error('missed-day-recovery must stay dependency-free (type-only imports)');
  }, module, module.exports);
  return module.exports;
}

const TODAY = '2026-09-07';
const task = (overrides = {}) => ({
  id: 'week-1-1-old',
  knowledgePointId: 'kp-cache',
  subject: 'COMPUTER_ORGANIZATION',
  chapter: '存储系统',
  title: 'Cache 映射与替换',
  mode: '专项训练',
  minutes: 30,
  questionCount: 10,
  scheduledDate: '2026-09-01',
  priority: '高',
  reason: '高频考点',
  nextAction: '完成练习',
  status: 'pending',
  postponeCount: 0,
  ...overrides,
});

test('harvest keeps open overdue tasks, drops completed and future ones', async () => {
  const { harvestCarryOverTasks } = await loadModule();
  const harvested = harvestCarryOverTasks([
    task({ id: 'done', status: 'completed', scheduledDate: '2026-09-01' }),
    task({ id: 'future', scheduledDate: '2026-09-10' }),
    task({ id: 'overdue-b', scheduledDate: '2026-09-03' }),
    task({ id: 'overdue-a', scheduledDate: '2026-08-30' }),
    task({ id: 'in-progress', status: 'in_progress', scheduledDate: '2026-09-02' }),
  ], TODAY);
  assert.deepEqual(harvested.map((item) => item.id), ['overdue-a', 'in-progress', 'overdue-b'],
    'oldest first, in_progress counts as open');
});

test('harvest caps the carry-over at 3 to keep the return day light', async () => {
  const { harvestCarryOverTasks } = await loadModule();
  const many = Array.from({ length: 8 }, (_, index) => task({ id: `t-${index}`, scheduledDate: `2026-09-0${index + 1}` }));
  assert.equal(harvestCarryOverTasks(many, TODAY).length, 3);
});

test('applyCarryOver re-anchors tasks onto the first fresh days with 断档补做 reason', async () => {
  const { applyCarryOver, harvestCarryOverTasks } = await loadModule();
  const plan = {
    id: 'plan-1',
    startDate: TODAY,
    tasks: [
      task({ id: 'fresh-today', scheduledDate: TODAY, title: '新任务A' }),
      task({ id: 'fresh-today-2', scheduledDate: TODAY, title: '新任务B' }),
      task({ id: 'fresh-tomorrow', scheduledDate: '2026-09-08', title: '新任务C' }),
    ],
  };
  const carryOver = harvestCarryOverTasks([
    task({ id: 'old-1', scheduledDate: '2026-08-30' }),
    task({ id: 'old-2', scheduledDate: '2026-09-03' }),
  ], TODAY);

  const recovered = applyCarryOver(plan, carryOver, TODAY);
  assert.equal(recovered.recoveredFromGap.carriedCount, 2);
  assert.equal(recovered.recoveredFromGap.recoveredOn, TODAY);

  const todayCarried = recovered.tasks.filter((item) => item.scheduledDate === TODAY);
  assert.equal(todayCarried[0].id.includes('old-1'), true, 'oldest carry-over leads today');
  assert.match(todayCarried[0].reason, /^断档补做：/);
  assert.equal(todayCarried[0].status, 'pending');
  assert.equal(todayCarried[0].postponeCount, 0);
  assert.equal(todayCarried[0].startedAt, undefined, 'carried tasks must not inherit stale runtime fields');

  assert.equal(recovered.tasks.filter((item) => item.scheduledDate === '2026-09-08')[0].id.includes('old-2'), true);
  // Original fresh tasks survive
  assert.equal(recovered.tasks.some((item) => item.id === 'fresh-today'), true);
});

test('applyCarryOver with nothing to carry leaves the plan untouched', async () => {
  const { applyCarryOver } = await loadModule();
  const plan = { id: 'plan-1', startDate: TODAY, tasks: [task({ id: 'fresh', scheduledDate: TODAY })] };
  const recovered = applyCarryOver(plan, [], TODAY);
  assert.equal(recovered.recoveredFromGap, undefined);
  assert.equal(recovered.tasks.length, 1);
});
