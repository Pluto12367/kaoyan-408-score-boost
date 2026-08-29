-- Add row-level optimistic concurrency token for canonical V3 mastery writes.
ALTER TABLE "UserKnowledgeMastery" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
