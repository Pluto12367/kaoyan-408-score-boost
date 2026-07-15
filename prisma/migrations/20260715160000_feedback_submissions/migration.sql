-- CreateTable
CREATE TABLE "FeedbackSubmission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "scene" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeedbackSubmission_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FeedbackSubmission_rating_check" CHECK ("rating" BETWEEN 1 AND 5),
    CONSTRAINT "FeedbackSubmission_scene_check" CHECK ("scene" IN ('diagnostic', 'today_plan', 'practice', 'mistakes', 'exam', 'overall')),
    CONSTRAINT "FeedbackSubmission_status_check" CHECK ("status" IN ('new', 'reviewed')),
    CONSTRAINT "FeedbackSubmission_message_length_check" CHECK (char_length("message") BETWEEN 1 AND 1000)
);

-- Backfill valid feedback previously stored in the generic runtime-state array.
WITH legacy_items AS (
    SELECT entry.item, entry.ordinality
    FROM "RuntimeState" AS state
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(state."value") = 'array' THEN state."value" ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS entry(item, ordinality)
    WHERE state."key" = 'feedbackItems'
), normalized AS (
    SELECT
        CASE
            WHEN jsonb_typeof(item->'id') = 'string' AND btrim(item->>'id') <> '' THEN item->>'id'
            ELSE 'feedback-legacy-' || md5(COALESCE(item->>'userId', '') || COALESCE(item->>'message', '') || ordinality::text)
        END AS id,
        item->>'userId' AS "userId",
        CASE
            WHEN jsonb_typeof(item->'rating') = 'number' AND (item->>'rating') ~ '^[1-5]$' THEN (item->>'rating')::integer
            ELSE 5
        END AS rating,
        CASE
            WHEN item->>'scene' IN ('diagnostic', 'today_plan', 'practice', 'mistakes', 'exam', 'overall') THEN item->>'scene'
            ELSE 'overall'
        END AS scene,
        btrim(item->>'message') AS message,
        CASE WHEN item->>'status' = 'reviewed' THEN 'reviewed' ELSE 'new' END AS status,
        CASE WHEN jsonb_typeof(item->'createdAt') = 'string' THEN item->>'createdAt' ELSE NULL END AS "createdAt"
    FROM legacy_items
    WHERE jsonb_typeof(item) = 'object'
      AND jsonb_typeof(item->'userId') = 'string'
      AND jsonb_typeof(item->'message') = 'string'
)
INSERT INTO "FeedbackSubmission" ("id", "userId", "rating", "scene", "message", "status", "createdAt", "updatedAt")
SELECT
    normalized.id,
    normalized."userId",
    normalized.rating,
    normalized.scene,
    normalized.message,
    normalized.status,
    CASE
        WHEN normalized."createdAt" IS NOT NULL
          AND pg_input_is_valid(normalized."createdAt", 'timestamp with time zone')
        THEN normalized."createdAt"::timestamp with time zone
        ELSE CURRENT_TIMESTAMP
    END,
    CURRENT_TIMESTAMP
FROM normalized
INNER JOIN "User" ON "User"."id" = normalized."userId"
WHERE char_length(normalized.message) BETWEEN 1 AND 1000
ON CONFLICT ("id") DO NOTHING;

-- CreateIndex
CREATE INDEX "FeedbackSubmission_userId_createdAt_idx" ON "FeedbackSubmission"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "FeedbackSubmission_status_createdAt_idx" ON "FeedbackSubmission"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "FeedbackSubmission" ADD CONSTRAINT "FeedbackSubmission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
