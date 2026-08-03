import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Prisma, type QuestionImportFileType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ImportStorageService } from './import-storage.service';
import { ImportValidationService } from './import-validation';
import { TableImportParser } from './table-import.parser';
import { MineruProvider, PdfParserNotConfiguredError } from './providers/mineru.provider';
import type { DocumentParserProvider } from './providers/document-parser.provider';
import { PdfDocumentService, providerPageLimit, splitPageRanges, type PdfPageRange } from './pdf-document.service';
import { PdfPageRenderer, type QuestionImportAsset } from './pdf-page-renderer';
import { QuestionStructureService } from './question-structure.service';
import { TencentPageOcrProvider } from './providers/tencent-page-ocr.provider';
import { ImportQualityService } from './import-quality.service';

export const IMPORT_WORKER_OPTIONS = Symbol('IMPORT_WORKER_OPTIONS');

export interface ImportWorkerOptions {
  workerId?: string;
  leaseMs?: number;
  emptyPollMs?: number;
  autoStart?: boolean;
  now?: () => Date;
}

export interface ClaimedJob {
  id: string;
  batchId: string;
  provider: string;
  pageStart: number;
  pageEnd: number;
  originalFileName: string;
  originalStorageKey: string;
  fileType: QuestionImportFileType;
  source: string;
  year?: number | null;
  defaultSubject?: string | null;
  defaultChapter?: string | null;
  leaseOwner: string;
  leaseExpiresAt: Date;
  externalTaskId?: string | null;
  providerInputStorageKey?: string | null;
}

interface ClaimableBatch {
  batchId: string;
  originalFileName: string;
  originalStorageKey: string;
  fileType: QuestionImportFileType;
  source: string;
  year?: number | null;
  defaultSubject?: string | null;
  defaultChapter?: string | null;
  status: string;
}

export interface TableJobResult {
  validCandidates: number;
  failedCandidates: number;
  statusCounts: Record<string, number>;
}

export interface DocumentJobResult {
  parsedPages: number;
  statusCounts: Record<string, number>;
}

