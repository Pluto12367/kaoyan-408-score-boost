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

test('resumed sessions prefer their persisted question snapshot over the current catalog', async () => {
  const { resolveSessionQuestions } = await loadPolicy();
  const restored = resolveSessionQuestions(
    ['q-old', 'q-current'],
    [{ id: 'q-old', stem: '保存时的旧题面' }],
    [{ id: 'q-current', stem: '当前题面' }, { id: 'q-old', stem: '后来修改的题面' }],
  );

  assert.deepEqual(restored, [
    { id: 'q-old', stem: '保存时的旧题面' },
    { id: 'q-current', stem: '当前题面' },
  ]);
});

test('page-close keepalive saves bypass an existing ordinary save queue', async () => {
  const { shouldQueueSessionSave } = await loadPolicy();

  assert.equal(shouldQueueSessionSave(true, false), true);
  assert.equal(shouldQueueSessionSave(true, true), false);
  assert.equal(shouldQueueSessionSave(false, false), false);
});
