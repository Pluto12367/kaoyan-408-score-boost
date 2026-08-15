-- Additive: per-user per-node quest milestones for the node quest (闯关)
-- flow. Existing tables and constraints are untouched.

CREATE TABLE "UserNodeQuest" (
  "id"              TEXT             NOT NULL,
  "userId"          TEXT             NOT NULL,
  "knowledgeNodeId" TEXT             NOT NULL,
  "attempts"        INTEGER          NOT NULL DEFAULT 0,
  "bestAccuracy"    DOUBLE PRECISION NOT NULL DEFAULT 0,
  "passed"          BOOLEAN          NOT NULL DEFAULT false,
  "passedAt"        TIMESTAMP(3),
  "updatedAt"       TIMESTAMP(3)     NOT NULL,
  "createdAt"       TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserNodeQuest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserNodeQuest_userId_knowledgeNodeId_key"
  ON "UserNodeQuest"("userId", "knowledgeNodeId");

CREATE INDEX "UserNodeQuest_userId_passed_idx"
  ON "UserNodeQuest"("userId", "passed");

ALTER TABLE "UserNodeQuest"
  ADD CONSTRAINT "UserNodeQuest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserNodeQuest"
  ADD CONSTRAINT "UserNodeQuest_knowledgeNodeId_fkey"
  FOREIGN KEY ("knowledgeNodeId") REFERENCES "KnowledgeNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
