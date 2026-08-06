import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('behavior events: schema and migration define the UserEvent table', async () => {
  const schema = await source('prisma/schema.prisma');
  assert.match(schema, /model UserEvent \{/, 'UserEvent model should exist');
  assert.match(schema, /userEvents\s+UserEvent\[\]/, 'User should relate to user events');
  assert.match(schema, /@@index\(\[userId, type, createdAt\]\)/, 'events should be queryable by user/type/time');

  const migration = await source('prisma/migrations/20260806130000_user_events/migration.sql');
  assert.match(migration, /CREATE TABLE "UserEvent"/, 'migration should create the table');
  assert.match(migration, /ON DELETE CASCADE/, 'events should cascade with the user');
});

test('behavior events: repository, module and endpoint are wired', async () => {
  const repository = await source('apps/api/src/study/user-event.repository.ts');
  assert.match(repository, /async record\(userId: string, type: string, payload\?: Record<string, unknown>\)/, 'repository should expose record');
  assert.match(repository, /prisma\.userEvent\.create/, 'repository should persist through Prisma');

  const moduleSource = await source('apps/api/src/study/study.module.ts');
  assert.match(moduleSource, /UserEventRepository/, 'module should register the repository');

  const controller = await source('apps/api/src/study/study.controller.ts');
  assert.match(controller, /@Post\('events'\)/, 'events endpoint should exist');
});

test('behavior events: core learning-loop actions record events best-effort', async () => {
  const service = await source('apps/api/src/study/study.service.ts');
  assert.match(service, /private async trackUserEvent\(userId: string, type: string, payload\?: Record<string, unknown>\)/, 'service should expose a best-effort tracker');
  assert.match(service, /'practice\.submit'/, 'practice submissions should be tracked');
  assert.match(service, /'session\.submit'/, 'session submissions should be tracked');
  assert.match(service, /'task\.complete'/, 'task completions should be tracked');
  assert.match(service, /'wrong\.review'/, 'wrong-question reviews should be tracked');
  assert.match(service, /'assessment\.import'/, 'history imports should be tracked');
  assert.match(service, /async recordUserEvent\(userId: string, type: string, payload\?: Record<string, unknown>\)/, 'service should expose the public event endpoint method');
});
