import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Test } = require('@nestjs/testing');
const { ValidationPipe, ForbiddenException } = require('@nestjs/common');
const { AuthService } = require('../apps/api/dist/auth/auth.service.js');
const { ImportBatchService } = require('../apps/api/dist/questions/import/import-batch.service.js');

let app;
let root;
let rejected = 0;

test.before(async () => {
  root = await mkdtemp(join(tmpdir(), 'question-import-http-'));
  process.env.QUESTION_IMPORT_DATA_DIR = root;
  process.env.QUESTION_IMPORT_WEB_ROOT = join(root, '..', 'web-root');
  const { AppModule } = require('../apps/api/dist/app.module.js');
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AuthService)
    .useValue({ requireRole: async (auth) => {
      if (auth === 'Bearer admin') return { id: 'admin-1', role: 'admin', name: 'Admin' };
      throw new ForbiddenException('forbidden');
    } })
    .overrideProvider(ImportBatchService)
    .useValue({
      create: async () => ({ batchId: 'batch-1', status: 'queued' }),
      list: async () => ({ items: [], page: 1, pageSize: 20, total: 0 }),
      detail: async () => ({ id: 'batch-1' }),
      cancel: async () => ({ status: 'cancelled' }),
      retry: async () => ({ retriedJobs: 1 }),
      recordRejection: async () => { rejected += 1; },
    })
    .compile();
  app = module.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, '127.0.0.1');
});

test.after(async () => {
  await app?.close();
  await rm(root, { recursive: true, force: true });
  delete process.env.QUESTION_IMPORT_DATA_DIR;
  delete process.env.QUESTION_IMPORT_WEB_ROOT;
});

function url(path) { return `http://127.0.0.1:${app.getHttpServer().address().port}${path}`; }
function upload(fields = {}) {
  const form = new FormData();
  form.set('file', new Blob([Buffer.from('%PDF-1.7\n')], { type: 'application/pdf' }), 'questions.pdf');
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

test('guard rejects non-admin multipart uploads before a private file is written', async () => {
  const response = await fetch(url('/admin/question-imports'), { method: 'POST', headers: { Authorization: 'Bearer student' }, body: upload({ source: 's', rightsConfirmed: 'true' }) });
  assert.equal(response.status, 403);
  assert.deepEqual(await readdir(join(root, 'incoming')), []);
});

test('ValidationPipe failure cleans the landed upload and records a safe rejection', async () => {
  const response = await fetch(url('/admin/question-imports'), { method: 'POST', headers: { Authorization: 'Bearer admin' }, body: upload({ rightsConfirmed: 'false' }) });
  assert.equal(response.status, 400);
  assert.deepEqual(await readdir(join(root, 'incoming')), []);
  assert.deepEqual(await readdir(join(root, 'temporary')), []);
  assert.ok(rejected > 0);
});

test('admin uploads return 202 and templates have format-specific headers', async () => {
  const created = await fetch(url('/admin/question-imports'), { method: 'POST', headers: { Authorization: 'Bearer admin' }, body: upload({ source: 'licensed', rightsConfirmed: 'true' }) });
  assert.equal(created.status, 202);
  assert.equal((await created.json()).batchId, 'batch-1');
  const template = await fetch(url('/admin/question-imports/templates/csv'), { headers: { Authorization: 'Bearer admin' } });
  assert.equal(template.status, 200);
  assert.match(template.headers.get('content-type'), /text\/csv/u);
  assert.match(template.headers.get('content-disposition'), /\.csv/u);
});
