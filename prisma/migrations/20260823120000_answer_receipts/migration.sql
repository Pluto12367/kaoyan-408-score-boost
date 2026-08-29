-- Answer receipts for idempotent single-answer submissions.
-- Additive only: no historical backfill and no PracticeRecord foreign key.

CREATE TYPE "AnswerReceiptStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "AnswerReceipt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "hashVersion" TEXT NOT NULL DEFAULT 'v1',
    "status" "AnswerReceiptStatus" NOT NULL DEFAULT 'PENDING',
    "responseSnapshot" JSONB,
    "practiceRecordIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnswerReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnswerReceipt_userId_idempotencyKey_key" ON "AnswerReceipt"("userId", "idempotencyKey");
CREATE INDEX "AnswerReceipt_userId_status_createdAt_idx" ON "AnswerReceipt"("userId", "status", "createdAt");
CREATE INDEX "AnswerReceipt_status_updatedAt_idx" ON "AnswerReceipt"("status", "updatedAt");

ALTER TABLE "AnswerReceipt" ADD CONSTRAINT "AnswerReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
