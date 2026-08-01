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

test('keeps the original import migration immutable and upgrades it in a follow-on migration', async () => {
  const initial = await readFile('prisma/migrations/20260731120000_question_document_import/migration.sql', 'utf8');
  const followOn = await readFile('prisma/migrations/20260801090000_harden_question_import_batches/migration.sql', 'utf8');

  assert.match(initial, /QuestionImportJobState" AS ENUM \('queued'/);
  assert.doesNotMatch(initial, /"title" TEXT/);
  assert.match(followOn, /QuestionImportJobState_new" AS ENUM \('pending'/);
  assert.match(followOn, /QuestionImportBatch_uploadedById_fkey/);
  assert.match(followOn, /ADD COLUMN "title"/);
});

test('worker leases and source rows have database-backed restart guarantees', async () => {
  const schema = await readFile('prisma/schema.prisma', 'utf8');
  const workerMigration = await readFile('prisma/migrations/20260801120000_question_import_worker/migration.sql', 'utf8');

  assert.match(schema, /leaseOwner\s+String\?/);
  assert.match(schema, /leaseExpiresAt\s+DateTime\?/);
  assert.match(schema, /sourceRowNumber\s+Int\?/);
  assert.match(schema, /@@unique\(\[jobId, sourceRowNumber\]\)/);
  assert.match(workerMigration, /leaseOwner/);
  assert.match(workerMigration, /leaseExpiresAt/);
  assert.match(workerMigration, /sourceRowNumber/);
  assert.match(workerMigration, /UNIQUE/);
});
