import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const ExcelJS = require('exceljs');
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
  await applyHardeningMigration(prisma);
  await assertUpgradeMigration(prisma);
  await applyWorkerMigration(prisma);
  await assertWorkerMigration(prisma);
  await applyAssetHistoryMigration(prisma);
  await assertAssetHistoryMigration(prisma);
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
    "INSERT INTO \"User\" (\"id\") VALUES ('admin')",
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
  await applyMigration(client, '20260731120000_question_document_import');
}

async function applyHardeningMigration(client) {
  await applyMigration(client, '20260801090000_harden_question_import_batches');
}

async function applyWorkerMigration(client) {
  await applyMigration(client, '20260801120000_question_import_worker');
}

async function applyAssetHistoryMigration(client) {
  await applyMigration(client, '20260801110000_question_import_asset_history');
}

async function applyMigration(client, name) {
  const migration = await readFile(join(root, `prisma/migrations/${name}/migration.sql`), 'utf8');
  for (const statement of migration.split(/;\s*(?:\r?\n|$)/)) {
    if (statement.trim()) await client.$executeRawUnsafe(statement);
  }
}

async function assertUpgradeMigration(client) {
  await client.$executeRawUnsafe(`INSERT INTO "QuestionImportBatch" (
    "id", "uploadedById", "originalFileName", "originalStorageKey", "fileSha256", "fileType", "source", "rightsConfirmed", "expiresAt", "updatedAt", "title", "year", "defaultSubject", "defaultChapter", "pageRange"
  ) VALUES ('upgrade-batch', 'admin', 'upgrade.csv', 'incoming/upgrade.csv', 'upgrade-sha', 'csv', 'upgrade source', true, CURRENT_TIMESTAMP + INTERVAL '30 days', CURRENT_TIMESTAMP, 'upgrade title', 2026, 'COMPUTER_ORGANIZATION', 'cache', '1-2')`);
  await client.$executeRawUnsafe(`INSERT INTO "QuestionImportJob" (
    "id", "batchId", "pageStart", "pageEnd", "provider", "updatedAt"
  ) VALUES ('upgrade-job', 'upgrade-batch', 1, 1, 'table-parser', CURRENT_TIMESTAMP)`);
  const [job] = await client.$queryRawUnsafe('SELECT "state" FROM "QuestionImportJob" WHERE "id" = \'upgrade-job\'');
  assert.equal(job.state, 'pending', 'upgraded jobs must default to pending');

  await assertRejects(
    () => client.$executeRawUnsafe(`INSERT INTO "QuestionImportBatch" (
      "id", "uploadedById", "originalFileName", "originalStorageKey", "fileSha256", "fileType", "source", "rightsConfirmed", "expiresAt", "updatedAt"
    ) VALUES ('unknown-uploader', 'missing-user', 'unknown.csv', 'incoming/unknown.csv', 'unknown-sha', 'csv', 'source', true, CURRENT_TIMESTAMP + INTERVAL '30 days', CURRENT_TIMESTAMP)`),
    'the follow-on uploader foreign key must reject unknown uploaders',
  );
}

async function assertWorkerMigration(client) {
  const [jobColumn, rowColumn] = await Promise.all([
    client.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'QuestionImportJob' AND column_name = 'leaseExpiresAt'`),
    client.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'QuestionImportCandidate' AND column_name = 'sourceRowNumber'`),
  ]);
  assert.equal(jobColumn.length, 1, 'worker migration must add lease expiry');
  assert.equal(rowColumn.length, 1, 'worker migration must add source row identity');
}

async function assertAssetHistoryMigration(client) {
  const columns = await client.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'Question' AND column_name IN ('formulas', 'sourceRegion')`);
  assert.deepEqual(columns.map((column) => column.column_name).sort(), ['formulas', 'sourceRegion']);
  const [legacy] = await client.$queryRawUnsafe(`SELECT "formulas", "sourceRegion" FROM "Question" WHERE "id" = 'legacy-question'`);
  assert.deepEqual(legacy.formulas, []);
  assert.equal(legacy.sourceRegion, null);
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
    const { AuditEventService } = require(join(root, 'apps/api/dist/operations/audit-event.service.js'));
    const { ImportBatchService } = require(join(root, 'apps/api/dist/questions/import/import-batch.service.js'));
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
    await assertImportBatchTransactions(behaviorPrisma, AuditEventService, ImportBatchService);
    await assertWorkerLeaseAndCandidates(behaviorPrisma, {
      AuditEventService,
      ImportBatchService,
      ImportCandidateService: require(join(root, 'apps/api/dist/questions/import/import-candidate.service.js')).ImportCandidateService,
      ImportAssetService: require(join(root, 'apps/api/dist/questions/import/import-asset.service.js')).ImportAssetService,
      ImportStorageService: require(join(root, 'apps/api/dist/questions/import/import-storage.service.js')).ImportStorageService,
      ImportValidationService: require(join(root, 'apps/api/dist/questions/import/import-validation.js')).ImportValidationService,
      ImportWorkerService: require(join(root, 'apps/api/dist/questions/import/import-worker.service.js')).ImportWorkerService,
      TableImportParser: require(join(root, 'apps/api/dist/questions/import/table-import.parser.js')).TableImportParser,
    });
  } finally {
    await behaviorPrisma?.$disconnect();
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${behaviorSchema}" CASCADE`);
  }
}

