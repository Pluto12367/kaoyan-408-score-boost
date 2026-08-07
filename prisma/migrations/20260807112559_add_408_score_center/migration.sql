-- CreateEnum
CREATE TYPE "KnowledgeRelationType" AS ENUM ('PREREQUISITE', 'RELATED', 'CROSS_SUBJECT', 'CONFUSED_WITH', 'SUPERSEDES');

-- CreateEnum
CREATE TYPE "ExamTagRole" AS ENUM ('PRIMARY', 'SECONDARY');

-- CreateEnum
CREATE TYPE "ExamTagPrecision" AS ENUM ('EXACT_ATOMIC', 'BROAD_HISTORICAL');

-- CreateEnum
CREATE TYPE "ExamTagger" AS ENUM ('AI', 'HUMAN', 'HYBRID');

-- CreateEnum
CREATE TYPE "TrendDirection" AS ENUM ('RISING', 'STABLE', 'FALLING', 'COLD');

-- CreateEnum
CREATE TYPE "EvidenceConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- AlterTable
ALTER TABLE "StudyPlan" ADD COLUMN     "availableMinutes" INTEGER,
ADD COLUMN     "modelVersion" TEXT,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "stale" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "targetExamDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StudyTask" ADD COLUMN     "generatedRank" INTEGER,
ADD COLUMN     "knowledgeNodeId" TEXT,
ADD COLUMN     "priorityScore" INTEGER,
ADD COLUMN     "reasonCodes" JSONB,
ADD COLUMN     "recommendationAction" TEXT,
ADD COLUMN     "scoreBreakdown" JSONB;

-- AlterTable
ALTER TABLE "WrongQuestionReview" ADD COLUMN     "resolved" BOOLEAN,
ADD COLUMN     "resolvedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "KnowledgeNode" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "subject" TEXT NOT NULL,
    "nodeType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "importance" INTEGER NOT NULL,
    "difficulty" INTEGER NOT NULL,
    "syllabusVersion" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeRelation" (
    "id" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "type" "KnowledgeRelationType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamPaper" (
    "id" TEXT NOT NULL,
    "exam" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "totalScore" INTEGER NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamPaper_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamQuestion" (
    "id" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "questionNo" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "questionType" TEXT NOT NULL,
    "score" INTEGER,
    "summary" TEXT,
    "sourceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamQuestionKnowledgeTag" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "knowledgeNodeId" TEXT NOT NULL,
    "role" "ExamTagRole" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "precision" "ExamTagPrecision" NOT NULL,
    "taggedBy" "ExamTagger" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExamQuestionKnowledgeTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeFrequencySnapshot" (
    "id" TEXT NOT NULL,
    "knowledgeNodeId" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "recent3Frequency" INTEGER NOT NULL,
    "recent5Frequency" INTEGER NOT NULL,
    "allTimeEvidence" INTEGER NOT NULL,
    "primaryScore5y" INTEGER NOT NULL,
    "trendDirection" "TrendDirection" NOT NULL,
    "trendDelta" DOUBLE PRECISION NOT NULL,
    "evidenceConfidence" "EvidenceConfidence" NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeFrequencySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgePointNodeMap" (
    "knowledgePointId" TEXT NOT NULL,
    "knowledgeNodeId" TEXT NOT NULL,
    "mappingType" TEXT NOT NULL DEFAULT 'PRIMARY',
    "confidence" DOUBLE PRECISION,
    "taggedBy" "ExamTagger" NOT NULL DEFAULT 'HYBRID',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgePointNodeMap_pkey" PRIMARY KEY ("knowledgePointId","knowledgeNodeId")
);

-- CreateTable
CREATE TABLE "QuestionKnowledgeNodeTag" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "knowledgeNodeId" TEXT NOT NULL,
    "role" "ExamTagRole" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "taggedBy" "ExamTagger" NOT NULL DEFAULT 'HYBRID',
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionKnowledgeNodeTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserKnowledgeMastery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "knowledgeNodeId" TEXT NOT NULL,
    "mastery" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "accuracy" DOUBLE PRECISION NOT NULL DEFAULT 0.55,
    "recentAccuracy" DOUBLE PRECISION NOT NULL DEFAULT 0.55,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "wrongCount" INTEGER NOT NULL DEFAULT 0,
    "retention" DOUBLE PRECISION,
    "stabilityDays" DOUBLE PRECISION,
    "lastLearnedAt" TIMESTAMP(3),
    "lastReviewedAt" TIMESTAMP(3),
    "nextReviewAt" TIMESTAMP(3),
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserKnowledgeMastery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeNode_parentId_idx" ON "KnowledgeNode"("parentId");

-- CreateIndex
CREATE INDEX "KnowledgeNode_subject_nodeType_idx" ON "KnowledgeNode"("subject", "nodeType");

