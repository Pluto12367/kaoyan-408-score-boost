-- CreateEnum
CREATE TYPE "QuestionImportFileType" AS ENUM ('pdf', 'xlsx', 'csv');
CREATE TYPE "QuestionImportBatchStatus" AS ENUM ('uploaded', 'queued', 'parsing', 'parsing_partial_failure', 'review', 'partially_imported', 'completed', 'failed', 'cancelled', 'expired');
CREATE TYPE "QuestionImportCandidateStatus" AS ENUM ('pending_review', 'needs_edit', 'duplicate_suspected', 'approved', 'ignored', 'parse_failed', 'imported');
CREATE TYPE "QuestionImportJobState" AS ENUM ('pending', 'queued', 'running', 'succeeded', 'failed', 'cancelled');
CREATE TYPE "QuestionImportDuplicateAction" AS ENUM ('skip', 'create', 'new_version');
CREATE TYPE "QuestionImportAssetScope" AS ENUM ('temporary', 'permanent');

-- CreateTable
CREATE TABLE "QuestionFamily" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "QuestionFamily_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuestionImportBatch" (
  "id" TEXT NOT NULL,
  "uploadedById" TEXT NOT NULL,
  "originalFileName" TEXT NOT NULL,
  "originalStorageKey" TEXT NOT NULL,
  "fileSha256" TEXT NOT NULL,
  "fileType" "QuestionImportFileType" NOT NULL,
  "source" TEXT NOT NULL,
  "title" TEXT,
  "year" INTEGER,
  "defaultSubject" TEXT,
  "defaultChapter" TEXT,
  "pageRange" TEXT,
  "rightsConfirmed" BOOLEAN NOT NULL,
  "rightsConfirmedAt" TIMESTAMP(3),
  "status" "QuestionImportBatchStatus" NOT NULL DEFAULT 'uploaded',
  "statusCounts" JSONB NOT NULL DEFAULT '{}',
  "providerSummary" JSONB,
  "costSummary" JSONB,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "QuestionImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuestionImportJob" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "pageStart" INTEGER NOT NULL,
  "pageEnd" INTEGER NOT NULL,
  "provider" TEXT NOT NULL,
  "externalTaskId" TEXT,
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "retryAt" TIMESTAMP(3),
  "state" "QuestionImportJobState" NOT NULL DEFAULT 'pending',
  "quality" JSONB,
  "cost" JSONB,
  "error" JSONB,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "QuestionImportJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuestionImportCandidate" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "jobId" TEXT,
  "stem" TEXT NOT NULL,
  "options" TEXT[] NOT NULL,
  "answer" TEXT NOT NULL,
  "analysis" TEXT NOT NULL,
  "difficulty" "Difficulty" NOT NULL,
  "type" "QuestionType" NOT NULL,
  "source" TEXT NOT NULL,
  "year" INTEGER,
  "expectedTimeSec" INTEGER NOT NULL DEFAULT 100,
  "knowledgePointIds" TEXT[] NOT NULL,
  "formulas" JSONB NOT NULL DEFAULT '[]',
  "warnings" JSONB NOT NULL DEFAULT '[]',
  "pageNumber" INTEGER,
  "sourceRegion" JSONB,
  "contentFingerprint" TEXT NOT NULL,
  "targetFamilyId" TEXT,
  "status" "QuestionImportCandidateStatus" NOT NULL DEFAULT 'pending_review',
  "duplicateAction" "QuestionImportDuplicateAction" NOT NULL DEFAULT 'skip',
  "reviewMetadata" JSONB,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "revision" INTEGER NOT NULL DEFAULT 0,
  "importedQuestionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "QuestionImportCandidate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "QuestionImportAsset" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "scope" "QuestionImportAssetScope" NOT NULL DEFAULT 'temporary',
  "storageKey" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "mediaType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "pageNumber" INTEGER,
  "sourceRegion" JSONB,
  "candidateId" TEXT,
  "questionId" TEXT,
  "expiresAt" TIMESTAMP(3),
  "promotedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "QuestionImportAsset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "QuestionImportAsset_scope_owner_check" CHECK (
    ("scope" = 'temporary' AND "questionId" IS NULL)
    OR ("scope" = 'permanent' AND "questionId" IS NOT NULL AND "candidateId" IS NULL)
  )
);

CREATE TABLE "QuestionImportConfirmation" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "QuestionImportConfirmation_pkey" PRIMARY KEY ("id")
);

-- AddColumns. The two fields requiring backfill remain nullable until the backfill completes.
ALTER TABLE "Question"
ADD COLUMN "familyId" TEXT,
ADD COLUMN "versionNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "isCurrent" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "contentFingerprint" TEXT,
ADD COLUMN "importBatchId" TEXT;

-- Preserve every existing Question.id by giving each historic row its own stable family.
INSERT INTO "QuestionFamily" ("id")
SELECT 'legacy-' || "id"
FROM "Question";

