-- V14-P0 real-exam foundation (Owner D-1..D-7 approved 2026-09-25).
-- Design: docs/v14-p0-real-exam-bank-design.md §4 (single additive nullable
-- migration; zero backfill; no enum changes — QuestionSubtype extension is
-- deliberately DEFERRED, Owner D-3).
--
-- optionAnalyses: per-wrong-option trap map for real-exam multiple choice.
--   NULL = not authored (≠ empty, ≠ "no traps") — same NULL≠0 family as
--   Question.maxScore. Shape contract lives in
--   packages/shared/src/score-center/option-analyses.ts (parseOptionAnalyses,
--   the single shape source): {version:1, traps:{<wrong-option letter>:<text>}}.
--   A key equal to the correct answer is a validation error, never stored.
--   Student pre-submission views must never carry this field (design §10.1).
--
-- examNo: the question's number within its year's 408 paper (1..47).
--   NULL = not a real-exam question / unlabelled — self-authored questions are
--   NEVER backfilled. Read-side linkage to ExamQuestion(paperId, questionNo)
--   joins on (year, examNo, isCurrent=true); no FK by design (version-chain
--   discipline, design §3 line C).
--
-- Rollback (zero data loss — both columns are additive derived content):
--   ALTER TABLE "Question" DROP COLUMN "optionAnalyses";
--   ALTER TABLE "Question" DROP COLUMN "examNo";

ALTER TABLE "Question" ADD COLUMN "optionAnalyses" JSONB;
ALTER TABLE "Question" ADD COLUMN "examNo" INTEGER;

COMMENT ON COLUMN "Question"."optionAnalyses" IS
  'V14-P0: per-wrong-option trap map {version:1, traps:{letter:text}}. NULL = not authored. Wrong-option keys only; correct-answer key is a validation error. Never shown to students before submission.';
COMMENT ON COLUMN "Question"."examNo" IS
  'V14-P0: real-exam question number within the year paper (1..47). NULL = not a real-exam question. Read-side link to ExamQuestion(paperId, questionNo) via (year, examNo, isCurrent).';
