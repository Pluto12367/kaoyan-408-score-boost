import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { finished } from 'node:stream/promises';

import { QuestionStructureService } from '../apps/api/dist/questions/import/question-structure.service.js';
import { splitPageRanges } from '../apps/api/dist/questions/import/pdf-document.service.js';
import { ImportWorkerService } from '../apps/api/dist/questions/import/import-worker.service.js';
import { MineruProvider } from '../apps/api/dist/questions/import/providers/mineru.provider.js';
import { ImportBatchService } from '../apps/api/dist/questions/import/import-batch.service.js';
import { QuestionImportController } from '../apps/api/dist/questions/import/question-import.controller.js';

test('PDF page ranges preserve global page numbers at the 200 page boundary', () => {
  assert.deepEqual(splitPageRanges(401), [
    { pageStart: 1, pageEnd: 200 },
    { pageStart: 201, pageEnd: 400 },
    { pageStart: 401, pageEnd: 401 },
  ]);
});

test('structure service keeps cross-page analysis with its numbered question and preserves formulas', () => {
  const service = new QuestionStructureService();
  const candidates = service.structure({
    provider: 'mineru', model: 'test', pages: [
      { pageNumber: 20, width: 100, height: 100, quality: { score: 1, signals: [] }, blocks: [
        { kind: 'text', text: '1. What is 1 + 1?\nA. 1\nB. 2\nAnswer: B', region: { x: 0, y: 0, width: 1, height: 0.6 } },
        { kind: 'formula', latex: '1+1=2', region: { x: 0.1, y: 0.6, width: 0.2, height: 0.1 } },
      ] },
      { pageNumber: 21, width: 100, height: 100, quality: { score: 1, signals: [] }, blocks: [
        { kind: 'text', text: 'Analysis: addition gives two.\n2. Select the valid option.\nA. Yes\nB. No\nAnswer: A', region: { x: 0, y: 0, width: 1, height: 0.8 } },
      ] },
    ],
  });

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].pageNumber, 20);
  assert.match(candidates[0].analysis, /addition gives two/u);
  assert.deepEqual(candidates[0].formulas.map((formula) => formula.latex), ['1+1=2']);
  assert.ok(candidates[0].warnings.some((warning) => warning.code === 'CROSS_PAGE_OWNERSHIP_UNCERTAIN'));
  assert.equal(candidates[1].pageNumber, 21);
});

test('an oversized single PDF page is recorded while sibling page ranges remain processable', async () => {
  const now = new Date('2026-08-01T00:00:00.000Z');
  const childJobs = [];
  let plannerUpdate;
  let batchUpdate;
  const pdf = {
    pageCount: async () => 3,
    split: async (_storageKey, [range]) => [{
      storageKey: `provider-split/${range.pageStart}-${range.pageEnd}`,
      sha256: 'a'.repeat(64),
      mediaType: 'application/pdf',
      byteSize: range.pageStart === 1 ? 201 * 1024 * 1024 : 1024,
      ...range,
    }],
  };
  const prisma = {
    $transaction: async (operation) => operation({
      questionImportJob: {
        createMany: async ({ data }) => { childJobs.push(...data); return { count: data.length }; },
        updateMany: async ({ data }) => { plannerUpdate = data; return { count: 1 }; },
      },
      questionImportBatch: { update: async ({ data }) => { batchUpdate = data; } },
    }),
  };
  const worker = new ImportWorkerService(
    prisma, {}, {}, { autoStart: false, now: () => now }, {}, undefined, pdf,
  );
  const job = {
    id: 'planner-1', batchId: 'batch-1', provider: 'document-planner', pageStart: 1, pageEnd: 1,
    originalFileName: 'questions.pdf', originalStorageKey: 'temporary/questions', fileType: 'pdf',
    source: 'licensed questions', leaseOwner: 'worker-1', leaseExpiresAt: new Date(now.getTime() + 60_000),
  };

  const result = await worker.processClaimedJob(job);

  assert.deepEqual(childJobs.map(({ pageStart, pageEnd }) => ({ pageStart, pageEnd })), [
    { pageStart: 2, pageEnd: 2 },
    { pageStart: 3, pageEnd: 3 },
  ]);
  assert.equal(plannerUpdate.state, 'succeeded');
  assert.equal(plannerUpdate.error.code, 'PDF_PAGE_TOO_LARGE');
  assert.deepEqual(plannerUpdate.error.failures, [{ code: 'PDF_PAGE_TOO_LARGE', pageStart: 1, pageEnd: 1 }]);
  assert.equal(batchUpdate.status, 'parsing_partial_failure');
  assert.deepEqual(batchUpdate.statusCounts, { document_planned: 1, document_pending: 2, failed: 1 });
  assert.deepEqual(result.statusCounts, batchUpdate.statusCounts);
});

