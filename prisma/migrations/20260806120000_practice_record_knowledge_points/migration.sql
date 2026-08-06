-- P2-4: snapshot all knowledge points of a multi-knowledge-point question so
-- mastery attribution can cover every related point instead of only the first.
-- Backward compatible: default empty array, existing rows and API clients are unaffected.
ALTER TABLE "PracticeRecord"
    ADD COLUMN "knowledgePointIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
