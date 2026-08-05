-- CreateTable
CREATE TABLE "AssessmentHistoryItem" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT,
    "paperId" TEXT,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "score" INTEGER NOT NULL,
    "totalScore" INTEGER NOT NULL,
    "accuracyRate" INTEGER NOT NULL,
    "elapsedSec" INTEGER NOT NULL,
    "unansweredCount" INTEGER NOT NULL,
    "weakPointTitle" TEXT NOT NULL,
    "reviewSuggestion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentHistoryItem_pkey" PRIMARY KEY ("id")
);

-- Backfill valid assessment history previously stored in the generic runtime-state array.
WITH legacy_items AS (
    SELECT entry.item, entry.ordinality
    FROM "RuntimeState" AS state
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(state."value") = 'array' THEN state."value" ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS entry(item, ordinality)
    WHERE state."key" = 'assessmentHistoryItems'
), normalized AS (
    SELECT
        CASE
            WHEN jsonb_typeof(item->'id') = 'string' AND btrim(item->>'id') <> '' THEN item->>'id'
            ELSE 'assessment-history-legacy-' || md5(COALESCE(item->>'userId', '') || COALESCE(item->>'title', '') || ordinality::text)
        END AS id,
        CASE WHEN jsonb_typeof(item->'sessionId') = 'string' THEN item->>'sessionId' ELSE NULL END AS "sessionId",
        CASE WHEN jsonb_typeof(item->'paperId') = 'string' THEN item->>'paperId' ELSE NULL END AS "paperId",
        item->>'userId' AS "userId",
        btrim(item->>'title') AS title,
        CASE WHEN jsonb_typeof(item->'submittedAt') = 'string' THEN item->>'submittedAt' ELSE NULL END AS "submittedAt",
        CASE WHEN jsonb_typeof(item->'score') = 'number' THEN (item->>'score')::integer ELSE 0 END AS score,
        CASE WHEN jsonb_typeof(item->'totalScore') = 'number' THEN (item->>'totalScore')::integer ELSE 100 END AS "totalScore",
        CASE WHEN jsonb_typeof(item->'accuracyRate') = 'number' THEN (item->>'accuracyRate')::integer ELSE 0 END AS "accuracyRate",
        CASE WHEN jsonb_typeof(item->'elapsedSec') = 'number' THEN (item->>'elapsedSec')::integer ELSE 0 END AS "elapsedSec",
        CASE WHEN jsonb_typeof(item->'unansweredCount') = 'number' THEN (item->>'unansweredCount')::integer ELSE 0 END AS "unansweredCount",
        COALESCE(btrim(item->>'weakPointTitle'), '') AS "weakPointTitle",
        COALESCE(btrim(item->>'reviewSuggestion'), '') AS "reviewSuggestion"
    FROM legacy_items
    WHERE jsonb_typeof(item) = 'object'
      AND jsonb_typeof(item->'userId') = 'string'
      AND jsonb_typeof(item->'title') = 'string'
)
INSERT INTO "AssessmentHistoryItem" ("id", "sessionId", "paperId", "userId", "title", "submittedAt", "score", "totalScore", "accuracyRate", "elapsedSec", "unansweredCount", "weakPointTitle", "reviewSuggestion", "createdAt")
SELECT
    normalized.id,
    normalized."sessionId",
    normalized."paperId",
    normalized."userId",
    normalized.title,
    CASE
        WHEN normalized."submittedAt" IS NOT NULL
          AND pg_input_is_valid(normalized."submittedAt", 'timestamp with time zone')
        THEN normalized."submittedAt"::timestamp with time zone
        ELSE CURRENT_TIMESTAMP
    END,
    normalized.score,
    normalized."totalScore",
    normalized."accuracyRate",
    normalized."elapsedSec",
    normalized."unansweredCount",
    normalized."weakPointTitle",
    normalized."reviewSuggestion",
    CURRENT_TIMESTAMP
FROM normalized
INNER JOIN "User" ON "User"."id" = normalized."userId"
WHERE char_length(normalized.title) > 0
ON CONFLICT ("id") DO NOTHING;

