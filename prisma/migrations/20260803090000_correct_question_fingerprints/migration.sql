-- Correct the legacy md5(stem || options) backfill so historical questions use
-- the same canonical SHA-256 JSON payload as current application imports.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

UPDATE "Question" AS question
SET "contentFingerprint" = encode(digest(convert_to(
  '{"stem":' || to_json(question."stem")::text ||
  ',"options":' || to_json(question."options")::text ||
  ',"answer":' || to_json(question."answer")::text ||
  ',"analysis":' || to_json(question."analysis")::text ||
  ',"knowledgePointIds":' || to_json(ARRAY(
    SELECT link."knowledgePointId"
    FROM "QuestionKnowledgePoint" AS link
    WHERE link."questionId" = question."id"
    ORDER BY link."knowledgePointId"
  ))::text ||
  ',"difficulty":' || to_json(CASE question."difficulty"
    WHEN 'BASIC'::"Difficulty" THEN '鍩虹'
    WHEN 'HARD'::"Difficulty" THEN '鍥伴毦'
    ELSE '涓瓑'
  END)::text ||
  ',"type":' || to_json(CASE question."type"
    WHEN 'COMPREHENSIVE'::"QuestionType" THEN '缁煎悎棰?'
    WHEN 'JUDGEMENT'::"QuestionType" THEN '鍒ゆ柇棰?'
    ELSE '閫夋嫨棰?'
  END)::text ||
  ',"source":' || to_json(question."source")::text ||
  ',"year":' || COALESCE(to_json(question."year")::text, 'null') ||
  ',"expectedTimeSec":' || question."expectedTimeSec"::text || '}',
  'UTF8'
), 'sha256'), 'hex');
