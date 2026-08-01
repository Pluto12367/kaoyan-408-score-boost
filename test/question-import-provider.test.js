import assert from 'node:assert/strict';
import test from 'node:test';

import { FakeDocumentProvider } from '../apps/api/dist/questions/import/providers/fake-document.provider.js';
import { MineruProvider } from '../apps/api/dist/questions/import/providers/mineru.provider.js';
import { ImportQualityService } from '../apps/api/dist/questions/import/import-quality.service.js';
import { ImportWorkerService } from '../apps/api/dist/questions/import/import-worker.service.js';
import { ImportBatchService } from '../apps/api/dist/questions/import/import-batch.service.js';

const input = { jobId: 'job-1', storageKey: 'temporary/11111111-1111-1111-1111-111111111111', fileName: 'sample.pdf', pageStart: 1, pageEnd: 2 };

test('fake document provider reports queued, running, and succeeded states without external calls', async () => {
  const provider = new FakeDocumentProvider({ states: ['queued', 'running', 'succeeded'] });
  const { externalTaskId } = await provider.submit(input);

  assert.deepEqual(await provider.poll(externalTaskId), { state: 'queued', retryAfterMs: 100 });
  assert.deepEqual(await provider.poll(externalTaskId), { state: 'running', retryAfterMs: 100 });
  assert.deepEqual(await provider.poll(externalTaskId), { state: 'succeeded' });
  assert.equal((await provider.fetchResult(externalTaskId)).pages[0].pageNumber, 1);
});

test('fake document provider exposes failed and timeout outcomes as safe poll failures', async () => {
  const failed = new FakeDocumentProvider({ states: ['failed'], failure: { code: 'UPSTREAM_FAILED', retryable: true, message: 'provider unavailable' } });
  const timedOut = new FakeDocumentProvider({ states: ['timeout'] });

  assert.deepEqual(await failed.poll((await failed.submit(input)).externalTaskId), { state: 'failed', code: 'UPSTREAM_FAILED', retryable: true, message: 'provider unavailable' });
  assert.deepEqual(await timedOut.poll((await timedOut.submit(input)).externalTaskId), { state: 'failed', code: 'DOCUMENT_PARSE_TIMEOUT', retryable: true, message: 'Document parsing timed out' });
});

test('MinerU adapter calls the SDK with vlm and a 600 second timeout, then normalizes blocks', async () => {
  const calls = [];
  const provider = new MineruProvider('test-token', {
    resolveSource: async () => '/private/split.pdf',
    createClient: (token) => ({ extract: async (source, options) => {
      calls.push({ token, source, options });
      return { taskId: 'mineru-task-1', state: 'done', filename: 'split.pdf', contentList: [{ page_idx: 0, page_size: [1000, 2000], type: 'text', text: 'Question text', bbox: [100, 200, 500, 600] }], images: [], _zipBytes: Uint8Array.from([1, 2]) };
    } }),
  });
  const externalTaskId = (await provider.submit(input)).externalTaskId;

  assert.deepEqual(await provider.poll(externalTaskId), { state: 'succeeded' });
  const document = await provider.fetchResult(externalTaskId);
  assert.deepEqual(calls, [{ token: 'test-token', source: '/private/split.pdf', options: { model: 'vlm', timeout: 600 } }]);
  assert.equal(document.provider, 'mineru');
  assert.equal(document.pages[0].blocks[0].kind, 'text');
  assert.deepEqual(document.pages[0].blocks[0].region, { x: 0.1, y: 0.1, width: 0.4, height: 0.2 });
  assert.match(document.rawResultKey, /^mineru\//u);
});

test('quality service flags pages with no text blocks for fallback', () => {
  const quality = new ImportQualityService();
  assert.deepEqual(quality.assess([]), { score: 0, signals: ['empty_page'] });
  assert.equal(quality.needsFallback({ score: 0, signals: ['empty_page'] }), true);
});

test('PDF jobs fail safely with an administrator message when MinerU credentials are absent', async () => {
  let batchFailure;
  let jobFailure;
  const job = {
    id: 'pdf-job-1',
    batchId: 'pdf-batch-1',
    provider: 'document-parser',
    originalFileName: 'questions.pdf',
    originalStorageKey: 'temporary/pdf',
    fileType: 'pdf',
    source: 'legal pdf source',
    defaultSubject: null,
    defaultChapter: null,
    leaseOwner: 'worker-a',
    leaseExpiresAt: new Date(Date.now() + 60_000),
  };
  const prisma = {
    $transaction: async (operation) => operation({
      questionImportBatch: {
        updateMany: async ({ data }) => { batchFailure = data; return { count: 1 }; },
      },
      questionImportJob: {
        updateMany: async ({ data }) => { jobFailure = data; return { count: 1 }; },
      },
    }),
  };
  const worker = new ImportWorkerService(prisma, {}, {}, { workerId: 'worker-a' }, {}, new MineruProvider('', {
    resolveSource: async () => '/private/questions.pdf',
  }));

  await worker.runOnceWithJob(job);

  assert.equal(batchFailure.status, 'failed');
  assert.deepEqual(batchFailure.statusCounts, { failed: 1 });
  assert.equal(jobFailure.state, 'failed');
  assert.equal(jobFailure.error.code, 'PDF_PARSER_NOT_CONFIGURED');
  assert.match(jobFailure.error.message, /PDF/u);
  assert.match(jobFailure.error.requestId, /^[0-9a-f-]{36}$/u);
});

test('PDF sample gate records a safe configuration failure while Excel remains queued', async () => {
  const originalToken = process.env.MINERU_API_TOKEN;
  delete process.env.MINERU_API_TOKEN;
  const created = [];
  const prisma = { $transaction: async (operation) => operation({ questionImportBatch: { create: async ({ data }) => { created.push(data); return { id: `batch-${created.length}`, status: data.status }; } } }) };
  const service = new ImportBatchService(prisma, { record: async () => undefined });
  try {
    await service.create('admin-1', { source: 'licensed sample', rightsConfirmed: true }, { originalFileName: 'sample.pdf', storageKey: 'temporary/sample', fileSha256: 'a'.repeat(64), fileType: 'pdf', byteSize: 1 });
    await service.create('admin-1', { source: 'licensed sheet', rightsConfirmed: true }, { originalFileName: 'sample.csv', storageKey: 'temporary/sheet', fileSha256: 'b'.repeat(64), fileType: 'csv', byteSize: 1 });
  } finally {
    if (originalToken === undefined) delete process.env.MINERU_API_TOKEN;
    else process.env.MINERU_API_TOKEN = originalToken;
  }
  assert.equal(created[0].status, 'failed');
  assert.match(created[0].jobs.create.error.message, /PDF 解析服务尚未配置/u);
  assert.match(created[0].jobs.create.error.requestId, /^[0-9a-f-]{36}$/u);
  assert.equal(created[1].status, 'queued');
});