UPDATE "Question"
SET
  "familyId" = 'legacy-' || "id",
  "versionNumber" = 1,
  "isCurrent" = true,
  "contentFingerprint" = md5("stem" || "options"::text);

ALTER TABLE "Question"
ALTER COLUMN "familyId" SET NOT NULL,
ALTER COLUMN "contentFingerprint" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Question_familyId_versionNumber_key" ON "Question"("familyId", "versionNumber");
CREATE INDEX "Question_isCurrent_createdAt_idx" ON "Question"("isCurrent", "createdAt");
CREATE INDEX "Question_contentFingerprint_isCurrent_idx" ON "Question"("contentFingerprint", "isCurrent");
CREATE INDEX "QuestionImportBatch_uploadedById_createdAt_idx" ON "QuestionImportBatch"("uploadedById", "createdAt");
CREATE INDEX "QuestionImportBatch_fileSha256_status_idx" ON "QuestionImportBatch"("fileSha256", "status");
CREATE INDEX "QuestionImportBatch_status_expiresAt_idx" ON "QuestionImportBatch"("status", "expiresAt");
CREATE INDEX "QuestionImportJob_batchId_state_retryAt_idx" ON "QuestionImportJob"("batchId", "state", "retryAt");
CREATE INDEX "QuestionImportJob_externalTaskId_idx" ON "QuestionImportJob"("externalTaskId");
CREATE INDEX "QuestionImportCandidate_batchId_status_createdAt_idx" ON "QuestionImportCandidate"("batchId", "status", "createdAt");
CREATE INDEX "QuestionImportCandidate_contentFingerprint_status_idx" ON "QuestionImportCandidate"("contentFingerprint", "status");
CREATE INDEX "QuestionImportCandidate_targetFamilyId_idx" ON "QuestionImportCandidate"("targetFamilyId");
CREATE INDEX "QuestionImportCandidate_jobId_idx" ON "QuestionImportCandidate"("jobId");
CREATE INDEX "QuestionImportAsset_batchId_scope_expiresAt_idx" ON "QuestionImportAsset"("batchId", "scope", "expiresAt");
CREATE INDEX "QuestionImportAsset_candidateId_idx" ON "QuestionImportAsset"("candidateId");
CREATE INDEX "QuestionImportAsset_questionId_idx" ON "QuestionImportAsset"("questionId");
CREATE INDEX "QuestionImportAsset_sha256_idx" ON "QuestionImportAsset"("sha256");
CREATE UNIQUE INDEX "QuestionImportAsset_storageKey_key" ON "QuestionImportAsset"("storageKey");
CREATE UNIQUE INDEX "QuestionImportConfirmation_idempotencyKey_key" ON "QuestionImportConfirmation"("idempotencyKey");
CREATE INDEX "QuestionImportConfirmation_batchId_createdAt_idx" ON "QuestionImportConfirmation"("batchId", "createdAt");

-- AddForeignKey
ALTER TABLE "Question"
ADD CONSTRAINT "Question_familyId_fkey"
FOREIGN KEY ("familyId") REFERENCES "QuestionFamily"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Question"
ADD CONSTRAINT "Question_importBatchId_fkey"
FOREIGN KEY ("importBatchId") REFERENCES "QuestionImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "QuestionImportJob"
ADD CONSTRAINT "QuestionImportJob_batchId_fkey"
FOREIGN KEY ("batchId") REFERENCES "QuestionImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "QuestionImportCandidate"
ADD CONSTRAINT "QuestionImportCandidate_batchId_fkey"
FOREIGN KEY ("batchId") REFERENCES "QuestionImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "QuestionImportCandidate"
ADD CONSTRAINT "QuestionImportCandidate_jobId_fkey"
FOREIGN KEY ("jobId") REFERENCES "QuestionImportJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "QuestionImportCandidate"
ADD CONSTRAINT "QuestionImportCandidate_targetFamilyId_fkey"
FOREIGN KEY ("targetFamilyId") REFERENCES "QuestionFamily"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "QuestionImportCandidate"
ADD CONSTRAINT "QuestionImportCandidate_importedQuestionId_fkey"
FOREIGN KEY ("importedQuestionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "QuestionImportAsset"
ADD CONSTRAINT "QuestionImportAsset_batchId_fkey"
FOREIGN KEY ("batchId") REFERENCES "QuestionImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "QuestionImportAsset"
ADD CONSTRAINT "QuestionImportAsset_candidateId_fkey"
FOREIGN KEY ("candidateId") REFERENCES "QuestionImportCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "QuestionImportAsset"
ADD CONSTRAINT "QuestionImportAsset_questionId_fkey"
FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "QuestionImportConfirmation"
ADD CONSTRAINT "QuestionImportConfirmation_batchId_fkey"
FOREIGN KEY ("batchId") REFERENCES "QuestionImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
