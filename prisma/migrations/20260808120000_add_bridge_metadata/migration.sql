-- CreateEnum
CREATE TYPE "BridgeConfidence" AS ENUM ('HIGH', 'MEDIUM');

-- CreateEnum
CREATE TYPE "BridgeSource" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "BridgeMatchMethod" AS ENUM ('EXACT_NAME', 'NORMALIZED_NAME', 'CONTEXT_MATCH', 'MANUAL');

-- CreateEnum
CREATE TYPE "BridgeStatus" AS ENUM ('ACTIVE', 'PENDING_REVIEW', 'REJECTED', 'INACTIVE');

-- Additive bridge metadata columns (nullable first, backfill, then NOT NULL)
ALTER TABLE "KnowledgePointNodeMap" ADD COLUMN "confidenceLevel" "BridgeConfidence";
ALTER TABLE "KnowledgePointNodeMap" ADD COLUMN "source" "BridgeSource";
ALTER TABLE "KnowledgePointNodeMap" ADD COLUMN "status" "BridgeStatus";
ALTER TABLE "KnowledgePointNodeMap" ADD COLUMN "matchMethod" "BridgeMatchMethod";

-- Backfill: historical rows are trusted manual fixtures (no AUTO seed ever touches them)
UPDATE "KnowledgePointNodeMap"
SET "source" = 'MANUAL',
    "confidenceLevel" = 'HIGH',
    "status" = 'ACTIVE',
    "matchMethod" = 'MANUAL'
WHERE "source" IS NULL;

-- Enforce NOT NULL without Prisma defaults, so future writes cannot omit metadata silently
ALTER TABLE "KnowledgePointNodeMap" ALTER COLUMN "confidenceLevel" SET NOT NULL;
ALTER TABLE "KnowledgePointNodeMap" ALTER COLUMN "source" SET NOT NULL;
ALTER TABLE "KnowledgePointNodeMap" ALTER COLUMN "status" SET NOT NULL;
ALTER TABLE "KnowledgePointNodeMap" ALTER COLUMN "matchMethod" SET NOT NULL;

-- Additive indexes for status-filtered resolver lookups
CREATE INDEX "KnowledgePointNodeMap_knowledgePointId_status_idx" ON "KnowledgePointNodeMap"("knowledgePointId", "status");
CREATE INDEX "KnowledgePointNodeMap_knowledgeNodeId_status_idx" ON "KnowledgePointNodeMap"("knowledgeNodeId", "status");