@Injectable()
export class ImportWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImportWorkerService.name);
  private readonly workerId: string;
  private readonly leaseMs: number;
  private readonly emptyPollMs: number;
  private readonly now: () => Date;
  private readonly validation: ImportValidationService;
  private stopping = false;
  private loop?: Promise<void>;
  private wake?: () => void;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ImportStorageService,
    private readonly parser: TableImportParser,
    @Optional() @Inject(IMPORT_WORKER_OPTIONS) options: ImportWorkerOptions = {},
    @Optional() validation?: ImportValidationService,
    @Optional() @Inject(MineruProvider) private readonly documentProvider: DocumentParserProvider = new MineruProvider(),
    @Optional() private readonly pdfDocuments?: PdfDocumentService,
    @Optional() private readonly pageRenderer?: PdfPageRenderer,
    @Optional() private readonly structure?: QuestionStructureService,
    @Optional() private readonly tencentOcr?: TencentPageOcrProvider,
    @Optional() private readonly quality = new ImportQualityService(),
  ) {
    this.workerId = options.workerId ?? `question-import-${randomUUID()}`;
    this.leaseMs = positiveInteger(options.leaseMs, 5 * 60_000);
    this.emptyPollMs = positiveInteger(options.emptyPollMs, 1_000);
    this.now = options.now ?? (() => new Date());
    this.validation = validation ?? new ImportValidationService(prisma);
    this.autoStart = options.autoStart !== false;
  }

  private readonly autoStart: boolean;

  onModuleInit(): void {
    if (this.autoStart && Boolean(process.env.DATABASE_URL)) void this.start();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    this.wake?.();
    await this.loop;
  }

  claimNextJob(): Promise<ClaimedJob | null> {
    const now = this.now();
    const leaseExpiresAt = new Date(now.getTime() + this.leaseMs);
    const claimableProviders = this.claimableProviders();
    return this.prisma.$transaction(async (tx) => {
      const batches = await tx.$queryRaw<ClaimableBatch[]>`
        SELECT batch."id" AS "batchId", batch."originalFileName", batch."originalStorageKey", batch."fileType",
               batch."source", batch."year", batch."defaultSubject", batch."defaultChapter", batch."status"
        FROM "QuestionImportBatch" AS batch
        WHERE batch."status" NOT IN (
          'cancelled'::"QuestionImportBatchStatus", 'completed'::"QuestionImportBatchStatus",
          'expired'::"QuestionImportBatchStatus"
        )
        AND EXISTS (
          SELECT 1
          FROM "QuestionImportJob" AS job
          WHERE job."batchId" = batch."id"
          AND (
            job."state" IN ('pending'::"QuestionImportJobState", 'queued'::"QuestionImportJobState")
            OR (job."state" = 'running'::"QuestionImportJobState" AND job."leaseExpiresAt" <= ${now})
          )
          AND job."provider" IN (${Prisma.join(claimableProviders)})
          AND (job."retryAt" IS NULL OR job."retryAt" <= ${now})
        )
        ORDER BY (
          SELECT MIN(job."createdAt")
          FROM "QuestionImportJob" AS job
          WHERE job."batchId" = batch."id"
          AND (
            job."state" IN ('pending'::"QuestionImportJobState", 'queued'::"QuestionImportJobState")
            OR (job."state" = 'running'::"QuestionImportJobState" AND job."leaseExpiresAt" <= ${now})
          )
          AND job."provider" IN (${Prisma.join(claimableProviders)})
          AND (job."retryAt" IS NULL OR job."retryAt" <= ${now})
        ) ASC
        FOR UPDATE OF batch SKIP LOCKED
        LIMIT 1
      `;
      const batch = batches[0];
      if (!batch) return null;

      const rows = await tx.$queryRaw<Array<Pick<ClaimedJob, 'id' | 'batchId' | 'provider' | 'pageStart' | 'pageEnd' | 'leaseOwner' | 'leaseExpiresAt' | 'externalTaskId' | 'providerInputStorageKey'>>>`
        WITH next_job AS (
          SELECT job."id"
          FROM "QuestionImportJob" AS job
          WHERE job."batchId" = ${batch.batchId}
          AND (
            job."state" IN ('pending'::"QuestionImportJobState", 'queued'::"QuestionImportJobState")
            OR (job."state" = 'running'::"QuestionImportJobState" AND job."leaseExpiresAt" <= ${now})
          )
          AND job."provider" IN (${Prisma.join(claimableProviders)})
          AND (job."retryAt" IS NULL OR job."retryAt" <= ${now})
          ORDER BY job."createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE "QuestionImportJob" AS job
        SET "state" = 'running'::"QuestionImportJobState",
            "leaseOwner" = ${this.workerId},
            "leaseExpiresAt" = ${leaseExpiresAt},
            "startedAt" = COALESCE(job."startedAt", ${now}),
            "updatedAt" = ${now}
        FROM next_job
        WHERE job."id" = next_job."id"
        RETURNING job."id", job."batchId", job."provider", job."pageStart", job."pageEnd", job."leaseOwner", job."leaseExpiresAt", job."externalTaskId", job."providerInputStorageKey"
      `;
      const row = rows[0];
      if (row) {
        await tx.questionImportBatch.update({
          where: { id: row.batchId },
          data: { status: batch.status === 'parsing_partial_failure' ? 'parsing_partial_failure' : 'parsing', revision: { increment: 1 } },
        });
      }
      return row ? { ...batch, ...row } : null;
    });
  }

  private claimableProviders(): string[] {
    const providers = ['table-parser'];
    if (this.pdfDocuments) providers.push('document-planner');
    try {
      this.documentProvider.assertConfigured?.();
      providers.push('document-parser');
    } catch {
      // A table-only worker must not lease PDF parser jobs it cannot process.
    }
    return providers;
  }

  async processClaimedJob(job: ClaimedJob): Promise<TableJobResult | DocumentJobResult> {
    if (job.provider === 'document-planner' && job.fileType === 'pdf') return this.processPdfPlannerJob(job);
    if (job.provider === 'document-parser' && job.fileType === 'pdf') return this.processDocumentJob(job);
    if (job.provider !== 'table-parser' || !['csv', 'xlsx'].includes(job.fileType)) {
      throw new Error(`Unsupported question import provider: ${job.provider}`);
    }
    const file = await this.storage.readTemporary(job.originalStorageKey);
    const parsed = await this.parser.parse(file, job.originalFileName);
    const candidates = await this.validation.prepareRows({
      id: job.batchId,
      source: job.source,
      year: job.year,
      defaultSubject: job.defaultSubject,
      defaultChapter: job.defaultChapter,
    }, job.id, parsed.rows, parsed.issues);
    const validCandidates = candidates.filter((candidate) => !['needs_edit', 'parse_failed'].includes(candidate.status ?? '')).length;
    const failedCandidates = candidates.length - validCandidates;
    const now = this.now();

    const statusCounts = await this.prisma.$transaction(async (tx) => {
      const batchClaimed = await tx.questionImportBatch.updateMany({
        where: { id: job.batchId, status: { notIn: ['cancelled', 'expired', 'completed'] } },
        data: { status: 'review', revision: { increment: 1 } },
      });
      if (batchClaimed.count !== 1) throw new Error('QUESTION_IMPORT_BATCH_TERMINAL');
      const completed = await tx.questionImportJob.updateMany({
        where: {
          id: job.id,
          state: 'running',
          leaseOwner: job.leaseOwner,
          leaseExpiresAt: { gt: now },
        },
        data: {
          state: 'succeeded', completedAt: now, leaseOwner: null, leaseExpiresAt: null, error: Prisma.DbNull,
        },
      });
      if (completed.count !== 1) throw new Error('QUESTION_IMPORT_LEASE_LOST');
      if (candidates.length > 0) await tx.questionImportCandidate.createMany({ data: candidates, skipDuplicates: true });
      const groups = await tx.questionImportCandidate.groupBy({
        by: ['status'], where: { batchId: job.batchId }, _count: { _all: true },
      });
      const counts = Object.fromEntries(groups.map((group) => [group.status, group._count._all]));
      await tx.questionImportBatch.update({
        where: { id: job.batchId },
        data: { status: 'review', statusCounts: counts },
      });
      return counts;
    });
    return { validCandidates, failedCandidates, statusCounts };
  }

  async runOnce(): Promise<TableJobResult | DocumentJobResult | null> {
    const job = await this.claimNextJob();
    if (!job) return null;
    return this.runOnceWithJob(job);
  }

  async runOnceWithJob(job: ClaimedJob): Promise<TableJobResult | DocumentJobResult | null> {
    try {
      return await this.processClaimedJob(job);
    } catch (error) {
      await this.failJob(job, error);
      return null;
    }
  }

  private async processDocumentJob(job: ClaimedJob): Promise<DocumentJobResult> {
    this.documentProvider.assertConfigured?.();
    if (!job.providerInputStorageKey) throw new Error('PDF_PROVIDER_SPLIT_MISSING');
    const providerInput = {
      jobId: job.id,
      storageKey: job.providerInputStorageKey,
      fileName: job.originalFileName,
      pageStart: job.pageStart,
      pageEnd: job.pageEnd,
    };
    const submitted = job.externalTaskId ? { externalTaskId: job.externalTaskId } : await this.documentProvider.submit(providerInput);
    if (!job.externalTaskId) await this.prisma.questionImportJob.updateMany({ where: { id: job.id, state: 'running', leaseOwner: job.leaseOwner }, data: { externalTaskId: submitted.externalTaskId } });
    const poll = await this.documentProvider.poll(submitted.externalTaskId);
    if (poll.state !== 'succeeded') {
      const error = new Error(poll.state === 'failed' ? poll.message : 'Document parsing failed');
      Object.assign(error, { code: poll.state === 'failed' ? poll.code : 'DOCUMENT_PARSE_NOT_READY', retryable: poll.state === 'failed' ? poll.retryable : true });
      throw error;
    }
    const parsed = await this.documentProvider.fetchResult(submitted.externalTaskId, providerInput);
    const previews: QuestionImportAsset[] = [];
    if (this.pageRenderer) for (const page of parsed.pages) previews.push(await this.pageRenderer.render(job.originalStorageKey, page.pageNumber));
    const selectedPages = [] as typeof parsed.pages;
    let tencentFallbackCalls = 0;
    for (const page of parsed.pages) {
      const preview = previews.find((item) => item.pageNumber === page.pageNumber);
      if (!preview || !this.tencentOcr?.isConfigured() || !this.quality.shouldFallback(page.quality)) { selectedPages.push(page); continue; }
      try {
        tencentFallbackCalls += 1;
        const fallback = await this.tencentOcr.recognize(await this.storage.resolvePagePreviewJpegPath(preview.storageKey), page.pageNumber, page.width, page.height);
        selectedPages.push(fallback.quality.score > page.quality.score
          ? { ...fallback, quality: { ...fallback.quality, signals: [...fallback.quality.signals, 'fallback_selected'] } }
          : { ...page, quality: { ...page.quality, signals: [...page.quality.signals, 'fallback_retained_mineru'] } });
      } catch (error) {
        this.logger.warn(`Tencent OCR fallback failed for page ${page.pageNumber}; retaining MinerU result`);
        selectedPages.push({ ...page, quality: { ...page.quality, signals: [...page.quality.signals, 'fallback_unavailable'] } });
      }
    }
    const selected = { ...parsed, pages: selectedPages };
    const drafts = this.structure?.structure(selected) ?? [];
    const now = this.now();
    const statusCounts = { document_parsed: parsed.pages.length };
    await this.prisma.$transaction(async (tx) => {
      const currentBatch = await tx.questionImportBatch.findUnique({ where: { id: job.batchId }, select: { status: true } });
      if (!currentBatch || ['cancelled', 'expired', 'completed'].includes(currentBatch.status)) throw new Error('QUESTION_IMPORT_BATCH_TERMINAL');
      const batchClaimed = await tx.questionImportBatch.updateMany({
        where: { id: job.batchId, status: { notIn: ['cancelled', 'expired', 'completed'] } },
        data: { status: currentBatch.status === 'parsing_partial_failure' ? 'parsing_partial_failure' : 'review', statusCounts, providerSummary: { provider: parsed.provider, model: parsed.model, pages: parsed.pages.length, fallback: selectedPages.filter((page) => page.quality.signals.includes('fallback_selected')).length, tencentFallbackCalls }, revision: { increment: 1 } },
      });
      if (batchClaimed.count !== 1) throw new Error('QUESTION_IMPORT_BATCH_TERMINAL');
      const completed = await tx.questionImportJob.updateMany({
        where: {
          id: job.id,
          state: 'running',
          leaseOwner: job.leaseOwner,
          leaseExpiresAt: { gt: now },
        },
        data: {
          externalTaskId: submitted.externalTaskId,
          state: 'succeeded',
          completedAt: now,
          leaseOwner: null,
          leaseExpiresAt: null,
          quality: { rawResultKey: parsed.rawResultKey ?? null, mineruPages: JSON.parse(JSON.stringify(parsed.pages)), selectedPages: JSON.parse(JSON.stringify(selectedPages)) } as Prisma.InputJsonObject,
          cost: { mineruPages: parsed.pages.length, tencentFallbackCalls, tencentFallbackSelectedPages: selectedPages.filter((page) => page.quality.signals.includes('fallback_selected')).length } as Prisma.InputJsonObject,
          error: Prisma.DbNull,
        },
      });
      if (completed.count !== 1) throw new Error('QUESTION_IMPORT_LEASE_LOST');
      if (previews.length > 0) await tx.questionImportAsset.createMany({ data: previews.map((preview) => ({
        batchId: job.batchId, scope: 'temporary', storageKey: preview.storageKey, sha256: preview.sha256, mediaType: preview.mediaType,
        byteSize: preview.byteSize, pageNumber: preview.pageNumber,
      })), skipDuplicates: true });
      if (drafts.length > 0) await tx.questionImportCandidate.createMany({ data: drafts.map((draft, index) => ({
        batchId: job.batchId, jobId: job.id, sourceRowNumber: index + 1, stem: draft.stem || 'Unstructured PDF question', options: draft.options,
        answer: draft.answer, analysis: draft.analysis, difficulty: 'MEDIUM', type: draft.options.length ? 'SINGLE_CHOICE' : 'COMPREHENSIVE', source: job.source,
        year: job.year ?? null, expectedTimeSec: 100, knowledgePointIds: [], formulas: draft.formulas as unknown as Prisma.InputJsonValue,
        warnings: draft.warnings as unknown as Prisma.InputJsonValue, pageNumber: draft.pageNumber, sourceRegion: draft.sourceRegion as unknown as Prisma.InputJsonValue,
        contentFingerprint: `${job.id}:${index + 1}`, status: draft.warnings.length ? 'needs_edit' : 'pending_review',
      })), skipDuplicates: true });
    });
    return { parsedPages: parsed.pages.length, statusCounts };
  }

  private async processPdfPlannerJob(job: ClaimedJob): Promise<DocumentJobResult> {
    const pdf = this.pdfDocuments;
    if (!pdf) throw new Error('PDF_DOCUMENT_SERVICE_NOT_CONFIGURED');
    const pageCount = await pdf.pageCount(job.originalStorageKey);
    const { acceptedFiles, failures } = await this.splitPdfRanges(job.originalStorageKey, splitPageRanges(pageCount, providerPageLimit()));
    const statusCounts = {
      document_planned: 1,
      document_pending: acceptedFiles.length,
      ...(failures.length > 0 ? { failed: failures.length } : {}),
    };
    const failureJson = JSON.parse(JSON.stringify(failures)) as Prisma.InputJsonArray;
    const now = this.now();
    await this.prisma.$transaction(async (tx) => {
      await tx.questionImportJob.createMany({ data: acceptedFiles.map((file) => ({
        batchId: job.batchId, pageStart: file.pageStart, pageEnd: file.pageEnd,
        provider: 'document-parser', providerInputStorageKey: file.storageKey, state: 'pending',
      })), skipDuplicates: true });
      const completed = await tx.questionImportJob.updateMany({
        where: { id: job.id, state: 'running', leaseOwner: job.leaseOwner, leaseExpiresAt: { gt: now } },
        data: {
          state: 'succeeded', completedAt: now, leaseOwner: null, leaseExpiresAt: null,
          quality: { pageCount, children: acceptedFiles.length, failures: failureJson },
          error: failures.length > 0 ? { code: 'PDF_PAGE_TOO_LARGE', failures: failureJson } : Prisma.DbNull,
        },
      });
      if (completed.count !== 1) throw new Error('QUESTION_IMPORT_LEASE_LOST');
      await tx.questionImportBatch.update({ where: { id: job.batchId }, data: { status: failures.length > 0 ? 'parsing_partial_failure' : 'parsing', statusCounts } });
    });
    return { parsedPages: pageCount, statusCounts };
  }

  private async splitPdfRanges(storageKey: string, ranges: PdfPageRange[]): Promise<{
    acceptedFiles: Array<PdfPageRange & { storageKey: string }>;
    failures: Array<PdfPageRange & { code: 'PDF_PAGE_TOO_LARGE' }>;
  }> {
    const pdf = this.pdfDocuments!;
    const acceptedFiles: Array<PdfPageRange & { storageKey: string }> = [];
    const failures: Array<PdfPageRange & { code: 'PDF_PAGE_TOO_LARGE' }> = [];
    for (const range of ranges) {
      const [file] = await pdf.split(storageKey, [range]);
      if (file.byteSize <= 200 * 1024 * 1024) { acceptedFiles.push(file); continue; }
      await pdf.removeProviderSplitArtifact(file.storageKey);
      if (range.pageStart === range.pageEnd) {
        failures.push({ code: 'PDF_PAGE_TOO_LARGE', ...range });
        continue;
      }
      const midpoint = Math.floor((range.pageStart + range.pageEnd) / 2);
      const childResult = await this.splitPdfRanges(storageKey, [{ pageStart: range.pageStart, pageEnd: midpoint }, { pageStart: midpoint + 1, pageEnd: range.pageEnd }]);
      acceptedFiles.push(...childResult.acceptedFiles);
      failures.push(...childResult.failures);
    }
    return { acceptedFiles, failures };
  }

  start(): Promise<void> {
    if (this.loop) return this.loop;
    this.stopping = false;
    this.loop = this.runLoop().finally(() => { this.loop = undefined; });
    return this.loop;
  }

  private async runLoop(): Promise<void> {
    while (!this.stopping) {
      let result: TableJobResult | DocumentJobResult | null = null;
      try {
        result = await this.runOnce();
      } catch {
        this.logger.error('Question import worker iteration failed before a job could be processed');
      }
      if (!result && !this.stopping) await this.sleepWhenEmpty();
    }
  }

  private async failJob(job: ClaimedJob, error: unknown): Promise<void> {
    const now = this.now();
    const safeError = safeJobError(error);
    try {
      await this.prisma.$transaction(async (tx) => {
        const batchClaimed = await tx.questionImportBatch.updateMany({
          where: { id: job.batchId, status: { notIn: ['cancelled', 'expired', 'completed'] } },
          data: { status: job.provider === 'document-parser' ? 'parsing_partial_failure' : 'failed', statusCounts: { failed: 1 }, failedAt: now, revision: { increment: 1 } },
        });
        if (batchClaimed.count !== 1) return;
        const failed = await tx.questionImportJob.updateMany({
          where: { id: job.id, state: 'running', leaseOwner: job.leaseOwner, leaseExpiresAt: { gt: now } },
          data: { state: 'failed', completedAt: now, leaseOwner: null, leaseExpiresAt: null, error: safeError },
        });
        if (failed.count !== 1) throw new Error('QUESTION_IMPORT_LEASE_LOST');
      });
    } catch {
      this.logger.error(`Could not persist question import failure for job ${job.id}`);
    }
  }

  private sleepWhenEmpty(): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.wake = undefined; resolve(); }, this.emptyPollMs);
      this.wake = () => { clearTimeout(timer); this.wake = undefined; resolve(); };
    });
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value! > 0 ? value! : fallback;
}

function safeJobError(error: unknown): Prisma.InputJsonObject {
  if (error instanceof PdfParserNotConfiguredError) {
    return { code: error.code, message: error.message, requestId: error.requestId };
  }
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'QUESTION_IMPORT_PROCESSING_FAILED';
  return { code: code || 'QUESTION_IMPORT_PROCESSING_FAILED' };
}
