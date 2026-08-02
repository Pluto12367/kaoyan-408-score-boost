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
const { ImportCandidateService } = require('../apps/api/dist/questions/import/import-candidate.service.js');

let app;
let root;
let rejected = 0;
let candidateCalls = [];

test.before(async () => {
  root = await mkdtemp(join(tmpdir(), 'question-import-http-'));
  process.env.QUESTION_IMPORT_DATA_DIR = root;
  process.env.QUESTION_IMPORT_WEB_ROOT = join(root, '..', 'web-root');
  process.env.QUESTION_IMPORT_DISK_STOP_PERCENT = '100';
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
    .overrideProvider(ImportCandidateService)
    .useValue({
      list: async (...args) => { candidateCalls.push(['list', ...args]); return { items: [], page: 1, pageSize: 20, total: 0 }; },
      update: async (...args) => { candidateCalls.push(['update', ...args]); return { id: 'candidate-1', revision: 2 }; },
      bulkApprove: async (...args) => { candidateCalls.push(['bulk', ...args]); return { approvedCandidates: 1 }; },
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
  delete process.env.QUESTION_IMPORT_DISK_STOP_PERCENT;
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

test('candidate routes validate pagination, revisions, and bounded bulk input', async () => {
  candidateCalls = [];
  const headers = { Authorization: 'Bearer admin', 'Content-Type': 'application/json' };
  const listed = await fetch(url('/admin/question-imports/batch-1/candidates?page=1&pageSize=20&status=pending_review'), { headers });
  assert.equal(listed.status, 200);
  assert.deepEqual(candidateCalls[0], ['list', 'batch-1', { status: 'pending_review' }, { page: 1, pageSize: 20 }]);

  const missingRevision = await fetch(url('/admin/question-imports/candidates/candidate-1'), {
    method: 'PATCH', headers, body: JSON.stringify({ stem: 'updated' }),
  });
  assert.equal(missingRevision.status, 400);

  const updated = await fetch(url('/admin/question-imports/candidates/candidate-1'), {
    method: 'PATCH', headers, body: JSON.stringify({ revision: 1, patch: { status: 'ignored' } }),
  });
  assert.equal(updated.status, 200);
  assert.deepEqual(candidateCalls[1], ['update', 'candidate-1', 1, { status: 'ignored' }, 'admin-1']);

  const tooMany = await fetch(url('/admin/question-imports/batch-1/candidates/bulk-approve'), {
    method: 'POST', headers, body: JSON.stringify({
      candidates: Array.from({ length: 101 }, (_, index) => ({ id: `candidate-${index}`, revision: 0 })),
    }),
  });
  assert.equal(tooMany.status, 400);

  const approved = await fetch(url('/admin/question-imports/batch-1/candidates/bulk-approve'), {
    method: 'POST', headers, body: JSON.stringify({ candidates: [{ id: 'candidate-1', revision: 3 }] }),
  });
  assert.equal(approved.status, 201);
  assert.equal(candidateCalls[2][0], 'bulk');
  assert.equal(candidateCalls[2][1], 'batch-1');
  assert.deepEqual(candidateCalls[2][2].map(({ id, revision }) => ({ id, revision })), [{ id: 'candidate-1', revision: 3 }]);
  assert.equal(candidateCalls[2][3], 'admin-1');

  const invalidStatus = await fetch(url('/admin/question-imports/batch-1/candidates?status=not-a-status'), { headers });
  assert.equal(invalidStatus.status, 400);
  const oversizedPage = await fetch(url('/admin/question-imports/batch-1/candidates?pageSize=101'), { headers });
  assert.equal(oversizedPage.status, 400);
  const malformedPatch = await fetch(url('/admin/question-imports/candidates/candidate-1'), {
    method: 'PATCH', headers, body: JSON.stringify({ revision: 1, patch: { options: 'not-an-array' } }),
  });
  assert.equal(malformedPatch.status, 400);
});
