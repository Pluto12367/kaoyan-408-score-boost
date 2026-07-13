-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('STUDENT', 'TEACHER', 'ADMIN');

-- CreateEnum
CREATE TYPE "Subject" AS ENUM ('DATA_STRUCTURE', 'COMPUTER_ORGANIZATION', 'OPERATING_SYSTEM', 'COMPUTER_NETWORK');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('BASIC', 'MEDIUM', 'HARD');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('SINGLE_CHOICE', 'COMPREHENSIVE', 'JUDGEMENT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "targetSchool" TEXT,
    "targetScore" INTEGER,
    "currentScore" INTEGER,
    "dailyHours" DOUBLE PRECISION,
    "remainingDays" INTEGER,
    "studyStage" TEXT,
    "weakestSubject" TEXT,
    "diagnosis" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgePoint" (
    "id" TEXT NOT NULL,
    "subject" "Subject" NOT NULL,
    "chapter" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "importance" INTEGER NOT NULL,
    "frequency" INTEGER NOT NULL,
    "prerequisites" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgePoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "stem" TEXT NOT NULL,
    "options" TEXT[],
    "answer" TEXT NOT NULL,
    "analysis" TEXT NOT NULL,
    "difficulty" "Difficulty" NOT NULL,
    "type" "QuestionType" NOT NULL,
    "source" TEXT NOT NULL,
    "year" INTEGER,
    "expectedTimeSec" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionKnowledgePoint" (
    "questionId" TEXT NOT NULL,
    "knowledgePointId" TEXT NOT NULL,

    CONSTRAINT "QuestionKnowledgePoint_pkey" PRIMARY KEY ("questionId","knowledgePointId")
);

-- CreateTable
CREATE TABLE "PracticeRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "knowledgePointId" TEXT NOT NULL,
    "selectedAnswer" TEXT,
    "correct" BOOLEAN NOT NULL,
    "timeSpentSec" INTEGER NOT NULL,
    "expectedTimeSec" INTEGER NOT NULL,
    "mistakeReason" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PracticeRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WrongQuestionReview" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WrongQuestionReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyTaskCompletion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "completedDate" TEXT NOT NULL,
    "completedQuestionCount" INTEGER,
    "correctCount" INTEGER,
    "minutesSpent" INTEGER,
    "selfRating" INTEGER,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyTaskCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "targetScore" INTEGER NOT NULL,
    "remainingDays" INTEGER NOT NULL,
    "dailyHours" DOUBLE PRECISION NOT NULL,
    "checkpoint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyTask" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "knowledgePointId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "questionCount" INTEGER NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "StudyTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiTutorLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionId" TEXT,
    "prompt" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiTutorLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuntimeState" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuntimeState_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_expiresAt_idx" ON "RefreshToken"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "PracticeRecord_userId_submittedAt_idx" ON "PracticeRecord"("userId", "submittedAt");

-- CreateIndex
CREATE INDEX "PracticeRecord_knowledgePointId_correct_idx" ON "PracticeRecord"("knowledgePointId", "correct");

-- CreateIndex
CREATE INDEX "WrongQuestionReview_userId_reviewedAt_idx" ON "WrongQuestionReview"("userId", "reviewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WrongQuestionReview_userId_questionId_key" ON "WrongQuestionReview"("userId", "questionId");

-- CreateIndex
CREATE INDEX "StudyTaskCompletion_userId_completedAt_idx" ON "StudyTaskCompletion"("userId", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StudyTaskCompletion_userId_taskId_completedDate_key" ON "StudyTaskCompletion"("userId", "taskId", "completedDate");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionKnowledgePoint" ADD CONSTRAINT "QuestionKnowledgePoint_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionKnowledgePoint" ADD CONSTRAINT "QuestionKnowledgePoint_knowledgePointId_fkey" FOREIGN KEY ("knowledgePointId") REFERENCES "KnowledgePoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeRecord" ADD CONSTRAINT "PracticeRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeRecord" ADD CONSTRAINT "PracticeRecord_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeRecord" ADD CONSTRAINT "PracticeRecord_knowledgePointId_fkey" FOREIGN KEY ("knowledgePointId") REFERENCES "KnowledgePoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WrongQuestionReview" ADD CONSTRAINT "WrongQuestionReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WrongQuestionReview" ADD CONSTRAINT "WrongQuestionReview_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyTaskCompletion" ADD CONSTRAINT "StudyTaskCompletion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyPlan" ADD CONSTRAINT "StudyPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyTask" ADD CONSTRAINT "StudyTask_planId_fkey" FOREIGN KEY ("planId") REFERENCES "StudyPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
