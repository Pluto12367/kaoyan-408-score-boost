-- V14-② memory-card foundation (Owner Gate D1 approved 2026-09-26).
-- Design: docs/v14-memory-card-design.md §4.
-- Three additive tables, zero backfill, zero changes to existing tables.
-- Semantic fence (contract docs/development/score-mastery-evidence-semantics.md):
--   these tables hold CARD-domain scheduling facts only. The card review path
--   never writes UserKnowledgeMastery / ReviewSchedule / the evidence ledger —
--   self-reported card ratings are weak evidence and cannot influence mastery.
--
-- Rollback (all three tables are new and content-free at deploy time):
--   DROP TABLE "MemoryCardReviewLog";
--   DROP TABLE "UserMemoryCardState";
--   DROP TABLE "MemoryCard";

-- CreateTable
CREATE TABLE "MemoryCard" (
    "id" TEXT NOT NULL,
    "knowledgeNodeId" TEXT NOT NULL,
    -- Controlled dictionary CONCLUSION | FORMULA, validated app-side (no ENUM lock).
    "cardType" TEXT NOT NULL,
    "front" TEXT NOT NULL,
    "back" TEXT NOT NULL,
    -- RULE-10: no content row without a named reviewer + rights confirmation.
    "reviewedBy" TEXT,
    "rightsConfirmed" BOOLEAN,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemoryCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMemoryCardState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "stabilityDays" DOUBLE PRECISION,
    "lastReviewedAt" TIMESTAMP(3),
    "nextReviewAt" TIMESTAMP(3),
    -- Controlled subset of ReviewQuality: 0 | 2 | 4, validated app-side.
    "lastRating" INTEGER,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMemoryCardState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryCardReviewLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "stabilityBefore" DOUBLE PRECISION,
    "stabilityAfter" DOUBLE PRECISION,
    -- PRODUCT density-policy provenance, logged per review (never a model claim).
    "densityFactor" DOUBLE PRECISION NOT NULL,
    "densityBasis" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT NOT NULL,

    CONSTRAINT "MemoryCardReviewLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemoryCard_knowledgeNodeId_isActive_idx" ON "MemoryCard"("knowledgeNodeId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "UserMemoryCardState_userId_cardId_key" ON "UserMemoryCardState"("userId", "cardId");

-- CreateIndex
CREATE INDEX "UserMemoryCardState_userId_nextReviewAt_idx" ON "UserMemoryCardState"("userId", "nextReviewAt");

-- CreateIndex
CREATE UNIQUE INDEX "MemoryCardReviewLog_idempotencyKey_key" ON "MemoryCardReviewLog"("idempotencyKey");

-- CreateIndex
CREATE INDEX "MemoryCardReviewLog_userId_cardId_reviewedAt_idx" ON "MemoryCardReviewLog"("userId", "cardId", "reviewedAt");

-- AddForeignKey
ALTER TABLE "MemoryCard" ADD CONSTRAINT "MemoryCard_knowledgeNodeId_fkey" FOREIGN KEY ("knowledgeNodeId") REFERENCES "KnowledgeNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMemoryCardState" ADD CONSTRAINT "UserMemoryCardState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMemoryCardState" ADD CONSTRAINT "UserMemoryCardState_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "MemoryCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (composite: review logs hang off the (userId, cardId) state row)
ALTER TABLE "MemoryCardReviewLog" ADD CONSTRAINT "MemoryCardReviewLog_userId_cardId_fkey" FOREIGN KEY ("userId", "cardId") REFERENCES "UserMemoryCardState"("userId", "cardId") ON DELETE CASCADE ON UPDATE CASCADE;
