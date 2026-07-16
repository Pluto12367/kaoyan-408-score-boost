import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadActiveTime() {
  const source = await readFile(new URL('../apps/web/src/activeTime.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

test('background time is excluded from active study time', async () => {
  const { activeElapsedMs, pauseActiveClock, resumeActiveClock } = await loadActiveTime();
  let clock = { baseMs: 0, segmentStartedAt: 100 };

  clock = pauseActiveClock(clock, 600);
  assert.equal(activeElapsedMs(clock, 10_600), 500);

  clock = resumeActiveClock(clock, 10_600);
  assert.equal(activeElapsedMs(clock, 11_100), 1_000);
});

test('pausing or resuming repeatedly does not double count time', async () => {
  const { activeElapsedMs, pauseActiveClock, resumeActiveClock } = await loadActiveTime();
  const paused = pauseActiveClock(pauseActiveClock({ baseMs: 250, segmentStartedAt: 100 }, 350), 900);
  const resumed = resumeActiveClock(resumeActiveClock(paused, 1_000), 2_000);

  assert.equal(activeElapsedMs(paused, 9_000), 500);
  assert.equal(activeElapsedMs(resumed, 1_500), 1_000);
});
