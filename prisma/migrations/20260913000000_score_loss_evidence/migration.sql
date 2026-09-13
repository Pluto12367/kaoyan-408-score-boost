-- S1-P1 (SC-1 + SC-3, s1-score-anchor-formal-design.md §10.5) — Score Loss Evidence.
-- Additive only: 1 × CREATE TABLE + 1 × ADD COLUMN (nullable) + indexes + 1 × FK.
-- Zero DROP / zero RENAME / zero backfill (backfill = fabrication). Rollback is
-- the exact inverse (DROP TABLE + DROP COLUMN); the ledger's four tables are
-- never touched. `Question.maxScore` is nullable: null = unpriced/unknown,
-- NEVER 0 (INV-10); historical rows stay NULL = honestly unknown.

-- CreateTable
CREATE TABLE "ScoreLossItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scoreEntryKind" TEXT NOT NULL,
    "scoreEntryId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "nodeId" TEXT,
    "maxScore" DOUBLE PRECISION,
    "earnedScore" DOUBLE PRECISION,
    "lostScore" DOUBLE PRECISION,
    "lossKind" TEXT NOT NULL,
    "gradingMethod" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreLossItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScoreLossItem_scoreEntryKind_scoreEntryId_questionId_key" ON "ScoreLossItem"("scoreEntryKind", "scoreEntryId", "questionId");

-- CreateIndex
CREATE INDEX "ScoreLossItem_nodeId_idx" ON "ScoreLossItem"("nodeId");

-- CreateIndex
CREATE INDEX "ScoreLossItem_userId_scoreEntryKind_scoreEntryId_idx" ON "ScoreLossItem"("userId", "scoreEntryKind", "scoreEntryId");

-- AddForeignKey
ALTER TABLE "ScoreLossItem" ADD CONSTRAINT "ScoreLossItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable (SC-3): per-question content price. null = unpriced — a missing
-- price is never imputed from averages, frequency or difficulty.
ALTER TABLE "Question" ADD COLUMN     "maxScore" DOUBLE PRECISION;
