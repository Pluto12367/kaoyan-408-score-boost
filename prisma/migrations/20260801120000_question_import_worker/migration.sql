-- Add short-lived worker leases without changing the previously applied import migrations.
ALTER TABLE "QuestionImportJob"
ADD COLUMN "leaseOwner" TEXT,
ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

-- A table row has one durable candidate per job, including after a crashed worker is reclaimed.
ALTER TABLE "QuestionImportCandidate"
ADD COLUMN "sourceRowNumber" INTEGER;

CREATE INDEX "QuestionImportJob_state_retryAt_leaseExpiresAt_createdAt_idx"
ON "QuestionImportJob"("state", "retryAt", "leaseExpiresAt", "createdAt");

CREATE UNIQUE INDEX "QuestionImportCandidate_jobId_sourceRowNumber_key"
ON "QuestionImportCandidate"("jobId", "sourceRowNumber");
