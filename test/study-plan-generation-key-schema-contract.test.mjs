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

test('StudyPlan exposes a nullable generationKey with user-scoped uniqueness', async () => {
  const schema = await read('prisma/schema.prisma');
  const body = modelBody(schema, 'StudyPlan');

  assert.match(body, /generationKey\s+String\?/);
  assert.match(body, /@@unique\(\[userId, generationKey\]\)/);
});

test('StudyPlan generation migration is additive and does not backfill legacy rows', async () => {
  const migration = await read('prisma/migrations/20260902170000_study_plan_generation_key/migration.sql');

  assert.match(migration, /ALTER TABLE "StudyPlan" ADD COLUMN "generationKey" TEXT;/);
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "StudyPlan_userId_generationKey_key"\s+ON "StudyPlan"\("userId", "generationKey"\);/,
  );
  assert.doesNotMatch(migration, /UPDATE\s+"StudyPlan"/i, 'legacy plans must not be backfilled');
  assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN|INDEX)\s+"?StudyPlan/i, 'migration must be additive');
});

test('StudyPlan generation migration preserves existing plan columns and has no runtime changes', async () => {
  const migration = await read('prisma/migrations/20260902170000_study_plan_generation_key/migration.sql');
  const schema = await read('prisma/schema.prisma');
  const body = modelBody(schema, 'StudyPlan');

  for (const field of ['id', 'userId', 'source', 'modelVersion', 'status', 'tasks']) {
    assert.match(body, new RegExp(`^\\s*${field}\\s+`, 'm'), `${field} must remain in StudyPlan`);
  }
  assert.doesNotMatch(migration, /RecommendationAction|LearningLoop|UserKnowledgeMastery/i);
});
