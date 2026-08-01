-- Preserve the qpdf artifact selected by the planner so reclaimed child jobs
-- submit the same private input without regenerating a split.
ALTER TABLE "QuestionImportJob"
ADD COLUMN "providerInputStorageKey" TEXT;
