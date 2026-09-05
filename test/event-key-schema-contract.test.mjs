import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (relativePath) => readFile(new URL(relativePath, root), 'utf8');

function modelBody(schema, name) {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `${name} model should exist`);
  return match[1];
}

test('UserEvent exposes a nullable eventKey with a user-scoped compound unique constraint', async () => {
  const schema = await read('prisma/schema.prisma');
  const body = modelBody(schema, 'UserEvent');

  assert.match(body, /eventKey\s+String\?/);
  assert.match(body, /@@unique\(\[userId, eventKey\]\)/);
  assert.match(body, /@@index\(\[userId, type, createdAt\]\)/);
});

test('EventKey migration adds only a nullable column and the user-scoped unique index', async () => {
  const migration = await read('prisma/migrations/20260902160000_user_event_event_key/migration.sql');

  assert.match(migration, /ALTER TABLE "UserEvent" ADD COLUMN "eventKey" TEXT;/);
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "UserEvent_userId_eventKey_key"\s+ON "UserEvent"\("userId", "eventKey"\);/,
  );
  assert.doesNotMatch(migration, /UPDATE\s+"UserEvent"/i, 'historical events must not be backfilled');
  assert.doesNotMatch(migration, /DROP TABLE\s+"UserEvent"/i, 'migration must be additive');
});

test('EventKey migration preserves the existing UserEvent table and query index', async () => {
  const migration = await read('prisma/migrations/20260902160000_user_event_event_key/migration.sql');
  const previousMigration = await read('prisma/migrations/20260806130000_user_events/migration.sql');

  assert.match(previousMigration, /CREATE TABLE "UserEvent"/);
  assert.match(previousMigration, /UserEvent_userId_type_createdAt_idx/);
  assert.match(migration, /ADD COLUMN "eventKey" TEXT/);
  assert.match(migration, /UserEvent_userId_eventKey_key/);
});