-- CreateTable
CREATE TABLE "Paper" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "paperType" TEXT NOT NULL,
    "questionCount" INTEGER NOT NULL,
    "knowledgePointIds" TEXT[] NOT NULL,
    "questions" JSONB NOT NULL,
    "estimatedMinutes" INTEGER NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Paper_pkey" PRIMARY KEY ("id")
);

-- Backfill valid papers previously stored in the generic runtime-state array.
WITH legacy_items AS (
    SELECT entry.item, entry.ordinality
    FROM "RuntimeState" AS state
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(state."value") = 'array' THEN state."value" ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS entry(item, ordinality)
    WHERE state."key" = 'papers'
), normalized AS (
    SELECT
        item->>'id' AS id,
        btrim(item->>'title') AS title,
        COALESCE(item->>'paperType', '阶段卷') AS "paperType",
        CASE WHEN jsonb_typeof(item->'questionCount') = 'number' THEN (item->>'questionCount')::integer ELSE 0 END AS "questionCount",
        COALESCE(item->'knowledgePointIds', '[]'::jsonb) AS "knowledgePointIds",
        COALESCE(item->'questions', '[]'::jsonb) AS questions,
        CASE WHEN jsonb_typeof(item->'estimatedMinutes') = 'number' THEN (item->>'estimatedMinutes')::integer ELSE 0 END AS "estimatedMinutes",
        COALESCE(item->>'createdBy', '') AS "createdBy",
        CASE WHEN jsonb_typeof(item->'createdAt') = 'string' THEN item->>'createdAt' ELSE NULL END AS "createdAt"
    FROM legacy_items
    WHERE jsonb_typeof(item) = 'object'
      AND jsonb_typeof(item->'id') = 'string'
      AND btrim(item->>'id') <> ''
)
INSERT INTO "Paper" ("id", "title", "paperType", "questionCount", "knowledgePointIds", "questions", "estimatedMinutes", "createdBy", "createdAt")
SELECT
    normalized.id,
    normalized.title,
    normalized."paperType",
    normalized."questionCount",
    ARRAY(SELECT jsonb_array_elements_text(normalized."knowledgePointIds")),
    normalized.questions,
    normalized."estimatedMinutes",
    normalized."createdBy",
    CASE
        WHEN normalized."createdAt" IS NOT NULL
          AND pg_input_is_valid(normalized."createdAt", 'timestamp with time zone')
        THEN normalized."createdAt"::timestamp with time zone
        ELSE CURRENT_TIMESTAMP
    END
FROM normalized
WHERE char_length(normalized.title) > 0
ON CONFLICT ("id") DO NOTHING;

-- CreateTable
CREATE TABLE "SystemConfig" (
    "id" SERIAL NOT NULL,
    "recommendation" JSONB NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("id")
);

-- Backfill the system configuration previously stored in the generic runtime-state object.
INSERT INTO "SystemConfig" ("recommendation", "updatedBy", "updatedAt")
SELECT
    COALESCE(state."value"->'recommendation', '{}'::jsonb),
    COALESCE(state."value"->>'updatedBy', 'system'),
    CASE
        WHEN jsonb_typeof(state."value"->'updatedAt') = 'string'
          AND pg_input_is_valid(state."value"->>'updatedAt', 'timestamp with time zone')
        THEN (state."value"->>'updatedAt')::timestamp with time zone
        ELSE CURRENT_TIMESTAMP
    END
FROM "RuntimeState" AS state
WHERE state."key" = 'systemConfig'
  AND jsonb_typeof(state."value") = 'object';

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentHistoryItem_sessionId_key" ON "AssessmentHistoryItem"("sessionId");

-- CreateIndex
CREATE INDEX "AssessmentHistoryItem_userId_submittedAt_idx" ON "AssessmentHistoryItem"("userId", "submittedAt");

-- CreateIndex
CREATE INDEX "Paper_createdBy_createdAt_idx" ON "Paper"("createdBy", "createdAt");

-- AddForeignKey
ALTER TABLE "AssessmentHistoryItem" ADD CONSTRAINT "AssessmentHistoryItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
