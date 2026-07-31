import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('browser shared barrel does not re-export a Node builtin dependency', async () => {
  const [barrel, fingerprintPayload] = await Promise.all([
    readFile('packages/shared/src/index.ts', 'utf8'),
    readFile('packages/shared/src/questionImport.ts', 'utf8'),
  ]);

  assert.doesNotMatch(barrel, /questionImport\.server/);
  assert.doesNotMatch(fingerprintPayload, /from\s+['"]node:/);
});
