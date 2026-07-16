-- Keep the original question content available when a learning session is resumed later.
ALTER TABLE "LearningSession"
ADD COLUMN "questionSnapshot" JSONB NOT NULL DEFAULT '[]';
