-- F4 (V12): 大题采分点评分标准。
--
-- Additive and nullable by design: existing rows get NULL, which the application
-- reads as "no rubric" and handles by refusing to score rather than by awarding
-- zero. No backfill is required and no existing query changes shape.
--
-- Rollback: ALTER TABLE "Question" DROP COLUMN "rubric";
-- (Dropping it loses rubric content only; scores already recorded keep their own
--  rubric version/hash in the evidence payload, so scoring history stays
--  auditable after a rollback.)

ALTER TABLE "Question" ADD COLUMN "rubric" JSONB;
