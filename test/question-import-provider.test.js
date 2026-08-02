import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FakeDocumentProvider } from '../apps/api/dist/questions/import/providers/fake-document.provider.js';
import { MineruProvider } from '../apps/api/dist/questions/import/providers/mineru.provider.js';
import { ImportQualityService } from '../apps/api/dist/questions/import/import-quality.service.js';
import { ImportWorkerService } from '../apps/api/dist/questions/import/import-worker.service.js';
import { ImportBatchService } from '../apps/api/dist/questions/import/import-batch.service.js';
import { ImportStorageService } from '../apps/api/dist/questions/import/import-storage.service.js';
import { TencentPageOcrProvider } from '../apps/api/dist/questions/import/providers/tencent-page-ocr.provider.js';
import { PDFDocument } from 'pdf-lib';

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
  const failedTask = (await failed.submit(input)).externalTaskId;

  assert.deepEqual(await failed.poll(failedTask), { state: 'failed', code: 'UPSTREAM_FAILED', retryable: true, message: 'provider unavailable' });
  assert.deepEqual(await timedOut.poll((await timedOut.submit(input)).externalTaskId), { state: 'failed', code: 'DOCUMENT_PARSE_TIMEOUT', retryable: true, message: 'Document parsing timed out' });
  await assert.rejects(failed.fetchResult(failedTask), /DOCUMENT_PARSE_NOT_SUCCEEDED/u);
});

test('MinerU adapter persists the async submission handle before polling, then normalizes blocks', async () => {
  const submitCalls = [];
  let getTaskCalls = 0;
  const result = { taskId: 'mineru-task-1', state: 'done', filename: 'split.pdf', contentList: [{ page_idx: 0, page_size: [1000, 2000], type: 'text', text: 'Question text', bbox: [100, 200, 500, 600] }], images: [], _zipBytes: Uint8Array.from([1, 2]) };
  const provider = new MineruProvider('test-token', {
    resolveSource: async () => '/private/split.pdf',
    persistRaw: async () => 'provider/11111111-1111-1111-1111-111111111111.json',
    createClient: (token) => ({
      submit: async (source, options) => { submitCalls.push({ token, source, options }); return result.taskId; },
      getTask: async () => { getTaskCalls += 1; return result; },
    }),
  });
  const externalTaskId = (await provider.submit(input)).externalTaskId;

  assert.equal(externalTaskId, result.taskId);
  assert.equal(getTaskCalls, 0, 'submit must return the durable provider handle without polling to completion');
  assert.deepEqual(await provider.poll(externalTaskId), { state: 'succeeded' });
  const document = await provider.fetchResult(externalTaskId);
  assert.deepEqual(submitCalls, [{ token: 'test-token', source: '/private/split.pdf', options: { model: 'vlm' } }]);
  assert.equal(getTaskCalls, 1);
  assert.equal(document.provider, 'mineru');
  assert.equal(document.pages[0].blocks[0].kind, 'text');
  assert.deepEqual(document.pages[0].blocks[0].region, { x: 0.1, y: 0.1, width: 0.4, height: 0.2 });
  assert.match(document.rawResultKey, /^provider\//u);
});

test('MinerU receives an existing private split PDF path and persists raw artifacts privately', async () => {
  const root = await mkdtemp(join(tmpdir(), 'question-import-provider-'));
  const temporaryDirectory = join(root, 'temporary');
  const incomingDirectory = join(root, 'incoming');
  const permanentDirectory = join(root, 'permanent');
  await Promise.all([mkdir(temporaryDirectory), mkdir(incomingDirectory), mkdir(permanentDirectory)]);
  const id = '11111111-1111-1111-1111-111111111111';
  const sourceDocument = await PDFDocument.create();
  for (let pageNumber = 1; pageNumber <= 6; pageNumber += 1) sourceDocument.addPage([100 + pageNumber, 200 + pageNumber]);
  await writeFile(join(temporaryDirectory, id), await sourceDocument.save());
  const storage = new ImportStorageService({ dataDirectory: root, temporaryDirectory, incomingDirectory, permanentDirectory, maxPdfBytes: 1024, maxTableBytes: 1024, temporaryQuotaBytes: 1024, diskStopPercent: 80 });
  let source;
  const split = await storage.createProviderSplitArtifact(`temporary/${id}`, 4, 6);
  const provider = new MineruProvider('test-token', {
    resolveSource: (job) => storage.resolveProviderSplitPdfPath(job.storageKey, job.pageStart, job.pageEnd),
    persistRaw: (result) => storage.putProviderArtifacts(result),
    createClient: () => ({
      submit: async (path) => { source = path; return 'task-2'; },
      getTask: async () => ({ taskId: 'task-2', state: 'done', filename: 'split.pdf', contentList: [], images: [], _zipBytes: Uint8Array.from([1]) }),
    }),
  });
  const taskId = (await provider.submit({ ...input, storageKey: split.storageKey, pageStart: 4, pageEnd: 6 })).externalTaskId;
  await provider.poll(taskId);
  const document = await provider.fetchResult(taskId);

  assert.notEqual(source, input.storageKey);
  assert.notEqual(source, join(temporaryDirectory, id));
  assert.equal(existsSync(source), true);
  assert.deepEqual(await storage.readProviderSplitMetadata(split.storageKey), { pageStart: 4, pageEnd: 6 });
  const splitDocument = await PDFDocument.load(await readFile(source));
  assert.equal(splitDocument.getPageCount(), 3);
  assert.deepEqual(splitDocument.getPages().map((page) => page.getSize().width), [104, 105, 106]);
  await assert.rejects(storage.createProviderSplitArtifact(`temporary/${id}`, 6, 7), /page range/u);
  assert.match(document.rawResultKey, /^provider\/[a-f0-9-]{36}\.json$/u);
});

test('quality service flags pages with no text blocks for fallback', () => {
  const quality = new ImportQualityService();
  assert.deepEqual(quality.assess([]), { score: 0, signals: ['empty_page'] });
  assert.equal(quality.needsFallback({ score: 0, signals: ['empty_page'] }), true);
});

test('Tencent page OCR sends a rendered JPEG once and maps text polygons without cloud calls', async () => {
  const calls = [];
  const provider = new TencentPageOcrProvider('secret-id', 'secret-key', 'ap-shanghai', {
    readPage: async () => Buffer.from('jpeg'),
    createClient: (secretId, secretKey, region) => ({
      GeneralBasicOCR: async (request) => {
        calls.push({ secretId, secretKey, region, request });
        return { TextDetections: [{ DetectedText: '题干文字', Confidence: 98, Polygon: [{ X: 10, Y: 20 }, { X: 60, Y: 20 }, { X: 60, Y: 80 }, { X: 10, Y: 80 }] }] };
      },
    }),
  });
  const page = await provider.recognize('/private/page.jpg', 3, 100, 100);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].request.ImageBase64, Buffer.from('jpeg').toString('base64'));
  assert.equal(page.pageNumber, 3);
  assert.deepEqual(page.blocks[0].region, { x: 0.1, y: 0.2, width: 0.5, height: 0.6 });
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

  assert.equal(batchFailure.status, 'parsing_partial_failure');
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
