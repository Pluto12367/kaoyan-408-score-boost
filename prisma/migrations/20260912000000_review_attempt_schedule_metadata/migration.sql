-- V12-M3-B: single-attempt schedule facts on ReviewAttempt.
--
-- Why: one review attempt could not answer the questions the M3 shadow had to
-- answer — was this a review at all, what did it come from, was it driven by an
-- existing schedule, and when was it due. `isReview` gated the authoritative
-- review writer but was never persisted, so "did this redo reach the writer" was
-- unanswerable per attempt (measured: 31/31 attempts unknown).
--
-- Additive and nullable by design. Historical rows get NULL, which every reader
-- must treat as "not recorded" rather than as `false` — the truth for those rows
-- is genuinely unknown and back-filling it would mean inventing facts.
--
-- Factual only. Deliberately NOT stored here: mastery, priority, opportunity,
-- recommendationScore or any other derived model output.
--
--   isReview       the caller's own declaration (verbatim input fact)
--   scheduleDriven whether an existing schedule row was already due at this
--                  moment (a comparison of two stored timestamps, not a score)
--   source         closed set: 'recommendation_action' when the attempt is
--                  attributed to a server-validated RecommendationAction,
--                  'wrong_question' otherwise
--   dueAt          the schedule's nextReviewAt immediately BEFORE this attempt,
--                  i.e. the time this review was due
--
-- "Which schedule" was already answerable via the existing scheduleId FK.
--
-- Rollback: ALTER TABLE "ReviewAttempt" DROP COLUMN ... for the four columns.
-- Dropping them loses only this metadata; schedule/review history, mastery and
-- the evidence ledger are untouched, so the previous behaviour is fully restored.

ALTER TABLE "ReviewAttempt"
  ADD COLUMN "isReview" BOOLEAN,
  ADD COLUMN "scheduleDriven" BOOLEAN,
  ADD COLUMN "source" TEXT,
  ADD COLUMN "dueAt" TIMESTAMP(3);
