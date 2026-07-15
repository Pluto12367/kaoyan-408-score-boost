import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadPolicy() {
  const source = await readFile(new URL('../apps/web/src/studentSessionPolicy.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

test('logging out immediately hides a previously loaded student overview', async () => {
  const { isStudentOverviewReady } = await loadPolicy();

  assert.equal(isStudentOverviewReady(false, true), false);
  assert.equal(isStudentOverviewReady(true, true), true);
});

test('only the static demo may hydrate a user from overview data', async () => {
  const { shouldHydrateSessionFromOverview } = await loadPolicy();

  assert.equal(shouldHydrateSessionFromOverview(false, true), false);
  assert.equal(shouldHydrateSessionFromOverview(true, true), true);
  assert.equal(shouldHydrateSessionFromOverview(true, false), false);
});
