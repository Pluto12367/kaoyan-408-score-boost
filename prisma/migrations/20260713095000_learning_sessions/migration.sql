-- Persist in-progress practice, assessment, and mock-exam sessions.
CREATE TABLE "LearningSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "resourceId" TEXT,
    "questionIds" TEXT[],
    "answers" JSONB NOT NULL,
    "markedQuestions" TEXT[],
    "currentIndex" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalActiveMs" INTEGER NOT NULL DEFAULT 0,
    "lastResumeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3),
    CONSTRAINT "LearningSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LearningSession_userId_completed_lastActiveAt_idx"
ON "LearningSession"("userId", "completed", "lastActiveAt");

CREATE INDEX "LearningSession_userId_type_resourceId_idx"
ON "LearningSession"("userId", "type", "resourceId");

ALTER TABLE "LearningSession"
ADD CONSTRAINT "LearningSession_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
