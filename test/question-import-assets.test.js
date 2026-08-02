import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = (path) => readFile(resolve(root, path), 'utf8');

test('asset retrieval is admin-authenticated and serves the stored MIME type', async () => {
  const controller = await source('apps/api/src/questions/import/question-import.controller.ts');
  const assets = await source('apps/api/src/questions/import/import-asset.service.ts');
  const module = await source('apps/api/src/questions/questions.module.ts');

  assert.match(controller, /@Controller\('admin\/question-import-assets'\)/);
  assert.match(controller, /@Get\(':assetId'\)/);
  assert.match(controller, /assetService\.readForAdmin\(assetId\)/);
  assert.match(controller, /setHeader\('Content-Type', asset\.mediaType\)/);
  assert.match(controller, /X-Content-Type-Options/);
  assert.match(assets, /scope:\s*'temporary'/);
  assert.doesNotMatch(assets, /mimetype|mimeType.*request/i);
  assert.match(module, /QuestionImportAssetController/);
});

test('candidate crop uploads validate bytes, bind the candidate batch, and retain source coordinates', async () => {
  const controller = await source('apps/api/src/questions/import/question-import.controller.ts');
  const assets = await source('apps/api/src/questions/import/import-asset.service.ts');
  const dto = await source('apps/api/src/questions/import/dto/update-candidate.dto.ts');
  const module = await source('apps/api/src/questions/questions.module.ts');

  assert.match(controller, /@Controller\('admin\/question-import-candidates'\)/);
  assert.match(controller, /@Post\(':candidateId\/assets'\)/);
  assert.match(controller, /FileInterceptor\('file'/);
  assert.match(controller, /limits:\s*\{\s*fileSize:\s*10\s*\*\s*1024\s*\*\s*1024/);
  assert.match(assets, /image\/png/);
  assert.match(assets, /image\/jpeg/);
  assert.match(assets, /image\/webp/);
  assert.match(assets, /magic|signature/i);
  assert.match(assets, /createHash\('sha256'\)/);
  assert.match(assets, /candidate\.batchId/);
  assert.match(dto, /sourceRegion/);
  assert.match(module, /QuestionImportCandidateAssetController/);
});

test('asset deletion only removes a candidate temporary asset and confirmation copies before permanent DB ownership', async () => {
  const controller = await source('apps/api/src/questions/import/question-import.controller.ts');
  const assets = await source('apps/api/src/questions/import/import-asset.service.ts');
  const confirmation = await source('apps/api/src/questions/import/import-confirmation.service.ts');
  const integration = await source('scripts/integration-question-import.mjs');

  assert.match(controller, /@Delete\(':candidateId\/assets\/:assetId'\)/);
  assert.match(assets, /scope:\s*'temporary'/);
  assert.match(assets, /candidateId/);
  assert.match(assets, /copyToPermanent/);
  assert.match(confirmation, /preparePromotions/);
  assert.match(confirmation, /questionImportAsset\.create/);
  assert.match(confirmation, /scope:\s*'permanent'/);
  assert.doesNotMatch(confirmation, /removeTemporary\([^)]*\)[\s\S]{0,400}copyToPermanent/);
  assert.match(integration, /ImportAssetService/);
  assert.match(integration, /oldAssets\.length/);
  assert.match(integration, /promotedAssets\.length/);
  assert.match(integration, /storage\.resolveAssetPath/);
});

test('worker batch claim query does not select job columns outside the job CTE', async () => {
  const worker = await source('apps/api/src/questions/import/import-worker.service.ts');
  const batchClaimStart = worker.indexOf('const batches = await tx.$queryRaw');
  const jobClaimStart = worker.indexOf('const rows = await tx.$queryRaw');
  const batchClaim = worker.slice(batchClaimStart, jobClaimStart);

  assert.ok(batchClaimStart >= 0 && jobClaimStart > batchClaimStart);
  assert.doesNotMatch(batchClaim, /SELECT[\s\S]{0,400}job\."pageStart"/);
  assert.doesNotMatch(batchClaim, /SELECT[\s\S]{0,400}job\."pageEnd"/);
  assert.match(worker, /const claimableProviders = this\.claimableProviders\(\)/);
  assert.match(worker, /job\."provider" IN \(\$\{Prisma\.join\(claimableProviders\)\}\)/);
  assert.match(worker, /if \(this\.pdfDocuments\) providers\.push\('document-planner'\)/);
});

test('asset storage path checks allow private nested asset directories without widening escapes', async () => {
  const storage = await source('apps/api/src/questions/import/import-storage.service.ts');

  assert.match(storage, /candidate-assets/);
  assert.match(storage, /copyToPermanent/);
  assert.match(storage, /parent !== actualParent && !isContained\(parent, actualParent\)/);
  assert.match(storage, /!isContained\(parent, resolve\(path\)\)/);
});
