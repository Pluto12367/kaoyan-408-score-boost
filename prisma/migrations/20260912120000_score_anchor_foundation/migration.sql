-- AlterTable
ALTER TABLE "User" ADD COLUMN     "examDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ScorePrediction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "predictionKey" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "predictedScore" DOUBLE PRECISION NOT NULL,
    "predictedMinScore" DOUBLE PRECISION,
    "predictedMaxScore" DOUBLE PRECISION,
    "normalizedTotalScale" INTEGER NOT NULL DEFAULT 150,
    "semantic" TEXT NOT NULL DEFAULT 'exam_total',
    "source" TEXT NOT NULL DEFAULT 'MODEL_OUTPUT',
    "generatedFor" TEXT,
    "inputsSnapshot" JSONB,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScorePrediction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreAssessment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "originType" TEXT NOT NULL,
    "originId" TEXT NOT NULL,
    "rawScore" DOUBLE PRECISION NOT NULL,
    "rawTotalScale" DOUBLE PRECISION NOT NULL,
    "normalizedScore" DOUBLE PRECISION,
    "normalizedTotalScale" INTEGER NOT NULL DEFAULT 150,
    "semantic" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "gradingMethod" TEXT,
    "examDate" TIMESTAMP(3),
    "title" TEXT,
    "evidenceRefs" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreOutcome" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "examType" TEXT NOT NULL,
    "dedupKey" TEXT,
    "rawScore" DOUBLE PRECISION NOT NULL,
    "rawTotalScale" DOUBLE PRECISION NOT NULL,
    "normalizedScore" DOUBLE PRECISION,
    "normalizedTotalScale" INTEGER NOT NULL DEFAULT 150,
    "semantic" TEXT NOT NULL DEFAULT 'exam_total',
    "source" TEXT NOT NULL,
    "verificationStatus" TEXT NOT NULL DEFAULT 'unverified',
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "evidenceRefs" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreCorrection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetKind" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "correctedFields" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "correctedBy" TEXT NOT NULL,
    "correctedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScorePrediction_userId_generatedAt_idx" ON "ScorePrediction"("userId", "generatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScorePrediction_userId_predictionKey_key" ON "ScorePrediction"("userId", "predictionKey");

-- CreateIndex
CREATE INDEX "ScoreAssessment_userId_examDate_idx" ON "ScoreAssessment"("userId", "examDate");

-- CreateIndex
CREATE UNIQUE INDEX "ScoreAssessment_userId_originType_originId_key" ON "ScoreAssessment"("userId", "originType", "originId");

-- CreateIndex
CREATE INDEX "ScoreOutcome_userId_occurredAt_idx" ON "ScoreOutcome"("userId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScoreOutcome_userId_dedupKey_key" ON "ScoreOutcome"("userId", "dedupKey");

-- CreateIndex
CREATE INDEX "ScoreCorrection_targetKind_targetId_idx" ON "ScoreCorrection"("targetKind", "targetId");

-- CreateIndex
CREATE INDEX "ScoreCorrection_userId_correctedAt_idx" ON "ScoreCorrection"("userId", "correctedAt");

-- AddForeignKey
ALTER TABLE "ScorePrediction" ADD CONSTRAINT "ScorePrediction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreAssessment" ADD CONSTRAINT "ScoreAssessment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreOutcome" ADD CONSTRAINT "ScoreOutcome_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreCorrection" ADD CONSTRAINT "ScoreCorrection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

