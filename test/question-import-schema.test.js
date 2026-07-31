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
});

test('persisted question writes create current immutable versions', async () => {
  const service = await readFile('apps/api/src/questions/questions.service.ts', 'utf8');
  const script = await readFile('scripts/import-questions.mjs', 'utf8');
  const practiceRecords = await readFile('apps/api/src/study/practice-record.repository.ts', 'utf8');

  assert.match(service, /async refreshFromDatabase\(\)/);
  assert.match(service, /where:\s*\{\s*isCurrent:\s*true\s*\}/);
  assert.match(service, /family:\s*\{\s*create:\s*\{\s*\}\s*\}/);
  assert.match(service, /contentFingerprint:\s*computeContentFingerprint/);
  assert.match(service, /isCurrent:\s*false/);
  assert.match(service, /versionNumber:\s*persisted\.versionNumber \+ 1/);
  assert.match(script, /family:\s*\{\s*create:\s*\{\s*\}\s*\}/);
  assert.match(script, /contentFingerprint:\s*computeContentFingerprint/);
  assert.match(practiceRecords, /family:\s*\{\s*create:\s*\{\s*\}\s*\}/);
  assert.match(practiceRecords, /contentFingerprint:\s*computeContentFingerprint/);
});
