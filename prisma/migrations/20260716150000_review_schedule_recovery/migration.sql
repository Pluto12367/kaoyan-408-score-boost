ALTER TABLE "ReviewSchedule"
ADD COLUMN "lastWrongRecordId" TEXT,
ADD COLUMN "redoCorrect" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "timeSpentSec" INTEGER NOT NULL DEFAULT 0;

WITH latest_record AS (
  SELECT DISTINCT ON (record."userId", record."questionId")
    record."userId",
    record."questionId",
    record."correct"
  FROM "PracticeRecord" AS record
  ORDER BY record."userId", record."questionId", record."submittedAt" DESC, record.xmin::text::bigint DESC, record.ctid DESC
),
latest_wrong AS (
  SELECT DISTINCT ON (record."userId", record."questionId")
    record."id",
    record."userId",
    record."questionId",
    record."timeSpentSec"
  FROM "PracticeRecord" AS record
  WHERE record."correct" = false
  ORDER BY record."userId", record."questionId", record."submittedAt" DESC, record.xmin::text::bigint DESC, record.ctid DESC
),
latest_attempt AS (
  SELECT DISTINCT ON (attempt."scheduleId")
    attempt."scheduleId",
    attempt."redoCorrect",
    attempt."timeSpentSec"
  FROM "ReviewAttempt" AS attempt
  ORDER BY attempt."scheduleId", attempt."reviewedAt" DESC, attempt."id" DESC
),
recovery_state AS (
  SELECT
    schedule."id" AS "scheduleId",
    schedule."stability",
    latest_record."correct" AS "latestCorrect",
    latest_wrong."id" AS "latestWrongRecordId",
    latest_wrong."timeSpentSec" AS "latestWrongTimeSpentSec",
    latest_attempt."redoCorrect" AS "latestRedoCorrect",
    latest_attempt."timeSpentSec" AS "latestReviewTimeSpentSec"
  FROM "ReviewSchedule" AS schedule
  LEFT JOIN latest_record
    ON latest_record."userId" = schedule."userId"
    AND latest_record."questionId" = schedule."questionId"
  LEFT JOIN latest_wrong
    ON latest_wrong."userId" = schedule."userId"
    AND latest_wrong."questionId" = schedule."questionId"
  LEFT JOIN latest_attempt ON latest_attempt."scheduleId" = schedule."id"
)
UPDATE "ReviewSchedule" AS schedule
SET
  "lastWrongRecordId" = CASE
    WHEN recovery_state."stability" = 'mastered' AND recovery_state."latestCorrect" = false THEN NULL
    ELSE recovery_state."latestWrongRecordId"
  END,
  "redoCorrect" = CASE
    WHEN recovery_state."stability" = 'mastered' AND recovery_state."latestCorrect" = false THEN false
    ELSE COALESCE(recovery_state."latestRedoCorrect", false)
  END,
  "timeSpentSec" = CASE
    WHEN recovery_state."stability" = 'mastered' AND recovery_state."latestCorrect" = false
      THEN COALESCE(recovery_state."latestWrongTimeSpentSec", 0)
    ELSE COALESCE(recovery_state."latestReviewTimeSpentSec", recovery_state."latestWrongTimeSpentSec", 0)
  END
FROM recovery_state
WHERE recovery_state."scheduleId" = schedule."id";
