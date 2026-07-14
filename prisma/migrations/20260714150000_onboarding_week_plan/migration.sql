ALTER TABLE "User"
ADD COLUMN "examYear" INTEGER,
ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3);

ALTER TABLE "StudyTask"
ADD COLUMN "subject" TEXT NOT NULL DEFAULT '',
ADD COLUMN "chapter" TEXT NOT NULL DEFAULT '',
ADD COLUMN "scheduledDate" TEXT NOT NULL DEFAULT '',
ADD COLUMN "priority" TEXT NOT NULL DEFAULT '低',
ADD COLUMN "reason" TEXT NOT NULL DEFAULT '',
ADD COLUMN "nextAction" TEXT NOT NULL DEFAULT '',
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'pending',
ADD COLUMN "postponeCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "startedAt" TIMESTAMP(3),
ADD COLUMN "nextAvailableAt" TIMESTAMP(3),
ADD COLUMN "completedAt" TIMESTAMP(3);

CREATE INDEX "StudyTask_planId_scheduledDate_status_idx"
ON "StudyTask"("planId", "scheduledDate", "status");
