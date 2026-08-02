-- Content-addressed permanent files can be referenced by multiple immutable question versions.
DROP INDEX IF EXISTS "QuestionImportAsset_storageKey_key";
CREATE INDEX IF NOT EXISTS "QuestionImportAsset_storageKey_idx" ON "QuestionImportAsset"("storageKey");
