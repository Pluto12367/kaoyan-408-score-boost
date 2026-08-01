import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
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
import { PdfDocumentService } from '../apps/api/dist/questions/import/pdf-document.service.js';
import { PdfPageRenderer } from '../apps/api/dist/questions/import/pdf-page-renderer.js';
import { PDFDocument } from 'pdf-lib';

const hasPdfRuntimeTools = ['qpdf', 'pdftoppm'].every((command) => spawnSync(command, ['--version'], { shell: false, windowsHide: true }).status === 0);

test('PDF page ranges preserve global page numbers at the 200 page boundary', () => {
  assert.deepEqual(splitPageRanges(401), [
    { pageStart: 1, pageEnd: 200 },
    { pageStart: 201, pageEnd: 400 },
    { pageStart: 401, pageEnd: 401 },
  ]);
});

test('generated PDF is split by qpdf and rendered by Poppler', { skip: !hasPdfRuntimeTools }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'question-import-pdf-runtime-'));
  const sourcePath = join(root, 'source.pdf');
  const document = await PDFDocument.create();
  for (let page = 1; page <= 3; page += 1) document.addPage([100 + page, 200 + page]);
  await writeFile(sourcePath, await document.save());
  const storage = {
    resolveTemporaryPdfPath: async () => sourcePath,
    registerProviderSplitArtifact: async () => undefined,
  };

  try {
    const pdf = new PdfDocumentService(storage);
    assert.equal(await pdf.pageCount('temporary/generated'), 3);
    const [split] = await pdf.split('temporary/generated', [{ pageStart: 2, pageEnd: 3 }]);
    const splitId = split.storageKey.slice('provider-split/'.length);
    const splitDocument = await PDFDocument.load(await readFile(join(root, 'provider-splits', `${splitId}.pdf`)));
    assert.equal(splitDocument.getPageCount(), 2);
    assert.deepEqual(splitDocument.getPages().map((page) => page.getSize().width), [102, 103]);

    await mkdir(join(root, 'page-previews'), { recursive: true });
    const preview = await new PdfPageRenderer(storage).render('temporary/generated', 2);
    const previewId = preview.storageKey.slice('page-preview/'.length);
    const jpeg = await readFile(join(root, 'page-previews', `${previewId}.jpg`));
    assert.deepEqual([...jpeg.subarray(0, 3)], [0xff, 0xd8, 0xff]);
    assert.equal(preview.pageNumber, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
  const removedSplits = [];
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
    removeProviderSplitArtifact: async (storageKey) => { removedSplits.push(storageKey); },
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

  assert.deepEqual(childJobs.map(({ pageStart, pageEnd, providerInputStorageKey }) => ({ pageStart, pageEnd, providerInputStorageKey })), [
    { pageStart: 2, pageEnd: 2, providerInputStorageKey: 'provider-split/2-2' },
    { pageStart: 3, pageEnd: 3, providerInputStorageKey: 'provider-split/3-3' },
  ]);
  assert.deepEqual(removedSplits, ['provider-split/1-3', 'provider-split/1-2', 'provider-split/1-1']);
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
      submit: async () => { extractCalls += 1; return result.taskId; },
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

test('a reclaimed document child uses its persisted provider task and qpdf split without new submission or splitting', async () => {
  const now = new Date('2026-08-01T00:00:00.000Z');
  let submitCalls = 0;
  let splitCalls = 0;
  let fetchedInput;
  let batchUpdate;
  const provider = {
    assertConfigured: () => undefined,
    submit: async () => { submitCalls += 1; return { externalTaskId: 'unexpected-new-task' }; },
    poll: async (taskId) => { assert.equal(taskId, 'persisted-task'); return { state: 'succeeded' }; },
    fetchResult: async (_taskId, input) => {
      fetchedInput = input;
      return { provider: 'mineru', model: 'fake', pages: [], rawResultKey: 'provider/raw.json' };
    },
  };
  const prisma = {
    $transaction: async (operation) => operation({
      questionImportBatch: {
        findUnique: async () => ({ status: 'parsing_partial_failure' }),
        updateMany: async ({ data }) => { batchUpdate = data; return { count: 1 }; },
      },
      questionImportJob: { updateMany: async () => ({ count: 1 }) },
    }),
  };
  const worker = new ImportWorkerService(
    prisma,
    { createProviderSplitArtifact: async () => { splitCalls += 1; throw new Error('must reuse planner artifact'); } },
    {}, { autoStart: false, now: () => now }, {}, provider,
  );
  const job = {
    id: 'parser-1', batchId: 'batch-1', provider: 'document-parser', pageStart: 41, pageEnd: 60,
    providerInputStorageKey: 'provider-split/11111111-1111-1111-1111-111111111111',
    externalTaskId: 'persisted-task', originalFileName: 'questions.pdf', originalStorageKey: 'temporary/questions',
    fileType: 'pdf', source: 'licensed questions', leaseOwner: 'worker-recovery',
    leaseExpiresAt: new Date(now.getTime() + 60_000),
  };

  await worker.processClaimedJob(job);

  assert.equal(submitCalls, 0);
  assert.equal(splitCalls, 0);
  assert.equal(fetchedInput.storageKey, job.providerInputStorageKey);
  assert.equal(batchUpdate.status, 'parsing_partial_failure');
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
