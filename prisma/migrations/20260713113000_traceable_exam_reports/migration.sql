ALTER TABLE "PracticeRecord"
ADD COLUMN "sessionId" TEXT,
ADD COLUMN "gradingMode" TEXT NOT NULL DEFAULT 'objective',
ADD COLUMN "selfScore" INTEGER,
ADD COLUMN "maxScore" INTEGER;

CREATE INDEX "PracticeRecord_sessionId_submittedAt_idx" ON "PracticeRecord"("sessionId", "submittedAt");
ALTER TABLE "PracticeRecord" ADD CONSTRAINT "PracticeRecord_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "LearningSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ExamReviewPlan" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "days" JSONB NOT NULL,
    "recommendation" TEXT NOT NULL,
    "examAccuracyRate" INTEGER NOT NULL,
    "weakPointTitles" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExamReviewPlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExamReviewPlan_sessionId_key" ON "ExamReviewPlan"("sessionId");
CREATE INDEX "ExamReviewPlan_userId_createdAt_idx" ON "ExamReviewPlan"("userId", "createdAt");
ALTER TABLE "ExamReviewPlan" ADD CONSTRAINT "ExamReviewPlan_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "LearningSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExamReviewPlan" ADD CONSTRAINT "ExamReviewPlan_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