-- CreateIndex
CREATE INDEX "KnowledgeNode_isActive_idx" ON "KnowledgeNode"("isActive");

-- CreateIndex
CREATE INDEX "KnowledgeRelation_toId_type_idx" ON "KnowledgeRelation"("toId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeRelation_fromId_toId_type_key" ON "KnowledgeRelation"("fromId", "toId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ExamPaper_exam_year_key" ON "ExamPaper"("exam", "year");

-- CreateIndex
CREATE INDEX "ExamQuestion_subject_questionType_idx" ON "ExamQuestion"("subject", "questionType");

-- CreateIndex
CREATE UNIQUE INDEX "ExamQuestion_paperId_questionNo_key" ON "ExamQuestion"("paperId", "questionNo");

-- CreateIndex
CREATE INDEX "ExamQuestionKnowledgeTag_knowledgeNodeId_precision_role_idx" ON "ExamQuestionKnowledgeTag"("knowledgeNodeId", "precision", "role");

-- CreateIndex
CREATE UNIQUE INDEX "ExamQuestionKnowledgeTag_questionId_knowledgeNodeId_role_key" ON "ExamQuestionKnowledgeTag"("questionId", "knowledgeNodeId", "role");

-- CreateIndex
CREATE INDEX "KnowledgeFrequencySnapshot_snapshotDate_modelVersion_idx" ON "KnowledgeFrequencySnapshot"("snapshotDate", "modelVersion");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeFrequencySnapshot_knowledgeNodeId_snapshotDate_mod_key" ON "KnowledgeFrequencySnapshot"("knowledgeNodeId", "snapshotDate", "modelVersion");

-- CreateIndex
CREATE INDEX "KnowledgePointNodeMap_knowledgeNodeId_idx" ON "KnowledgePointNodeMap"("knowledgeNodeId");

-- CreateIndex
CREATE INDEX "QuestionKnowledgeNodeTag_knowledgeNodeId_role_idx" ON "QuestionKnowledgeNodeTag"("knowledgeNodeId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionKnowledgeNodeTag_questionId_knowledgeNodeId_role_key" ON "QuestionKnowledgeNodeTag"("questionId", "knowledgeNodeId", "role");

-- CreateIndex
CREATE INDEX "UserKnowledgeMastery_userId_nextReviewAt_idx" ON "UserKnowledgeMastery"("userId", "nextReviewAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserKnowledgeMastery_userId_knowledgeNodeId_key" ON "UserKnowledgeMastery"("userId", "knowledgeNodeId");

-- AddForeignKey
ALTER TABLE "StudyTask" ADD CONSTRAINT "StudyTask_knowledgeNodeId_fkey" FOREIGN KEY ("knowledgeNodeId") REFERENCES "KnowledgeNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeNode" ADD CONSTRAINT "KnowledgeNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "KnowledgeNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeRelation" ADD CONSTRAINT "KnowledgeRelation_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "KnowledgeNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeRelation" ADD CONSTRAINT "KnowledgeRelation_toId_fkey" FOREIGN KEY ("toId") REFERENCES "KnowledgeNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamQuestion" ADD CONSTRAINT "ExamQuestion_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "ExamPaper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamQuestionKnowledgeTag" ADD CONSTRAINT "ExamQuestionKnowledgeTag_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "ExamQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamQuestionKnowledgeTag" ADD CONSTRAINT "ExamQuestionKnowledgeTag_knowledgeNodeId_fkey" FOREIGN KEY ("knowledgeNodeId") REFERENCES "KnowledgeNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeFrequencySnapshot" ADD CONSTRAINT "KnowledgeFrequencySnapshot_knowledgeNodeId_fkey" FOREIGN KEY ("knowledgeNodeId") REFERENCES "KnowledgeNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgePointNodeMap" ADD CONSTRAINT "KnowledgePointNodeMap_knowledgePointId_fkey" FOREIGN KEY ("knowledgePointId") REFERENCES "KnowledgePoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgePointNodeMap" ADD CONSTRAINT "KnowledgePointNodeMap_knowledgeNodeId_fkey" FOREIGN KEY ("knowledgeNodeId") REFERENCES "KnowledgeNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionKnowledgeNodeTag" ADD CONSTRAINT "QuestionKnowledgeNodeTag_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionKnowledgeNodeTag" ADD CONSTRAINT "QuestionKnowledgeNodeTag_knowledgeNodeId_fkey" FOREIGN KEY ("knowledgeNodeId") REFERENCES "KnowledgeNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserKnowledgeMastery" ADD CONSTRAINT "UserKnowledgeMastery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserKnowledgeMastery" ADD CONSTRAINT "UserKnowledgeMastery_knowledgeNodeId_fkey" FOREIGN KEY ("knowledgeNodeId") REFERENCES "KnowledgeNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
