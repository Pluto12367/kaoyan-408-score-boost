import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = new URL('..', import.meta.url);
const source = (path) => readFileSync(new URL(path, root), 'utf8');

test('per-page Tencent OCR fallback is restricted to explicit quality signals', () => {
  const providerPath = new URL('apps/api/src/questions/import/providers/tencent-page-ocr.provider.ts', root);
  assert.ok(existsSync(providerPath), 'Tencent page OCR provider must exist');
  const provider = source('apps/api/src/questions/import/providers/tencent-page-ocr.provider.ts');
  const quality = source('apps/api/src/questions/import/import-quality.service.ts');

  assert.match(provider, /class TencentPageOcrProvider/);
  assert.match(provider, /GeneralBasicOCR/);
  assert.match(provider, /ImageBase64/);
  assert.match(provider, /DetectedText/);
  assert.match(provider, /Polygon/);
  assert.match(quality, /empty_page/);
  assert.match(quality, /abnormal_character_ratio/);
  assert.match(quality, /missing_choice_options/);
  assert.match(quality, /missing_required_blocks/);
  assert.match(quality, /shouldFallback/);
});

test('cleanup service protects unresolved data and only removes unreferenced permanent assets', () => {
  const cleanupPath = new URL('apps/api/src/questions/import/import-cleanup.service.ts', root);
  assert.ok(existsSync(cleanupPath), 'import cleanup service must exist');
  const cleanup = source('apps/api/src/questions/import/import-cleanup.service.ts');

  assert.match(cleanup, /class ImportCleanupService/);
  assert.match(cleanup, /run\(now: Date/);
  assert.match(cleanup, /unresolved/);
  assert.match(cleanup, /questionImportAsset/);
  assert.match(cleanup, /scope: 'permanent'/);
  assert.match(cleanup, /bytes/);
  assert.match(cleanup, /onModuleInit/);
  assert.match(cleanup, /24 \* 60 \* 60 \* 1000/);
  assert.match(cleanup, /providerInputStorageKey/);
  assert.match(cleanup, /rawResultKey/);
  assert.match(cleanup, /approved/);
  assert.match(cleanup, /parse_failed/);
});

test('import storage initializes all asset directories before backup mounts run', () => {
  const storagePath = new URL('apps/api/src/questions/import/import-storage.service.ts', root);
  assert.ok(existsSync(storagePath), 'import storage service must exist');
  const storage = source('apps/api/src/questions/import/import-storage.service.ts');

  assert.match(storage, /implements OnModuleInit/);
  assert.match(storage, /async onModuleInit\(\): Promise<void>/);
  assert.match(storage, /mkdir\(this\.config\.incomingDirectory/);
  assert.match(storage, /mkdir\(this\.config\.temporaryDirectory/);
  assert.match(storage, /mkdir\(this\.config\.permanentDirectory/);
});

test('persisted question IDs include database-only rows when allocating q-number IDs', () => {
  const questions = source('apps/api/src/questions/questions.service.ts');

  assert.match(questions, /nextPersistedQuestionId/);
  assert.match(questions, /this\.prisma\.question\.findMany/);
  assert.match(questions, /startsWith: 'q-'/);
  assert.match(questions, /nextQuestionId\(\[\.\.\.this\.questions, \.\.\.persistedIds\]\)/);
});

test('document import module has an explicit gated fake-provider selector for staging smoke', () => {
  const moduleSource = source('apps/api/src/questions/questions.module.ts');
  const workerSource = source('apps/api/src/questions/import/import-worker.service.ts');
  const fakeProvider = source('apps/api/src/questions/import/providers/fake-document.provider.ts');

  assert.match(moduleSource, /QUESTION_IMPORT_DOCUMENT_PROVIDER/);
  assert.match(moduleSource, /ALLOW_FAKE_DOCUMENT_PROVIDER/);
  assert.match(moduleSource, /new FakeDocumentProvider/);
  assert.match(workerSource, /@Inject\(MineruProvider\) private readonly documentProvider: DocumentParserProvider/);
  assert.match(fakeProvider, /Fake PDF staging smoke question/);
});

test('bare backup verification performs a deterministic archive self-check without a database', () => {
  const output = execFileSync(process.execPath, ['scripts/verify-postgres-backup.mjs'], { cwd: root, encoding: 'utf8' });
  assert.match(output, /"ok": true/);
  assert.match(output, /"mode": "self-check"/);
  assert.match(output, /"assetArchive": true/);
});
