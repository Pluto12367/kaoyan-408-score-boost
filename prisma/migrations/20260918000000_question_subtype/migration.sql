-- V13-P0-1 (Owner Decision v1.1 D2/D11): the 408 business question-type layer.
--
-- Additive and nullable by design: existing rows stay NULL = unknown/uncategorized,
-- which the application reads honestly (never guessed, never implicitly backfilled).
-- QuestionType is NOT touched (D1/D11): it remains the form/grading compatibility
-- layer; `type === '综合题'` grading semantics are unchanged.
--
-- Rollback: ALTER TABLE "Question" DROP COLUMN "questionSubtype"; DROP TYPE "QuestionSubtype";
-- (Dropping it loses classification metadata only; no scoring/grading data lives here.)

CREATE TYPE "QuestionSubtype" AS ENUM ('SINGLE_CHOICE', 'JUDGEMENT', 'COMPREHENSIVE_CHOICE', 'ALGORITHM', 'CO_COMPUTATION', 'OS_PV', 'CN_ROUTING');

ALTER TABLE "Question" ADD COLUMN "questionSubtype" "QuestionSubtype";
