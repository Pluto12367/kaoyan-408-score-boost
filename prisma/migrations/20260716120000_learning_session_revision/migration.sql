-- Reject stale auto-save requests that arrive after a newer session snapshot.
ALTER TABLE "LearningSession"
ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;
