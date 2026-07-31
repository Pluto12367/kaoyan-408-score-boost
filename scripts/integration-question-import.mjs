import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const baseDatabaseUrl = process.env.TEST_DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:55432/kaoyan408_test?schema=public';
const schemaName = `question_import_migration_${randomBytes(6).toString('hex')}`;
const databaseUrl = withSchema(baseDatabaseUrl, schemaName);

let admin;
let prisma;

async function main() {
  admin = new PrismaClient({ datasourceUrl: withSchema(baseDatabaseUrl, 'public') });
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
  prisma = new PrismaClient({ datasourceUrl: databaseUrl });

  await createLegacyFixture(prisma);
  await applyQuestionImportMigration(prisma);
  await assertLegacyQuestionMigration(prisma);
  await assertAssetLifecycleConstraint(prisma);
  await assertVersionedWriteBehavior();

  console.log('question-import migration integration assertions passed');
}

async function createLegacyFixture(client) {
  const statements = [
    'CREATE TYPE "Difficulty" AS ENUM (\'BASIC\', \'MEDIUM\', \'HARD\')',
    'CREATE TYPE "QuestionType" AS ENUM (\'SINGLE_CHOICE\', \'COMPREHENSIVE\', \'JUDGEMENT\')',
    'CREATE TABLE "User" ("id" TEXT PRIMARY KEY)',
    'CREATE TABLE "KnowledgePoint" ("id" TEXT PRIMARY KEY)',
    `CREATE TABLE "Question" (
      "id" TEXT PRIMARY KEY,
      "stem" TEXT NOT NULL,
      "options" TEXT[] NOT NULL,
      "answer" TEXT NOT NULL,
      "analysis" TEXT NOT NULL,
      "difficulty" "Difficulty" NOT NULL,
      "type" "QuestionType" NOT NULL,
      "source" TEXT NOT NULL,
      "year" INTEGER,
      "expectedTimeSec" INTEGER NOT NULL DEFAULT 100,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    'CREATE TABLE "QuestionKnowledgePoint" ("questionId" TEXT NOT NULL REFERENCES "Question"("id"), "knowledgePointId" TEXT NOT NULL REFERENCES "KnowledgePoint"("id"), PRIMARY KEY ("questionId", "knowledgePointId"))',
    'CREATE TABLE "PracticeRecord" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id"), "questionId" TEXT NOT NULL REFERENCES "Question"("id"), "knowledgePointId" TEXT NOT NULL REFERENCES "KnowledgePoint"("id"))',
    'CREATE TABLE "WrongQuestionReview" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id"), "questionId" TEXT NOT NULL REFERENCES "Question"("id"))',
    'CREATE TABLE "ReviewSchedule" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id"), "questionId" TEXT NOT NULL REFERENCES "Question"("id"))',
    "INSERT INTO \"User\" (\"id\") VALUES ('legacy-user')",
    "INSERT INTO \"KnowledgePoint\" (\"id\") VALUES ('legacy-point')",
    `INSERT INTO "Question" ("id", "stem", "options", "answer", "analysis", "difficulty", "type", "source")
      VALUES ('legacy-question', 'legacy stem', ARRAY['A', 'B'], 'A', 'legacy analysis', 'MEDIUM', 'SINGLE_CHOICE', 'legacy source')`,
    "INSERT INTO \"QuestionKnowledgePoint\" VALUES ('legacy-question', 'legacy-point')",
    "INSERT INTO \"PracticeRecord\" VALUES ('legacy-record', 'legacy-user', 'legacy-question', 'legacy-point')",
    "INSERT INTO \"WrongQuestionReview\" VALUES ('legacy-wrong', 'legacy-user', 'legacy-question')",
    "INSERT INTO \"ReviewSchedule\" VALUES ('legacy-schedule', 'legacy-user', 'legacy-question')",
  ];
  for (const statement of statements) await client.$executeRawUnsafe(statement);
}

async function applyQuestionImportMigration(client) {
  const migration = await readFile(join(root, 'prisma/migrations/20260731120000_question_document_import/migration.sql'), 'utf8');
  for (const statement of migration.split(/;\s*(?:\r?\n|$)/)) {
    if (statement.trim()) await client.$executeRawUnsafe(statement);
  }
}

async function assertLegacyQuestionMigration(client) {
  const [question] = await client.$queryRawUnsafe('SELECT "id", "familyId", "versionNumber", "isCurrent", "contentFingerprint" FROM "Question" WHERE "id" = \'legacy-question\'');
  assert.equal(question.id, 'legacy-question');
  assert.equal(question.familyId, 'legacy-legacy-question');
  assert.equal(question.versionNumber, 1);
  assert.equal(question.isCurrent, true);
  assert.match(question.contentFingerprint, /^[a-f0-9]{32}$/);

  for (const [table, id] of [
    ['PracticeRecord', 'legacy-record'],
    ['WrongQuestionReview', 'legacy-wrong'],
    ['ReviewSchedule', 'legacy-schedule'],
  ]) {
    const [row] = await client.$queryRawUnsafe(`SELECT "questionId" FROM "${table}" WHERE "id" = '${id}'`);
    assert.equal(row.questionId, 'legacy-question', `${table} must keep the historic question ID`);
  }
  const [relation] = await client.$queryRawUnsafe('SELECT "questionId", "knowledgePointId" FROM "QuestionKnowledgePoint" WHERE "questionId" = \'legacy-question\'');
  assert.deepEqual(relation, { questionId: 'legacy-question', knowledgePointId: 'legacy-point' });
}

async function assertAssetLifecycleConstraint(client) {
  await client.$executeRawUnsafe(`INSERT INTO "QuestionImportBatch" (
    "id", "uploadedById", "originalFileName", "originalStorageKey", "fileSha256", "fileType", "source", "rightsConfirmed", "expiresAt", "updatedAt"
  ) VALUES ('asset-batch', 'admin', 'preview.pdf', 'incoming/preview.pdf', 'batch-sha', 'pdf', 'source', true, CURRENT_TIMESTAMP + INTERVAL '30 days', CURRENT_TIMESTAMP)`);

  await client.$executeRawUnsafe(`INSERT INTO "QuestionImportAsset" (
    "id", "batchId", "scope", "storageKey", "sha256", "mediaType", "byteSize", "expiresAt"
  ) VALUES ('temporary-preview', 'asset-batch', 'temporary', 'temporary/page-1.png', 'preview-sha', 'image/png', 1, CURRENT_TIMESTAMP + INTERVAL '30 days')`);

  await client.$executeRawUnsafe(`INSERT INTO "QuestionImportCandidate" (
    "id", "batchId", "stem", "options", "answer", "analysis", "difficulty", "type", "source", "knowledgePointIds", "contentFingerprint", "updatedAt"
  ) VALUES ('asset-candidate', 'asset-batch', 'candidate stem', ARRAY['A', 'B'], 'A', 'candidate analysis', 'MEDIUM', 'SINGLE_CHOICE', 'source', ARRAY['legacy-point'], 'candidate-fingerprint', CURRENT_TIMESTAMP)`);

  await assertRejects(
    () => client.$executeRawUnsafe(`INSERT INTO "QuestionImportAsset" (
      "id", "batchId", "scope", "storageKey", "sha256", "mediaType", "byteSize"
    ) VALUES ('invalid-permanent', 'asset-batch', 'permanent', 'permanent/unowned.png', 'invalid-sha', 'image/png', 1)`),
    'permanent assets without a formal Question owner must be rejected',
  );
  await assertRejects(
    () => client.$executeRawUnsafe(`INSERT INTO "QuestionImportAsset" (
      "id", "batchId", "scope", "storageKey", "sha256", "mediaType", "byteSize", "candidateId"
    ) VALUES ('invalid-permanent-candidate', 'asset-batch', 'permanent', 'permanent/candidate.png', 'invalid-sha-2', 'image/png', 1, 'asset-candidate')`),
    'permanent assets may not use candidate ownership',
  );
  await assertRejects(
    () => client.$executeRawUnsafe(`INSERT INTO "QuestionImportAsset" (
      "id", "batchId", "scope", "storageKey", "sha256", "mediaType", "byteSize", "questionId"
    ) VALUES ('invalid-temporary-question', 'asset-batch', 'temporary', 'temporary/question.png', 'invalid-sha-3', 'image/png', 1, 'legacy-question')`),
    'temporary assets may not point to a formal Question before promotion',
  );
  await client.$executeRawUnsafe(`INSERT INTO "QuestionImportAsset" (
    "id", "batchId", "scope", "storageKey", "sha256", "mediaType", "byteSize", "questionId", "promotedAt"
  ) VALUES ('permanent-question', 'asset-batch', 'permanent', 'permanent/question.png', 'question-sha', 'image/png', 1, 'legacy-question', CURRENT_TIMESTAMP)`);
}

async function assertRejects(operation, message) {
  try {
    await operation();
  } catch {
    return;
  }
  assert.fail(message);
}

async function assertVersionedWriteBehavior() {
  const behaviorSchema = `question_import_behavior_${randomBytes(6).toString('hex')}`;
  const behaviorDatabaseUrl = withSchema(baseDatabaseUrl, behaviorSchema);
  let behaviorPrisma;
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${behaviorSchema}"`);
    deployCurrentMigrations(behaviorDatabaseUrl);
    behaviorPrisma = new PrismaClient({ datasourceUrl: behaviorDatabaseUrl });
    process.env.DATABASE_URL = behaviorDatabaseUrl;

    const { QuestionsService } = require(join(root, 'apps/api/dist/questions/questions.service.js'));
    const { PracticeRecordRepository } = require(join(root, 'apps/api/dist/study/practice-record.repository.js'));
    await behaviorPrisma.knowledgePoint.createMany({
      data: [
        knowledgePoint('co-cache', 'Cache'),
        knowledgePoint('ds-tree', 'Tree'),
      ],
    });

    const questions = new QuestionsService(behaviorPrisma);
    await questions.onModuleInit();
    const created = await questions.createQuestion(questionInput('version one', ['co-cache']));
    const edited = await questions.updateQuestion(created.id, { stem: 'version two', knowledgePointIds: ['ds-tree'] });
    assert.notEqual(edited.id, created.id, 'edits must create a distinct Question.id');

    const teacherVersions = await behaviorPrisma.question.findMany({
      where: { familyId: (await behaviorPrisma.question.findUniqueOrThrow({ where: { id: created.id } })).familyId },
      include: { knowledgePoints: true },
      orderBy: { versionNumber: 'asc' },
    });
    assert.equal(teacherVersions.length, 2);
    assert.equal(teacherVersions[0].stem, 'version one');
    assert.equal(teacherVersions[0].isCurrent, false);
    assert.deepEqual(teacherVersions[0].knowledgePoints.map((item) => item.knowledgePointId), ['co-cache']);
    assert.equal(teacherVersions[1].stem, 'version two');
    assert.equal(teacherVersions[1].versionNumber, 2);
    assert.equal(teacherVersions[1].isCurrent, true);
    assert.deepEqual(teacherVersions[1].knowledgePoints.map((item) => item.knowledgePointId), ['ds-tree']);
    assert.equal(teacherVersions.filter((item) => item.isCurrent).length, 1, 'a family must have one current version');

    const repository = new PracticeRecordRepository(behaviorPrisma);
    const seedQuestion = questionInput('seed version one', ['co-cache'], 'seed-question');
    const seedUser = { id: 'seed-user', name: 'Seed user', role: 'student' };
    await repository.initialize({ user: seedUser, knowledgePoints: [], questions: [seedQuestion], seedRecords: [] });
    await behaviorPrisma.practiceRecord.create({
      data: { id: 'seed-record', userId: seedUser.id, questionId: seedQuestion.id, knowledgePointId: 'co-cache', correct: false, timeSpentSec: 30, expectedTimeSec: 90 },
    });
    await behaviorPrisma.wrongQuestionReview.create({ data: { id: 'seed-wrong', userId: seedUser.id, questionId: seedQuestion.id } });
    await behaviorPrisma.reviewSchedule.create({ data: { id: 'seed-schedule', userId: seedUser.id, questionId: seedQuestion.id, nextReviewAt: new Date() } });
    await repository.initialize({
      user: seedUser,
      knowledgePoints: [],
      questions: [questionInput('seed version two', ['ds-tree'], 'seed-question')],
      seedRecords: [],
    });

    const preservedSeed = await behaviorPrisma.question.findUniqueOrThrow({
      where: { id: seedQuestion.id },
      include: { knowledgePoints: true },
    });
    assert.equal(preservedSeed.stem, 'seed version one', 'seed initialization must not overwrite a historical Question row');
    assert.deepEqual(preservedSeed.knowledgePoints.map((item) => item.knowledgePointId), ['co-cache']);
    assert.equal(await behaviorPrisma.practiceRecord.count({ where: { questionId: seedQuestion.id } }), 1);
    assert.equal(await behaviorPrisma.wrongQuestionReview.count({ where: { questionId: seedQuestion.id } }), 1);
    assert.equal(await behaviorPrisma.reviewSchedule.count({ where: { questionId: seedQuestion.id } }), 1);

    await assertCliVersions(behaviorPrisma, behaviorDatabaseUrl);
  } finally {
    await behaviorPrisma?.$disconnect();
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${behaviorSchema}" CASCADE`);
  }
}

