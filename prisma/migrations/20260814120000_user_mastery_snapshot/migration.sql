-- Additive: daily per-user per-node mastery snapshots power the mastery
-- trend report. Existing tables and constraints are untouched.

CREATE TABLE "UserMasterySnapshot" (
  "id"              TEXT             NOT NULL,
  "userId"          TEXT             NOT NULL,
  "knowledgeNodeId" TEXT             NOT NULL,
  "mastery"         DOUBLE PRECISION NOT NULL,
  "attempts"        INTEGER          NOT NULL,
  "correctCount"    INTEGER          NOT NULL,
  "wrongCount"      INTEGER          NOT NULL,
  "snapshotDate"    TIMESTAMP(3)     NOT NULL,
  "createdAt"       TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserMasterySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserMasterySnapshot_userId_knowledgeNodeId_snapshotDate_key"
  ON "UserMasterySnapshot"("userId", "knowledgeNodeId", "snapshotDate");

CREATE INDEX "UserMasterySnapshot_userId_snapshotDate_idx"
  ON "UserMasterySnapshot"("userId", "snapshotDate");

ALTER TABLE "UserMasterySnapshot"
  ADD CONSTRAINT "UserMasterySnapshot_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserMasterySnapshot"
  ADD CONSTRAINT "UserMasterySnapshot_knowledgeNodeId_fkey"
  FOREIGN KEY ("knowledgeNodeId") REFERENCES "KnowledgeNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
