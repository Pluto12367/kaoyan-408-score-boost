CREATE TABLE "ReviewSchedule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "inferredReason" TEXT,
    "selfReportedReason" TEXT,
    "note" TEXT,
    "consecutiveCorrect" INTEGER NOT NULL DEFAULT 0,
    "stability" TEXT NOT NULL DEFAULT 'learning',
    "nextReviewAt" TIMESTAMP(3) NOT NULL,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "lastReviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReviewSchedule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReviewAttempt" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "redoCorrect" BOOLEAN NOT NULL,
    "timeSpentSec" INTEGER NOT NULL,
    "reportedReason" TEXT,
    "inferredReason" TEXT,
    "nextIntervalDays" INTEGER NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReviewSchedule_userId_questionId_key" ON "ReviewSchedule"("userId", "questionId");
CREATE INDEX "ReviewSchedule_userId_stability_nextReviewAt_idx" ON "ReviewSchedule"("userId", "stability", "nextReviewAt");
CREATE INDEX "ReviewAttempt_scheduleId_reviewedAt_idx" ON "ReviewAttempt"("scheduleId", "reviewedAt");

ALTER TABLE "ReviewSchedule" ADD CONSTRAINT "ReviewSchedule_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewSchedule" ADD CONSTRAINT "ReviewSchedule_questionId_fkey"
FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewAttempt" ADD CONSTRAINT "ReviewAttempt_scheduleId_fkey"
FOREIGN KEY ("scheduleId") REFERENCES "ReviewSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