async function assertCliVersions(client, databaseUrl) {
  const directory = await mkdtemp(join(tmpdir(), 'question-import-cli-'));
  const csv = join(directory, 'questions.csv');
  try {
    await writeFile(csv, [
      'stem,options,answer,analysis,knowledgePointIds,difficulty,type,source,year,expectedTimeSec',
      'cli version,A|B,A,cli analysis one,co-cache,中等,选择题,cli source,2026,90',
    ].join('\n'), 'utf8');
    runQuestionImportCli(csv, databaseUrl);
    await writeFile(csv, [
      'stem,options,answer,analysis,knowledgePointIds,difficulty,type,source,year,expectedTimeSec',
      'cli version,A|B,A,cli analysis two,ds-tree,中等,选择题,cli source,2026,90',
    ].join('\n'), 'utf8');
    runQuestionImportCli(csv, databaseUrl, '--replace');

    const current = await client.question.findFirstOrThrow({ where: { stem: 'cli version', isCurrent: true } });
    const versions = await client.question.findMany({
      where: { familyId: current.familyId },
      include: { knowledgePoints: true },
      orderBy: { versionNumber: 'asc' },
    });
    assert.equal(versions.length, 2, 'CLI replacement must create a second version');
    assert.equal(versions[0].analysis, 'cli analysis one');
    assert.equal(versions[0].isCurrent, false);
    assert.deepEqual(versions[0].knowledgePoints.map((item) => item.knowledgePointId), ['co-cache']);
    assert.equal(versions[1].analysis, 'cli analysis two');
    assert.equal(versions[1].isCurrent, true);
    assert.deepEqual(versions[1].knowledgePoints.map((item) => item.knowledgePointId), ['ds-tree']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function runQuestionImportCli(csv, databaseUrl, ...args) {
  const result = spawnSync(process.execPath, ['scripts/import-questions.mjs', csv, ...args], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) throw new Error(`question import CLI failed: ${result.error?.message || result.stderr || result.stdout}`);
}

function deployCurrentMigrations(databaseUrl) {
  const prismaCli = require.resolve('prisma/build/index.js');
  const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) throw new Error(`current migration deploy failed: ${result.error?.message || result.stderr || result.stdout}`);
}

function knowledgePoint(id, title) {
  return {
    id,
    subject: id.startsWith('co-') ? 'COMPUTER_ORGANIZATION' : 'DATA_STRUCTURE',
    chapter: 'integration',
    title,
    importance: 1,
    frequency: 1,
    prerequisites: [],
  };
}

function questionInput(stem, knowledgePointIds, id) {
  return {
    ...(id ? { id } : {}),
    stem,
    options: ['A', 'B'],
    answer: 'A',
    analysis: `${stem} analysis`,
    knowledgePointIds,
    difficulty: '中等',
    type: '选择题',
    source: 'integration source',
    expectedTimeSec: 90,
  };
}

function withSchema(url, schema) {
  const parsed = new URL(url);
  parsed.searchParams.set('schema', schema);
  return parsed.toString();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma?.$disconnect();
    if (admin) {
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await admin.$disconnect();
    }
  });
