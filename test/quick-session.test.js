import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// V8 backlog #12 — time-budget quick sessions. Students on a fragment
// schedule (audit: 48-question bursts then zero days) need "我现在只有
// 15 分钟" to produce a minutes-sized set, not the default 60-minute one.

async function loadModule() {
  const source = await readFile(new URL('../apps/api/src/study/quick-session.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(() => {
    throw new Error('quick-session must stay dependency-free');
  }, module, module.exports);
  return module.exports;
}

test('questionCountForMinutes shrinks the base set for small budgets', async () => {
  const { questionCountForMinutes } = await loadModule();
  assert.equal(questionCountForMinutes(15, 20), 5, '15 min → 5 questions even in 冲刺');
  assert.equal(questionCountForMinutes(30, 20), 10);
  assert.equal(questionCountForMinutes(60, 12), 12, '60 min keeps the base sizing');
  assert.equal(questionCountForMinutes(90, 16), 16);
});

test('parseMinutesBudget clamps and rejects garbage without breaking the default flow', async () => {
  const { parseMinutesBudget } = await loadModule();
  assert.equal(parseMinutesBudget(undefined), null);
  assert.equal(parseMinutesBudget('15'), 15);
  assert.equal(parseMinutesBudget('60'), 60);
  assert.equal(parseMinutesBudget('abc'), null, 'garbage must not throw the endpoint');
  assert.equal(parseMinutesBudget('-5'), 10, 'clamped to the 10-minute floor');
  assert.equal(parseMinutesBudget('9999'), 120, 'clamped to the 120-minute ceiling');
});
