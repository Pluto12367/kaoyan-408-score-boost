import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = (path) => readFile(resolve(root, path), 'utf8');

test('admin import controller keeps uploads private, disk-backed, and admin-only', async () => {
  const controller = await source('apps/api/src/questions/import/question-import.controller.ts');
  const mainController = controller.slice(controller.indexOf("@Controller('admin/question-imports')"), controller.indexOf("@Controller('admin/question-import-assets')"));

  assert.match(controller, /@Controller\('admin\/question-imports'\)/);
  assert.match(controller, /@UseGuards\(RoleGuard\)/);
  assert.match(controller, /@Roles\('admin'\)/);
  assert.match(mainController, /FileInterceptor\('file',[\s\S]*diskStorage/);
  assert.match(mainController, /randomUUID|randomBytes/);
  assert.doesNotMatch(mainController, /memoryStorage/);
  assert.match(mainController, /@HttpCode\(HttpStatus\.ACCEPTED\)/);
  assert.match(mainController, /templates\/:format/);
  assert.match(controller, /QuestionImportCandidateAssetController[\s\S]*memoryStorage/);
});

test('import configuration has private containment and safe capacity defaults', async () => {
  const config = await source('apps/api/src/questions/import/import-config.ts');

  assert.match(config, /maxPdfBytes:\s*500\s*\*\s*1024\s*\*\s*1024/);
  assert.match(config, /maxTableBytes:\s*50\s*\*\s*1024\s*\*\s*1024/);
  assert.match(config, /temporaryQuotaBytes:\s*10\s*\*\s*1024\s*\*\s*1024\s*\*\s*1024/);
  assert.match(config, /diskStopPercent:\s*80/);
  assert.match(config, /resolve\(/);
  assert.match(config, /relative\(/);
  assert.match(config, /incoming/);
  assert.match(config, /temporary/);
  assert.match(config, /permanent/);
  assert.match(config, /web root|webRoot|WEB_ROOT/i);
});

test('storage validates extension and content signatures without trusting client mime type', async () => {
  const storage = await source('apps/api/src/questions/import/import-storage.service.ts');
  const uploadValidation = storage.slice(storage.indexOf('private async hashAndValidate'), storage.indexOf('private async assertXlsx'));

  assert.match(storage, /\.pdf/);
  assert.match(storage, /\.xlsx/);
  assert.match(storage, /\.csv/);
  assert.match(storage, /%PDF-/);
  assert.match(storage, /createReadStream/);
  assert.match(storage, /\bopen\(/);
  assert.match(storage, /readCentralDirectory/);
  assert.match(storage, /readExactly/);
  assert.match(storage, /TextDecoder\('utf-8', \{ fatal: true \}\)/);
  assert.match(storage, /NUL|\\0|0x00/);
  assert.match(storage, /createHash\('sha256'\)/);
  assert.match(storage, /relative\(/);
  assert.doesNotMatch(storage, /mimetype|mimeType/);
  assert.doesNotMatch(uploadValidation, /JSZip|readFile/);
  assert.doesNotMatch(storage, /removeIncomingIfSafe[\s\S]*\(pdf\|xlsx\|csv\)/);
});

test('batch service creates pending work transactionally and protects retry and audit metadata', async () => {
  const service = await source('apps/api/src/questions/import/import-batch.service.ts');
  const auditService = await source('apps/api/src/operations/audit-event.service.ts');
  const dto = await source('apps/api/src/questions/import/dto/create-import-batch.dto.ts');

  assert.match(dto, /source!:\s*string/);
  assert.match(dto, /rightsConfirmed!:\s*boolean/);
  assert.match(dto, /@IsNotEmpty\(\)/);
  assert.match(dto, /@IsBoolean\(\)/);
  assert.match(service, /\$transaction/);
  assert.match(service, /rightsConfirmedAt/);
  assert.match(service, /state:\s*pdfParserUnavailable \? 'failed' : 'pending'/);
  assert.match(service, /status:\s*pdfParserUnavailable \? 'failed' : 'queued'/);
  assert.match(service, /MAX_PAGE_SIZE\s*=\s*100/);
  assert.match(service, /Math\.min\([^\n]*MAX_PAGE_SIZE/);
  assert.match(service, /updateMany/);
  assert.match(service, /attempt:\s*\{\s*increment:\s*1\s*\}/);
  assert.match(service, /AuditEventService/);
  assert.match(service, /auditEvents\.record\([\s\S]*, tx\)/);
  assert.match(auditService, /\(tx \?\? this\.prisma\)\.auditEvent\.create/);
  assert.doesNotMatch(service, /stem\s*:/);
  assert.match(service, /fileSha256/);
  assert.match(service, /byteSize/);
});