async function assertWorkerLeaseAndCandidates(client, services) {
  const directory = await mkdtemp(join(tmpdir(), 'question-import-worker-'));
  const incomingDirectory = join(directory, 'incoming');
  const temporaryDirectory = join(directory, 'temporary');
  const permanentDirectory = join(directory, 'permanent');
  await Promise.all([incomingDirectory, temporaryDirectory, permanentDirectory].map((path) => mkdir(path)));
  try {
    await client.user.create({ data: { id: 'worker-admin', name: 'Worker Admin', role: 'ADMIN' } });
    const csv = tableCsv();
    const incomingName = randomUUID();
    const incomingPath = join(incomingDirectory, incomingName);
    await writeFile(incomingPath, csv, 'utf8');
    const storage = new services.ImportStorageService({
      dataDirectory: directory,
      incomingDirectory,
      temporaryDirectory,
      permanentDirectory,
      maxPdfBytes: 500 * 1024 * 1024,
      maxTableBytes: 50 * 1024 * 1024,
      temporaryQuotaBytes: 10 * 1024 * 1024 * 1024,
      diskStopPercent: 80,
    });
    const stored = await storage.putIncoming({
      path: incomingPath,
      filename: incomingName,
      originalname: 'worker-restart.csv',
      size: Buffer.byteLength(csv),
    });
    const audits = new services.AuditEventService(client);
    const batches = new services.ImportBatchService(client, audits);
    const created = await batches.create('worker-admin', {
      source: 'integration source', rightsConfirmed: true, title: 'worker lease integration',
    }, stored);
    const tableJob = await client.questionImportJob.findFirstOrThrow({ where: { batchId: created.batchId } });
    const pdfBatch = await client.questionImportBatch.create({
      data: {
        uploadedById: 'worker-admin', originalFileName: 'later.pdf', originalStorageKey: 'temporary/later-pdf',
        fileSha256: 'later-pdf-sha', fileType: 'pdf', source: 'integration source', rightsConfirmed: true,
        rightsConfirmedAt: new Date(), status: 'queued', expiresAt: new Date(Date.now() + 86_400_000),
        jobs: { create: { pageStart: 1, pageEnd: 1, provider: 'document-parser', state: 'pending' } },
      },
      include: { jobs: true },
    });
    const parser = new services.TableImportParser();
    const validation = new services.ImportValidationService(client);
    const parsedFixture = await parser.parse(Buffer.from(csv, 'utf8'), 'worker-restart.csv');
    assert.deepEqual(
      parsedFixture.rows.map((row) => [row.values.科目, row.values.章节, row.values.知识点]),
      [
        ['数据结构', '树与二叉树', '树的遍历应用'],
        ['计算机组成原理', '存储系统', 'Cache 映射与替换'],
        ['计算机组成原理', '存储系统', 'Cache 映射与替换'],
      ],
      'CSV parser must preserve the knowledge-point lookup tuple',
    );
    const pointFixture = await client.knowledgePoint.findMany({
      where: { id: { in: ['ds-tree', 'co-cache'] } },
      select: { id: true, subject: true, chapter: true, title: true },
      orderBy: { id: 'asc' },
    });
    assert.deepEqual(pointFixture, [
      { id: 'co-cache', subject: 'COMPUTER_ORGANIZATION', chapter: '存储系统', title: 'Cache 映射与替换' },
      { id: 'ds-tree', subject: 'DATA_STRUCTURE', chapter: '树与二叉树', title: '树的遍历应用' },
    ]);
    const workerA = new services.ImportWorkerService(client, storage, parser, {
      workerId: 'pg-worker-a', leaseMs: 200, autoStart: false,
    }, validation);
    const workerB = new services.ImportWorkerService(client, storage, parser, {
      workerId: 'pg-worker-b', leaseMs: 200, autoStart: false,
    }, validation);

    const [claimA, claimB] = await Promise.all([workerA.claimNextJob(), workerB.claimNextJob()]);
    const claims = [claimA, claimB].filter(Boolean);
    assert.equal(claims.length, 1, 'two PostgreSQL workers must claim the table job only once');
    assert.equal(claims[0].id, tableJob.id);
    assert.equal(await client.questionImportJob.findUniqueOrThrow({ where: { id: pdfBatch.jobs[0].id } }).then((job) => job.state), 'pending', 'Task 4 worker must not claim PDF jobs');

    await new Promise((resolve) => setTimeout(resolve, 300));
    const restarted = new services.ImportWorkerService(client, storage, parser, {
      workerId: 'pg-worker-restarted', leaseMs: 5_000, autoStart: false,
    }, validation);
    const reclaimed = await restarted.claimNextJob();
    assert.equal(reclaimed?.id, tableJob.id, 'a fresh worker instance must reclaim an expired crash lease');
    assert.equal(reclaimed?.leaseOwner, 'pg-worker-restarted');
    const result = await restarted.processClaimedJob(reclaimed);
    const candidates = await client.questionImportCandidate.findMany({
      where: { batchId: created.batchId }, orderBy: { sourceRowNumber: 'asc' },
    });
    const safeDiagnostics = candidates.map((candidate) => ({
      row: candidate.sourceRowNumber,
      status: candidate.status,
      warningCodes: Array.isArray(candidate.warnings) ? candidate.warnings.map((warning) => warning.code) : [],
      warningFields: Array.isArray(candidate.warnings) ? candidate.warnings.map((warning) => warning.field) : [],
    }));
    assert.deepEqual(
      { valid: result.validCandidates, failed: result.failedCandidates },
      { valid: 2, failed: 1 },
      `unexpected candidate validation: ${JSON.stringify(safeDiagnostics)}`,
    );

    assert.equal(candidates.length, 3);
    assert.deepEqual(candidates.map((candidate) => candidate.sourceRowNumber), [2, 3, 4]);
    assert.deepEqual(candidates.map((candidate) => candidate.status).sort(), ['duplicate_suspected', 'needs_edit', 'pending_review']);
    await assertRejects(
      () => restarted.processClaimedJob(reclaimed),
      'a completed lease must not commit candidates again',
    );
    assert.equal(await client.questionImportCandidate.count({ where: { batchId: created.batchId } }), 3, 'retry/re-entry must keep candidates exactly once');

    const candidateService = new services.ImportCandidateService(client, audits);
    const page = await candidateService.list(created.batchId, {}, { page: 1, pageSize: 100 });
    assert.equal(page.total, 3);
    const reviewable = candidates.filter((candidate) => candidate.status !== 'needs_edit');
    await assertRejects(
      () => candidateService.bulkApprove(
        created.batchId,
        reviewable.map((candidate) => ({ id: candidate.id, revision: candidate.revision + 1 })),
        'worker-admin',
      ),
      'bulk approval must reject caller-stale candidate revisions',
    );
    const approved = await candidateService.bulkApprove(
      created.batchId,
      reviewable.map((candidate) => ({ id: candidate.id, revision: candidate.revision })),
      'worker-admin',
    );
    assert.equal(approved.approvedCandidates, 2);
    await assertRejects(
      () => candidateService.update(reviewable[0].id, 0, { status: 'ignored' }, 'worker-admin'),
      'a stale candidate revision must be rejected after bulk approval',
    );
    const invalid = candidates.find((candidate) => candidate.status === 'needs_edit');
    await candidateService.update(invalid.id, invalid.revision, { status: 'ignored' }, 'worker-admin');
    const audit = await client.auditEvent.findFirstOrThrow({
      where: { action: 'question_import.candidate_bulk_approve', targetId: created.batchId },
      orderBy: { createdAt: 'desc' },
    });
    assert.deepEqual(audit.metadata.candidateIds.sort(), reviewable.map((candidate) => candidate.id).sort());
    assert.equal(audit.metadata.warningCount, 0);
    assert.equal(JSON.stringify(audit.metadata).includes('version two'), false, 'audit metadata must not contain question text');

    const deadlockBatch = await batches.create('worker-admin', {
      source: 'integration source', rightsConfirmed: true, title: 'worker claim cancellation lock order',
    }, stored);
    await assertClaimCancelLockOrder(client, services, storage, parser, validation, audits, deadlockBatch.batchId);

    await assertConcurrentCandidateCounts(client, services.ImportCandidateService, audits);
    await assertXlsxUploadReviewConfirm(client, services, storage, parser, validation, audits, batches, incomingDirectory);

    const cancelRace = await batches.create('worker-admin', {
      source: 'integration source', rightsConfirmed: true, title: 'worker cancellation race',
    }, stored);
    const cancelWorker = new services.ImportWorkerService(client, storage, parser, {
      workerId: 'pg-worker-cancel', leaseMs: 5_000, autoStart: false,
    }, validation);
    const cancelClaim = await cancelWorker.claimNextJob();
    assert.equal(cancelClaim?.batchId, cancelRace.batchId);
    await batches.cancel('worker-admin', cancelRace.batchId);
    await assertRejects(
      () => cancelWorker.processClaimedJob(cancelClaim),
      'cancelled batch must fence a worker that finishes parsing later',
    );
    const cancelledRaceState = await client.questionImportBatch.findUniqueOrThrow({
      where: { id: cancelRace.batchId }, include: { jobs: true },
    });
    assert.equal(cancelledRaceState.status, 'cancelled');
    assert.equal(cancelledRaceState.jobs[0].state, 'cancelled');
    assert.equal(cancelledRaceState.jobs[0].leaseOwner, null);
    assert.equal(await client.questionImportCandidate.count({ where: { batchId: cancelRace.batchId } }), 0);

    await assertImportConfirmation(client, services, audits, storage);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function assertXlsxUploadReviewConfirm(client, services, storage, parser, validation, audits, batches, incomingDirectory) {
  const xlsx = await tableXlsx('xlsx complete import');
  const incomingName = randomUUID();
  const incomingPath = join(incomingDirectory, incomingName);
  await writeFile(incomingPath, xlsx);
  const stored = await storage.putIncoming({
    path: incomingPath,
    filename: incomingName,
    originalname: 'acceptance.xlsx',
    size: xlsx.length,
  });
  const created = await batches.create('worker-admin', {
    source: 'integration source', rightsConfirmed: true, title: 'xlsx acceptance import',
  }, stored);
  const worker = new services.ImportWorkerService(client, storage, parser, {
    workerId: 'pg-worker-xlsx-acceptance', leaseMs: 5_000, autoStart: false,
  }, validation);
  const claimed = await worker.claimNextJob();
  assert.equal(claimed?.batchId, created.batchId, 'XLSX acceptance batch must be claimed by the table worker');
  const result = await worker.processClaimedJob(claimed);
  if (JSON.stringify(result.statusCounts) !== JSON.stringify({ pending_review: 1 })) {
    const diagnostics = await client.questionImportCandidate.findMany({
      where: { batchId: created.batchId },
      select: { status: true, warnings: true, sourceRowNumber: true },
    });
    assert.deepEqual(result.statusCounts, { pending_review: 1 }, `unexpected XLSX diagnostics: ${JSON.stringify(diagnostics)}`);
  }

  const candidateService = new services.ImportCandidateService(client, audits);
  const page = await candidateService.list(created.batchId, {}, { page: 1, pageSize: 100 });
  assert.equal(page.total, 1, 'XLSX acceptance import must create one candidate');
  const [candidate] = page.items;
  const edited = await candidateService.update(candidate.id, candidate.revision, { duplicateAction: 'create' }, 'worker-admin');
  assert.equal(edited.duplicateAction, 'create', 'XLSX acceptance candidate must be explicitly marked for creation');
  const approved = await candidateService.bulkApprove(created.batchId, [{ id: edited.id, revision: edited.revision }], 'worker-admin');
  assert.equal(approved.approvedCandidates, 1);

  const { ImportConfirmationService } = require(join(root, 'apps/api/dist/questions/import/import-confirmation.service.js'));
  const { QuestionsService } = require(join(root, 'apps/api/dist/questions/questions.service.js'));
  const questions = new QuestionsService(client);
  await questions.onModuleInit();
  const confirmation = new ImportConfirmationService(client, audits, questions);
  const confirmed = await confirmation.confirm(created.batchId, {
    candidateIds: [edited.id],
    idempotencyKey: randomUUID(),
  }, 'worker-admin');
  assert.equal(confirmed.importedCandidateIds.length, 1, 'XLSX acceptance confirmation must import one candidate');
  const imported = await client.question.findUniqueOrThrow({ where: { id: confirmed.questionIds[0] } });
  assert.equal(imported.stem, 'xlsx complete import');
  const batch = await client.questionImportBatch.findUniqueOrThrow({ where: { id: created.batchId } });
  assert.equal(batch.status, 'completed');
}

async function assertConcurrentCandidateCounts(client, ImportCandidateService, audits) {
  const batch = await client.questionImportBatch.create({
    data: {
      uploadedById: 'worker-admin', originalFileName: 'concurrent-counts.csv',
      originalStorageKey: `temporary/${randomUUID()}`, fileSha256: randomBytes(32).toString('hex'),
      fileType: 'csv', source: 'integration source', rightsConfirmed: true,
      rightsConfirmedAt: new Date(), status: 'review', expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  const candidates = await Promise.all(['a', 'b'].map((suffix) => client.questionImportCandidate.create({
    data: {
      batchId: batch.id, stem: `concurrent ${suffix}`, options: ['A', 'B'], answer: 'A',
      analysis: `concurrent ${suffix} analysis`, difficulty: 'MEDIUM', type: 'SINGLE_CHOICE',
      source: 'integration source', expectedTimeSec: 90, knowledgePointIds: ['ds-tree'],
      formulas: [], warnings: [], contentFingerprint: randomBytes(32).toString('hex'), status: 'pending_review',
    },
  })));
  const candidateBarrier = twoPartyBarrier();
  const serviceA = new ImportCandidateService(withCandidateUpdateBarrier(client, candidateBarrier), audits);
  const serviceB = new ImportCandidateService(withCandidateUpdateBarrier(client, candidateBarrier), audits);

  await Promise.all([
    serviceA.update(candidates[0].id, candidates[0].revision, { status: 'ignored' }, 'worker-admin'),
    serviceB.update(candidates[1].id, candidates[1].revision, { status: 'ignored' }, 'worker-admin'),
  ]);

  const refreshed = await client.questionImportBatch.findUniqueOrThrow({ where: { id: batch.id } });
  assert.deepEqual(refreshed.statusCounts, { ignored: 2 }, 'concurrent candidate updates must not persist a stale status count snapshot');
}

async function assertImportConfirmation(client, services, audits, storage) {
  const { ImportConfirmationService } = require(join(root, 'apps/api/dist/questions/import/import-confirmation.service.js'));
  const { QuestionsService } = require(join(root, 'apps/api/dist/questions/questions.service.js'));
  const questions = new QuestionsService(client);
  await questions.onModuleInit();
  const batch = await client.questionImportBatch.create({
    data: {
      uploadedById: 'worker-admin', originalFileName: 'confirm.csv', originalStorageKey: `temporary/${randomUUID()}`,
      fileSha256: randomBytes(32).toString('hex'), fileType: 'csv', source: 'integration source', rightsConfirmed: true,
      rightsConfirmedAt: new Date(), status: 'review', expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  const oldQuestion = await questions.createQuestion(questionInput('confirmation old version', ['co-cache']));
  await client.practiceRecord.create({
    data: { userId: 'worker-admin', questionId: oldQuestion.id, knowledgePointId: 'co-cache', correct: false, timeSpentSec: 30, expectedTimeSec: 90 },
  });
  const oldAssetTemporary = await storage.putCandidateAsset(pngFixture('old-version'), 'image/png');
  const oldAssetSha = randomBytes(32).toString('hex');
  const oldAssetPermanentKey = await storage.copyToPermanent(oldAssetTemporary.storageKey, oldAssetSha, 'image/png');
  await client.questionImportAsset.create({
    data: {
      batchId: batch.id, scope: 'permanent', storageKey: oldAssetPermanentKey, sha256: oldAssetSha,
      mediaType: 'image/png', byteSize: pngFixture('old-version').length, questionId: oldQuestion.id, promotedAt: new Date(),
    },
  });
  const candidates = await Promise.all([
    ['new question', 'approved', 'skip', null],
    ['confirmation old version', 'approved', 'skip', (await client.question.findUniqueOrThrow({ where: { id: oldQuestion.id } })).familyId],
    ['similar independent question', 'approved', 'create', (await client.question.findUniqueOrThrow({ where: { id: oldQuestion.id } })).familyId],
    ['confirmation old version revised', 'approved', 'new_version', (await client.question.findUniqueOrThrow({ where: { id: oldQuestion.id } })).familyId],
  ].map(async ([stem, status, duplicateAction, targetFamilyId]) => client.questionImportCandidate.create({
    data: {
      batchId: batch.id, stem, options: ['A', 'B'], answer: 'A', analysis: `${stem} analysis`,
      difficulty: 'MEDIUM', type: 'SINGLE_CHOICE', source: 'integration source', expectedTimeSec: 90,
      knowledgePointIds: ['co-cache'],
      formulas: duplicateAction === 'new_version' ? [{ latex: 'T(n)=2T(n/2)+n', source: 'fixture' }] : [],
      sourceRegion: duplicateAction === 'new_version' ? { page: 2, x: 10, y: 20, width: 120, height: 80 } : undefined,
      warnings: [], contentFingerprint: randomBytes(32).toString('hex'),
      status, duplicateAction, targetFamilyId,
    },
  })));
  const assets = new services.ImportAssetService(client, storage);
  const versionCandidateDraft = candidates.find((candidate) => candidate.duplicateAction === 'new_version');
  const createdCandidateDraft = candidates.find((candidate) => candidate.duplicateAction === 'create');
  const sharedCandidateImage = pngFixture('shared-permanent-asset');
  const uploadedAsset = await assets.uploadCandidateAsset(versionCandidateDraft.id, {
    buffer: sharedCandidateImage,
    sourceRegion: JSON.stringify({ page: 2, x: 10, y: 20, width: 120, height: 80 }),
  });
  await assets.uploadCandidateAsset(createdCandidateDraft.id, { buffer: sharedCandidateImage });
  assert.equal(uploadedAsset.scope, 'temporary', 'candidate image upload must remain temporary before confirmation');
  const confirmation = new ImportConfirmationService(client, audits, questions, assets);
  const input = { candidateIds: candidates.map((candidate) => candidate.id), idempotencyKey: randomUUID() };
  const first = await confirmation.confirm(batch.id, input, 'worker-admin');
  const second = await confirmation.confirm(batch.id, input, 'worker-admin');
  assert.deepEqual(second, first, 'the same idempotency key must return the stored confirmation result');
  const [newCandidate, skippedCandidate, createdCandidate, versionCandidate] = await Promise.all(candidates.map((candidate) => client.questionImportCandidate.findUniqueOrThrow({ where: { id: candidate.id } })));
  assert.equal(skippedCandidate.importedQuestionId, null, 'duplicate candidates default to skip');
  assert.equal(newCandidate.importedQuestionId, null, 'skip must import a candidate without creating a question');
  assert.ok(createdCandidate.importedQuestionId, 'explicit create must create an independent question');
  const old = await client.question.findUniqueOrThrow({ where: { id: oldQuestion.id } });
  const updated = await client.question.findUniqueOrThrow({ where: { id: versionCandidate.importedQuestionId } });
  assert.equal(old.isCurrent, false);
  assert.equal(updated.familyId, old.familyId);
  assert.equal(updated.versionNumber, old.versionNumber + 1);
  assert.deepEqual(updated.formulas, [{ latex: 'T(n)=2T(n/2)+n', source: 'fixture' }], 'new imported versions must preserve formula metadata');
  assert.deepEqual(updated.sourceRegion, { page: 2, x: 10, y: 20, width: 120, height: 80 }, 'new imported versions must preserve original page crop metadata');
  const [oldAssets, createdAssets, promotedAssets] = await Promise.all([
    client.questionImportAsset.findMany({ where: { questionId: oldQuestion.id, scope: 'permanent' } }),
    client.questionImportAsset.findMany({ where: { questionId: createdCandidate.importedQuestionId, scope: 'permanent' } }),
    client.questionImportAsset.findMany({ where: { questionId: updated.id, scope: 'permanent' } }),
  ]);
  assert.equal(oldAssets.length, 1, 'historical question version must keep its existing asset ownership');
  assert.equal(createdAssets.length, 1, 'independent question must retain a permanent asset reference for duplicate-content crops');
  assert.equal(promotedAssets.length, 1, 'new current version must own the promoted candidate asset');
  assert.equal(createdAssets[0].storageKey, promotedAssets[0].storageKey, 'duplicate-content crops may share the permanent blob while retaining one asset row per question');
  assert.equal(promotedAssets[0].candidateId, null, 'promoted permanent assets must not retain candidate ownership');
  assert.match(promotedAssets[0].storageKey, /^permanent\//);
  assert.ok((await readFile(await storage.resolveAssetPath(oldAssets[0].storageKey))).length > 0, 'historical version asset must remain reachable');
  assert.ok((await readFile(await storage.resolveAssetPath(promotedAssets[0].storageKey))).length > 0, 'promoted current version asset must be reachable');
  assert.equal(await client.practiceRecord.count({ where: { questionId: oldQuestion.id } }), 1);
  const concurrentCandidate = await client.questionImportCandidate.create({
    data: {
      batchId: batch.id, stem: 'confirmation concurrent', options: ['A', 'B'], answer: 'A', analysis: 'concurrent analysis',
      difficulty: 'MEDIUM', type: 'SINGLE_CHOICE', source: 'integration source', expectedTimeSec: 90,
      knowledgePointIds: ['co-cache'], formulas: [], warnings: [], contentFingerprint: randomBytes(32).toString('hex'), status: 'approved',
    },
  });
  const concurrentInputs = [randomUUID(), randomUUID()].map((idempotencyKey) => ({ candidateIds: [concurrentCandidate.id], idempotencyKey }));
  const outcomes = await Promise.allSettled(concurrentInputs.map((request) => confirmation.confirm(batch.id, request, 'worker-admin')));
  assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1, 'only one confirmation may import a candidate');

  await assertConfirmationSkipAndTerminalStates(client, confirmation);
  await assertExpiredConfirmationKeyIsRejected(client, confirmation);
  await assertConcurrentExactDuplicateSkips(client, confirmation);
}

async function assertConfirmationSkipAndTerminalStates(client, confirmation) {
  const batch = await confirmationBatch(client, 'terminal-confirm.csv');
  await client.questionImportCandidate.create({
    data: confirmationCandidate(batch.id, 'ignored terminal candidate', 'ignored'),
  });
  const candidate = await client.questionImportCandidate.create({
    data: confirmationCandidate(batch.id, 'skip terminal candidate', 'approved'),
  });
  await confirmation.confirm(batch.id, { candidateIds: [candidate.id], idempotencyKey: randomUUID() }, 'worker-admin');
  const [stored, refreshed] = await Promise.all([
    client.questionImportCandidate.findUniqueOrThrow({ where: { id: candidate.id } }),
    client.questionImportBatch.findUniqueOrThrow({ where: { id: batch.id } }),
  ]);
  assert.equal(stored.importedQuestionId, null, 'a non-duplicate skip must not create a question');
  assert.equal(refreshed.status, 'completed', 'ignored and imported candidates are terminal batch states');
}

async function assertExpiredConfirmationKeyIsRejected(client, confirmation) {
  const batch = await confirmationBatch(client, 'expired-key.csv');
  const candidate = await client.questionImportCandidate.create({ data: confirmationCandidate(batch.id, 'expired key candidate', 'approved') });
  const idempotencyKey = randomUUID();
  await client.questionImportConfirmation.create({
    data: {
      batchId: batch.id, idempotencyKey, actorId: 'worker-admin', createdAt: new Date(Date.now() - (31 * 86_400_000)),
      result: { batchId: batch.id, candidateIds: [candidate.id], importedCandidateIds: [], skippedCandidateIds: [], questionIds: [] },
    },
  });
  await assertRejects(
    () => confirmation.confirm(batch.id, { candidateIds: [candidate.id], idempotencyKey }, 'worker-admin'),
    'expired idempotency keys must be rejected instead of being deleted and reused',
  );
}

async function assertConcurrentExactDuplicateSkips(client, confirmation) {
  const [firstBatch, secondBatch] = await Promise.all([confirmationBatch(client, 'exact-a.csv'), confirmationBatch(client, 'exact-b.csv')]);
  const first = await client.questionImportCandidate.create({ data: confirmationCandidate(firstBatch.id, 'same exact candidate', 'approved') });
  const second = await client.questionImportCandidate.create({ data: confirmationCandidate(secondBatch.id, 'same exact candidate', 'approved') });
  const outcomes = await Promise.allSettled([
    confirmation.confirm(firstBatch.id, { candidateIds: [first.id], idempotencyKey: randomUUID() }, 'worker-admin'),
    confirmation.confirm(secondBatch.id, { candidateIds: [second.id], idempotencyKey: randomUUID() }, 'worker-admin'),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 2, 'concurrent duplicate skips should both resolve');
  assert.equal(await client.question.count({ where: { stem: 'same exact candidate', isCurrent: true } }), 0, 'concurrent exact duplicate skips must not create independent current questions');
}

async function confirmationBatch(client, originalFileName) {
  return client.questionImportBatch.create({
    data: {
      uploadedById: 'worker-admin', originalFileName, originalStorageKey: `temporary/${randomUUID()}`,
      fileSha256: randomBytes(32).toString('hex'), fileType: 'csv', source: 'integration source', rightsConfirmed: true,
      rightsConfirmedAt: new Date(), status: 'review', expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
}

function confirmationCandidate(batchId, stem, status) {
  return {
    batchId, stem, options: ['A', 'B'], answer: 'A', analysis: `${stem} analysis`, difficulty: 'MEDIUM', type: 'SINGLE_CHOICE',
    source: 'integration source', expectedTimeSec: 90, knowledgePointIds: ['co-cache'], formulas: [], warnings: [],
    contentFingerprint: randomBytes(32).toString('hex'), status, duplicateAction: 'skip',
  };
}

function pngFixture(label) {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(label, 'utf8'),
  ]);
}

async function assertClaimCancelLockOrder(client, services, storage, parser, validation, audits, batchId) {
  const claimReady = signal();
  const cancelStarted = signal();
  const cancelBatchLocked = signal();
  const claimClient = withClaimLockBarrier(client, { claimReady, cancelStarted, cancelBatchLocked });
  const cancelClient = withCancelLockBarrier(client, { cancelStarted, cancelBatchLocked });
  const worker = new services.ImportWorkerService(claimClient, storage, parser, {
    workerId: 'pg-worker-deadlock-regression', leaseMs: 5_000, autoStart: false,
  }, validation);
  const cancelService = new services.ImportBatchService(cancelClient, audits);

  const claimPromise = worker.claimNextJob();
  await claimReady.promise;
  const cancelPromise = cancelService.cancel('worker-admin', batchId);
  const outcomes = await Promise.allSettled([claimPromise, cancelPromise]);
  assert.deepEqual(
    outcomes.map((outcome) => outcome.status),
    ['fulfilled', 'fulfilled'],
    `claim/cancel must share batch-to-job lock order: ${outcomes.map(formatOutcome).join(', ')}`,
  );
}

function withCandidateUpdateBarrier(client, barrier) {
  return {
    $transaction: (callback) => client.$transaction(async (tx) => {
      let batchLockedFirst = false;
      return callback(new Proxy(tx, {
        get(target, property) {
          if (property === '$queryRaw') {
            return async (...args) => {
              if (isBatchLockSql(args[0])) batchLockedFirst = true;
              return target.$queryRaw(...args);
            };
          }
          if (property === 'questionImportCandidate') {
            return new Proxy(target.questionImportCandidate, {
              get(candidateTarget, candidateProperty) {
                if (candidateProperty !== 'updateMany') return candidateTarget[candidateProperty];
                return async (...args) => {
                  const result = await candidateTarget.updateMany(...args);
                  if (!batchLockedFirst) await barrier();
                  return result;
                };
              },
            });
          }
          return target[property];
        },
      }));
    }),
  };
}

function withClaimLockBarrier(client, signals) {
  return {
    $transaction: (callback) => client.$transaction(async (tx) => {
      let batchLockedFirst = false;
      return callback(new Proxy(tx, {
        get(target, property) {
          if (property !== '$queryRaw') return target[property];
          return async (...args) => {
            const sql = sqlText(args[0]);
            const isBatchLock = isBatchLockSql(args[0]);
            if (isBatchLock) batchLockedFirst = true;
            const result = await target.$queryRaw(...args);
            if (isBatchLock) {
              signals.claimReady.resolve();
              await signals.cancelStarted.promise;
            } else if (sql.includes('UPDATE "QuestionImportJob"')) {
              signals.claimReady.resolve();
              if (!batchLockedFirst) await signals.cancelBatchLocked.promise;
            }
            return result;
          };
        },
      }));
    }),
  };
}

function withCancelLockBarrier(client, signals) {
  return {
    $transaction: (callback) => client.$transaction(async (tx) => {
      const wrapped = new Proxy(tx, {
        get(target, property) {
          if (property !== 'questionImportBatch') return target[property];
          return new Proxy(target.questionImportBatch, {
            get(batchTarget, batchProperty) {
              if (batchProperty !== 'updateMany') return batchTarget[batchProperty];
              return async (...args) => {
                signals.cancelStarted.resolve();
                const result = await batchTarget.updateMany(...args);
                signals.cancelBatchLocked.resolve();
                return result;
              };
            },
          });
        },
      });
      return callback(wrapped);
    }),
  };
}

function twoPartyBarrier() {
  let arrivals = 0;
  const ready = signal();
  return async () => {
    arrivals += 1;
    if (arrivals === 2) ready.resolve();
    await ready.promise;
  };
}

function signal() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function sqlText(strings) {
  return Array.isArray(strings) ? strings.join('?') : '';
}

function isBatchLockSql(strings) {
  const sql = sqlText(strings);
  return sql.includes('QuestionImportBatch') && /FOR UPDATE(?: OF batch)?(?: SKIP LOCKED)?/u.test(sql)
    && !sql.includes('FOR UPDATE OF job');
}

function formatOutcome(outcome) {
  return outcome.status === 'fulfilled' ? 'fulfilled' : String(outcome.reason?.message ?? outcome.reason);
}

function tableCsv() {
  const headers = ['科目', '章节', '知识点', '题型', '难度', '题干', '选项 A', '选项 B', '选项 C', '选项 D', '选项 E', '选项 F', '选项 G', '选项 H', '正确答案', '答案解析', '来源', '年份', '建议答题时间（秒）'];
  const rows = [
    ['数据结构', '树与二叉树', '树的遍历应用', '选择题', '中等', 'version two', 'A', 'B', '', '', '', '', '', '', 'A', 'version one analysis', 'integration source', '', '90'],
    ['计算机组成原理', '存储系统', 'Cache 映射与替换', '选择题', '中等', 'worker unique', 'A', 'B', '', '', '', '', '', '', 'A', 'worker unique analysis', 'integration source', '2026', '90'],
    ['计算机组成原理', '存储系统', 'Cache 映射与替换', '选择题', '中等', '', 'A', 'B', '', '', '', '', '', '', 'A', 'invalid row analysis', 'integration source', '2026', '90'],
  ];
  return `${headers.join(',')}\r\n${rows.map((row) => row.join(',')).join('\r\n')}\r\n`;
}

async function tableXlsx(stem) {
  const { QUESTION_IMPORT_SHEET } = require(join(root, 'apps/api/dist/questions/import/table-import.parser.js'));
  const [headerLine, rowLine] = tableCsv().trim().split(/\r?\n/u);
  const row = rowLine.split(',');
  row[5] = stem;
  row[15] = `${stem} analysis`;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(QUESTION_IMPORT_SHEET);
  sheet.addRow(headerLine.split(','));
  sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function assertImportBatchTransactions(client, AuditEventService, ImportBatchService) {
  await client.user.create({ data: { id: 'import-admin', name: 'Import Admin', role: 'ADMIN' } });
  const realAudits = new AuditEventService(client);
  let failAudit = true;
  const audits = {
    record: async (input, tx) => {
      await realAudits.record(input, tx);
      if (failAudit) throw new Error('simulated audit persistence failure');
    },
  };
  const batches = new ImportBatchService(client, audits);
  const input = { source: 'integration upload', rightsConfirmed: true, title: 'transaction fixture' };
  const file = {
    storageKey: 'incoming/transaction-fixture.csv', originalFileName: 'transaction-fixture.csv',
    fileSha256: 'transaction-fixture-sha', fileType: 'csv', byteSize: 42,
  };

  await assertRejects(
    () => batches.create('import-admin', input, file),
    'an audit failure must roll back the batch and its queued job',
  );
  assert.equal(await client.questionImportBatch.count({ where: { originalStorageKey: file.storageKey } }), 0);
  assert.equal(await client.questionImportJob.count(), 0);
  assert.equal(await client.auditEvent.count({ where: { action: 'question_import.upload' } }), 0);

  failAudit = false;
  const created = await batches.create('import-admin', input, file);
  const batch = await client.questionImportBatch.findUniqueOrThrow({
    where: { id: created.batchId }, include: { jobs: true },
  });
  assert.equal(batch.status, 'queued');
  assert.equal(batch.jobs.length, 1);
  assert.equal(batch.jobs[0].state, 'pending');
  assert.equal(await client.auditEvent.count({ where: { action: 'question_import.upload', targetId: batch.id } }), 1);

  await client.questionImportJob.update({ where: { id: batch.jobs[0].id }, data: { state: 'failed' } });
  const retried = await batches.retry('import-admin', batch.id, [batch.jobs[0].id]);
  assert.equal(retried.retriedJobs, 1);
  const afterRetry = await client.questionImportJob.findUniqueOrThrow({ where: { id: batch.jobs[0].id } });
  assert.equal(afterRetry.state, 'queued');
  assert.equal(afterRetry.attempt, 1);
  await assertRejects(
    () => batches.retry('import-admin', batch.id, [batch.jobs[0].id]),
    'a queued job must not be retryable a second time',
  );

  const cancelled = await batches.cancel('import-admin', batch.id);
  assert.equal(cancelled.status, 'cancelled');
  const afterCancel = await client.questionImportBatch.findUniqueOrThrow({ where: { id: batch.id }, include: { jobs: true } });
  assert.equal(afterCancel.status, 'cancelled');
  assert.equal(afterCancel.jobs[0].state, 'cancelled');
  await assertRejects(
    () => batches.retry('import-admin', batch.id, [batch.jobs[0].id]),
    'cancelled batches must not accept retries',
  );
  assert.equal(await client.auditEvent.count({ where: { action: { in: ['question_import.retry', 'question_import.cancel'] }, targetId: batch.id } }), 2);
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
