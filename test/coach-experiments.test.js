import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createHash } from 'node:crypto';

// V9 Phase 6 — deterministic A/B assignment + feedback reflow signals.

async function loadModule() {
  const source = await readFile(new URL('../apps/api/src/study/coach-experiments.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)((id) => {
    if (id === 'node:crypto') return { createHash };
    throw new Error(`unexpected dependency: ${id}`);
  }, module, module.exports);
  return module.exports;
}

test('arm assignment is deterministic, sticky, and restricted to the declared arms', async () => {
  const { assignExperimentArm } = await loadModule();
  const first = assignExperimentArm('user-1', 'daily-brief-tone', ['control', 'variant']);
  const again = assignExperimentArm('user-1', 'daily-brief-tone', ['control', 'variant']);
  assert.equal(first, again, 'same user+experiment must not flip arms between calls');
  assert.ok(['control', 'variant'].includes(first));

  const otherExperiment = assignExperimentArm('user-1', 'quick-session-copy', ['control', 'variant']);
  assert.ok(['control', 'variant'].includes(otherExperiment));

  let control = 0;
  for (let index = 0; index < 400; index += 1) {
    if (assignExperimentArm(`user-${index}`, 'x', ['control', 'variant']) === 'control') control += 1;
  }
  assert.ok(control > 120 && control < 280, `split should be roughly even, got ${control}/400 control`);
});

test('hash stub proves the module only needs node:crypto', async () => {
  const module = await loadModule();
  assert.ok(typeof module.assignExperimentArm === 'function');
});

test('feedback reflow flags only scenes with repeated low ratings', async () => {
  const { deriveFeedbackInsights } = await loadModule();
  const records = [
    { scene: 'today_plan', rating: 2 },
    { scene: 'today_plan', rating: 1 },
    { scene: 'today_plan', rating: 2 },
    { scene: 'practice', rating: 5 },
    { scene: 'practice', rating: 2 },
    { scene: 'exam', rating: 4 },
  ];
  const { candidates, all } = deriveFeedbackInsights(records);
  assert.deepEqual(candidates.map((item) => item.scene), ['today_plan']);
  assert.equal(all.find((item) => item.scene === 'practice').negative, 1, 'a single low rating is not a candidate');
  assert.equal(all.find((item) => item.scene === 'exam').negative, 0);
});
