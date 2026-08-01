import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('schema keeps immutable question versions and resumable import state', async () => {
  const schema = await readFile('prisma/schema.prisma', 'utf8');

  assert.match(schema, /model QuestionFamily\s*\{/);
  assert.match(schema, /familyId\s+String/);
  assert.match(schema, /versionNumber\s+Int\s+@default\(1\)/);
  assert.match(schema, /isCurrent\s+Boolean\s+@default\(true\)/);
  assert.match(schema, /model QuestionImportBatch\s*\{/);
  assert.match(schema, /model QuestionImportJob\s*\{/);
  assert.match(schema, /model QuestionImportCandidate\s*\{/);
  assert.match(schema, /model QuestionImportAsset\s*\{/);
  assert.match(schema, /model QuestionImportConfirmation\s*\{/);
  assert.match(schema, /enum QuestionImportJobState\s*\{\s*pending\s/);
  assert.match(schema, /title\s+String\?/);
  assert.match(schema, /year\s+Int\?/);
  assert.match(schema, /defaultSubject\s+String\?/);
  assert.match(schema, /defaultChapter\s+String\?/);
  assert.match(schema, /pageRange\s+String\?/);
});
