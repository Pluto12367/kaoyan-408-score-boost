import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../apps/api/src/study/study.controller.ts', import.meta.url), 'utf8');
test('action controller exposes command-specific lifecycle routes', () => {
  for (const route of ['recommendation-actions', 'recommendation-actions/:id/start', 'recommendation-actions/:id/complete', 'recommendation-actions/:id/cancel']) assert.match(source, new RegExp(`@Post\\('${route.replace(/[/:]/g, '\\$&')}'`));
  assert.doesNotMatch(source, /@Put\(['"]recommendation-actions/);
});
