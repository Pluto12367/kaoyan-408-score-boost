import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// V9 Phase 2 — Adaptive Weekly Planner. Intensity changes must be earned by
// last week's evidence; without enough evidence the planner maintains.

async function loadModule() {
  const source = await readFile(new URL('../apps/api/src/study/weekly-adjustment.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(() => {
    throw new Error('weekly-adjustment must stay dependency-free');
  }, module, module.exports);
  return module.exports;
}

const outcome = (overrides = {}) => ({
  attemptsInWindow: 6,
  masteryGain: 0.12,
  gatePassed: true,
  ...overrides,
});

test('strong gains with a gate-passed node earn intensity_up', async () => {
  const { deriveWeeklyAdjustment } = await loadModule();
  const adj = deriveWeeklyAdjustment({
    outcomes: [outcome(), outcome({ masteryGain: 0.3, gatePassed: false, attemptsInWindow: 4 })],
    openDebt: 0,
  });
  assert.equal(adj.verdict, 'intensity_up');
  assert.equal(adj.factor, 1.2);
  assert.match(adj.note, /加码 20%/);
});

test('negative average gain triggers intensity_down', async () => {
  const { deriveWeeklyAdjustment } = await loadModule();
  const adj = deriveWeeklyAdjustment({
    outcomes: [outcome({ masteryGain: -0.08, gatePassed: false }), outcome({ masteryGain: -0.05, gatePassed: false })],
    openDebt: 0,
  });
  assert.equal(adj.verdict, 'intensity_down');
  assert.equal(adj.factor, 0.8);
  assert.match(adj.note, /降载 20%/);
});

test('without enough evidence the planner maintains and says so', async () => {
  const { deriveWeeklyAdjustment } = await loadModule();
  const adj = deriveWeeklyAdjustment({ outcomes: [], openDebt: 2 });
  assert.equal(adj.verdict, 'maintain');
  assert.equal(adj.factor, 1);
  assert.match(adj.note, /证据不足/);
});

test('thin gains stay maintain — no bravado', async () => {
  const { deriveWeeklyAdjustment } = await loadModule();
  const adj = deriveWeeklyAdjustment({
    outcomes: [outcome({ masteryGain: 0.03, gatePassed: false }), outcome({ masteryGain: 0.04, gatePassed: false })],
    openDebt: 0,
  });
  assert.equal(adj.verdict, 'maintain');
});

test('applyWeeklyIntensity scales fresh tasks, spares carried ones, clamps minutes', async () => {
  const { applyWeeklyIntensity } = await loadModule();
  const plan = {
    id: 'plan-1',
    tasks: [
      { id: 'week-1-1', minutes: 45, questionCount: 12 },
      { id: 'carry-1-old', minutes: 45, questionCount: 12 },
      { id: 'week-2-1', minutes: 18, questionCount: 8 },
    ],
  };
  const adjusted = applyWeeklyIntensity(plan, { verdict: 'intensity_up', factor: 1.2, note: '', evidence: { evaluated: 2, avgGain: 0.2, gatePassed: 1 } });
  const fresh = adjusted.tasks.find((item) => item.id === 'week-1-1');
  const carried = adjusted.tasks.find((item) => item.id === 'carry-1-old');
  const small = adjusted.tasks.find((item) => item.id === 'week-2-1');
  assert.equal(fresh.minutes, 54);
  assert.equal(fresh.questionCount, 14);
  assert.equal(carried.minutes, 45, 'carried recovery tasks keep their load');
  assert.equal(small.minutes, 22);
  assert.equal(small.questionCount, 10);
});

test('applyWeeklyIntensity clamps minutes at 15 on downshift', async () => {
  const { applyWeeklyIntensity } = await loadModule();
  const adjusted = applyWeeklyIntensity(
    { id: 'p', tasks: [{ id: 'week-1-1', minutes: 18, questionCount: 8 }] },
    { verdict: 'intensity_down', factor: 0.8, note: '', evidence: { evaluated: 2, avgGain: -0.1, gatePassed: 0 } },
  );
  assert.equal(adjusted.tasks[0].minutes, 15, '18 * 0.8 = 14.4 → floor 15');
  assert.equal(adjusted.tasks[0].questionCount, 6);
});
