-- CreateTable
CREATE TABLE "RecommendationAction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceRefs" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "creationKey" TEXT NOT NULL,
    "studyTaskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "RecommendationAction_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "LearningSession" ADD COLUMN "actionId" TEXT;
ALTER TABLE "PracticeRecord" ADD COLUMN "actionId" TEXT;
ALTER TABLE "ReviewAttempt" ADD COLUMN "actionId" TEXT;
ALTER TABLE "ReviewAttempt" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "RecommendationAction_studyTaskId_key" ON "RecommendationAction"("studyTaskId");
CREATE UNIQUE INDEX "RecommendationAction_userId_creationKey_key" ON "RecommendationAction"("userId", "creationKey");
CREATE INDEX "RecommendationAction_userId_status_createdAt_idx" ON "RecommendationAction"("userId", "status", "createdAt");
CREATE INDEX "RecommendationAction_targetType_targetId_createdAt_idx" ON "RecommendationAction"("targetType", "targetId", "createdAt");
CREATE UNIQUE INDEX "LearningSession_actionId_key" ON "LearningSession"("actionId");
CREATE INDEX "LearningSession_userId_actionId_idx" ON "LearningSession"("userId", "actionId");
CREATE INDEX "PracticeRecord_userId_actionId_submittedAt_idx" ON "PracticeRecord"("userId", "actionId", "submittedAt");
CREATE UNIQUE INDEX "ReviewAttempt_scheduleId_idempotencyKey_key" ON "ReviewAttempt"("scheduleId", "idempotencyKey");
CREATE INDEX "ReviewAttempt_actionId_reviewedAt_idx" ON "ReviewAttempt"("actionId", "reviewedAt");

-- AddForeignKey
ALTER TABLE "RecommendationAction" ADD CONSTRAINT "RecommendationAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecommendationAction" ADD CONSTRAINT "RecommendationAction_studyTaskId_fkey" FOREIGN KEY ("studyTaskId") REFERENCES "StudyTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LearningSession" ADD CONSTRAINT "LearningSession_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "RecommendationAction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PracticeRecord" ADD CONSTRAINT "PracticeRecord_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "RecommendationAction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReviewAttempt" ADD CONSTRAINT "ReviewAttempt_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "RecommendationAction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
