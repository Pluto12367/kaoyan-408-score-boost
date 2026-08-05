-- Add per-answer metadata captured during practice sessions and learning mode.
-- Backward compatible: new columns are nullable or have defaults, so existing
-- rows and API clients are unaffected.
ALTER TABLE "PracticeRecord"
    ADD COLUMN "confidence" TEXT,
    ADD COLUMN "usedHint" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "answerModified" BOOLEAN NOT NULL DEFAULT false;
