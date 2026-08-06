-- Add optional original wrong-question marker for variant retests (Stage 4).
-- Backward compatible: nullable column, existing rows and API clients are unaffected.
ALTER TABLE "PracticeRecord"
    ADD COLUMN "variantQuestionId" TEXT;
