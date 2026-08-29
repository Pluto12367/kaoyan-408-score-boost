-- CreateTable
CREATE TABLE "StudyTaskProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "completedQuestionCount" INTEGER NOT NULL DEFAULT 0,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "minutesSpent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyTaskProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StudyTaskProgress_userId_taskId_key" ON "StudyTaskProgress"("userId", "taskId");

-- CreateIndex
CREATE INDEX "StudyTaskProgress_userId_idx" ON "StudyTaskProgress"("userId");

-- AddForeignKey
ALTER TABLE "StudyTaskProgress" ADD CONSTRAINT "StudyTaskProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