test('MinerU reattaches to a persisted task ID after restart without submitting again', async () => {
  let extractCalls = 0;
  let getTaskCalls = 0;
  let persistedResults = 0;
  const result = {
    taskId: 'mineru-task-existing', state: 'done', filename: 'split.pdf', errCode: '', error: null,
    zipUrl: null, progress: null, markdown: null,
    contentList: [{ page_idx: 0, page_size: [100, 200], type: 'text', text: 'Recovered question', bbox: [0, 0, 100, 100] }],
    images: [], docx: null, html: null, latex: null, _zipBytes: Uint8Array.from([1]),
  };
  const provider = new MineruProvider('test-token', {
    createClient: () => ({
      extract: async () => { extractCalls += 1; return result; },
      getTask: async (taskId) => { getTaskCalls += 1; assert.equal(taskId, result.taskId); return result; },
    }),
    persistRaw: async () => { persistedResults += 1; return 'provider/11111111-1111-1111-1111-111111111111.json'; },
  });
  const input = {
    jobId: 'parser-1', storageKey: 'provider-split/11111111-1111-1111-1111-111111111111',
    fileName: 'questions.pdf', pageStart: 41, pageEnd: 41,
  };

  assert.deepEqual(await provider.poll(result.taskId), { state: 'succeeded' });
  const parsed = await provider.fetchResult(result.taskId, input);

  assert.equal(extractCalls, 0);
  assert.equal(getTaskCalls, 1);
  assert.equal(persistedResults, 1);
  assert.equal(parsed.pages[0].pageNumber, 41);
  assert.equal(parsed.pages[0].blocks[0].text, 'Recovered question');
});

test('protected PDF preview is uploader-scoped and streams private nosniff JPEG bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'question-import-preview-'));
  const previewPath = join(directory, 'preview.jpg');
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  await writeFile(previewPath, jpeg);
  let assetWhere;
  const imports = new ImportBatchService({
    questionImportAsset: {
      findFirst: async ({ where }) => { assetWhere = where; return { storageKey: 'page-preview/11111111-1111-1111-1111-111111111111' }; },
    },
  }, {});
  const controller = new QuestionImportController(
    imports,
    { resolvePagePreviewJpegPath: async () => previewPath },
    {}, {}, {},
  );
  const response = new PassThrough();
  const headers = {};
  const chunks = [];
  response.setHeader = (name, value) => { headers[name] = value; };
  response.on('data', (chunk) => chunks.push(chunk));

  await controller.pagePreview({ id: 'admin-1' }, 'batch-1', '2', response);
  await finished(response);

  assert.deepEqual(assetWhere, {
    batchId: 'batch-1', pageNumber: 2, mediaType: 'image/jpeg', scope: 'temporary',
    batch: { uploadedById: 'admin-1' },
  });
  assert.equal(headers['Content-Type'], 'image/jpeg');
  assert.equal(headers['Cache-Control'], 'private, max-age=300');
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.deepEqual(Buffer.concat(chunks), jpeg);
});
