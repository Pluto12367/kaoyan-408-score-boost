import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

function loadContract() {
  try {
    return require('../apps/api/src/study/student-context.contract.ts');
  } catch (_error) {
    return null;
  }
}

test('StudentContext contract exposes the required top-level sections', () => {
  const contract = loadContract();
  assert.ok(contract, 'StudentContext contract module must exist');
  assert.equal(typeof contract.STUDENT_CONTEXT_VERSION, 'string');
  assert.equal(typeof contract.createInsufficientTrend, 'function');
  assert.equal(typeof contract.createSufficientTrend, 'function');
});

test('trend helpers always expose window, baseline, sampleSize, status, and value', () => {
  const contract = loadContract();
  assert.ok(contract, 'StudentContext contract module must exist');

  const insufficient = contract.createInsufficientTrend('last7d');
  assert.deepEqual(insufficient, {
    window: 'last7d',
    baseline: null,
    sampleSize: 0,
    status: 'insufficient_data',
    value: null,
  });

  const sufficient = contract.createSufficientTrend('last30d', 0.8, 0.6, 12);
  assert.deepEqual(sufficient, {
    window: 'last30d',
    baseline: 0.6,
    sampleSize: 12,
    status: 'sufficient',
    value: 0.8,
  });
});

test('contract types document separate node, point, action, and task identities', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../apps/api/src/study/student-context.contract.ts', import.meta.url), 'utf8').catch(() => '');
  assert.match(source, /knowledgeNodeId/);
  assert.match(source, /knowledgePointId/);
  assert.match(source, /actionId/);
  assert.match(source, /studyTaskId/);
  assert.doesNotMatch(source, /\bid\??:\s*string.*knowledgeNodeId/);
});
