-- Keep the Task 1 migration immutable. Replace the enum so a newly-added value
-- can safely become a default in the same deploy transaction.
CREATE TYPE "QuestionImportJobState_new" AS ENUM ('pending', 'queued', 'running', 'succeeded', 'failed', 'cancelled');
ALTER TABLE "QuestionImportJob" ALTER COLUMN "state" DROP DEFAULT;
ALTER TABLE "QuestionImportJob"
  ALTER COLUMN "state" TYPE "QuestionImportJobState_new"
  USING ("state"::text::"QuestionImportJobState_new");
DROP TYPE "QuestionImportJobState";
ALTER TYPE "QuestionImportJobState_new" RENAME TO "QuestionImportJobState";
ALTER TABLE "QuestionImportJob" ALTER COLUMN "state" SET DEFAULT 'pending';

ALTER TABLE "QuestionImportBatch"
  ADD COLUMN "title" TEXT,
  ADD COLUMN "year" INTEGER,
  ADD COLUMN "defaultSubject" TEXT,
  ADD COLUMN "defaultChapter" TEXT,
  ADD COLUMN "pageRange" TEXT;

ALTER TABLE "QuestionImportBatch"
  ADD CONSTRAINT "QuestionImportBatch_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
