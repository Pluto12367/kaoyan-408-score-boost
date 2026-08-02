-- Preserve source annotations and formulas on every immutable Question version.
ALTER TABLE "Question"
ADD COLUMN "formulas" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "sourceRegion" JSONB;
