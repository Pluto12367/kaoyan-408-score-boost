import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadMastery() {
  const source = await readFile(new URL('../packages/shared/src/score-center/mastery.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

test('deriveNodeMasteryStatus maps node mastery and attempts to graph states', async () => {
  const { deriveNodeMasteryStatus } = await loadMastery();
  assert.equal(deriveNodeMasteryStatus({ mastery: 0.5, attempts: 0 }), 'untouched');
  assert.equal(deriveNodeMasteryStatus({ mastery: 0.3, attempts: 3 }), 'weak');
  assert.equal(deriveNodeMasteryStatus({ mastery: 0.55, attempts: 3 }), 'review');
  assert.equal(deriveNodeMasteryStatus({ mastery: 0.8, attempts: 3 }), 'mastered');
});

test('deriveNodeMasteryStatus treats missing attempts as untouched', async () => {
  const { deriveNodeMasteryStatus } = await loadMastery();
  assert.equal(deriveNodeMasteryStatus({ mastery: 0.8, attempts: 0 }), 'untouched');
});
