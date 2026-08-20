import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function load(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('today plan keeps a single next-step entry point', async () => {
  const source = await load('apps/web/src/components/TodayPlan.tsx');
  assert.match(source, /<NextLearningStepCard step={nextLearningStep} onNavigate={onNavigate} compact \/>/);
  assert.doesNotMatch(source, /today-plan-next-step-banner/);
  assert.doesNotMatch(source, /today-plan-next-step-banner-actions/);
});
