-- Add the server-owned generation identity without requiring historical backfill.
ALTER TABLE "StudyPlan" ADD COLUMN "generationKey" TEXT;

-- PostgreSQL permits multiple NULL values, preserving legacy plans that have no
-- generation identity while enforcing one plan per user and generation key.
CREATE UNIQUE INDEX "StudyPlan_userId_generationKey_key"
    ON "StudyPlan"("userId", "generationKey");
