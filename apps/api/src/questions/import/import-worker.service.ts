import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Prisma, type QuestionImportFileType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ImportStorageService } from './import-storage.service';
import { ImportValidationService } from './import-validation';
import { TableImportParser } from './table-import.parser';
import { MineruProvider, PdfParserNotConfiguredError } from './providers/mineru.provider';

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
    @Optional() private readonly documentProvider: MineruProvider = new MineruProvider(),
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
    return this.prisma.$transaction(async (tx) => {
      const batches = await tx.$queryRaw<ClaimableBatch[]>`
        SELECT batch."id" AS "batchId", batch."originalFileName", batch."originalStorageKey", batch."fileType",
               batch."source", batch."year", batch."defaultSubject", batch."defaultChapter",
               job."pageStart", job."pageEnd"
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
          AND job."provider" IN ('table-parser', 'document-parser')
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
          AND job."provider" IN ('table-parser', 'document-parser')
          AND (job."retryAt" IS NULL OR job."retryAt" <= ${now})
        ) ASC
        FOR UPDATE OF batch SKIP LOCKED
        LIMIT 1
      `;
      const batch = batches[0];
      if (!batch) return null;

      const rows = await tx.$queryRaw<Array<Pick<ClaimedJob, 'id' | 'batchId' | 'provider' | 'pageStart' | 'pageEnd' | 'leaseOwner' | 'leaseExpiresAt'>>>`
        WITH next_job AS (
          SELECT job."id"
          FROM "QuestionImportJob" AS job
          WHERE job."batchId" = ${batch.batchId}
          AND (
            job."state" IN ('pending'::"QuestionImportJobState", 'queued'::"QuestionImportJobState")
            OR (job."state" = 'running'::"QuestionImportJobState" AND job."leaseExpiresAt" <= ${now})
          )
          AND job."provider" IN ('table-parser', 'document-parser')
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
        RETURNING job."id", job."batchId", job."provider", job."pageStart", job."pageEnd", job."leaseOwner", job."leaseExpiresAt"
      `;
      const row = rows[0];
      if (row) {
        await tx.questionImportBatch.update({
          where: { id: row.batchId },
          data: { status: 'parsing', revision: { increment: 1 } },
        });
      }
      return row ? { ...batch, ...row } : null;
    });
  }

  async processClaimedJob(job: ClaimedJob): Promise<TableJobResult | DocumentJobResult> {
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
    const submitted = await this.documentProvider.submit({
      jobId: job.id,
      storageKey: job.originalStorageKey,
      fileName: job.originalFileName,
      pageStart: job.pageStart,
      pageEnd: job.pageEnd,
    });
    const poll = await this.documentProvider.poll(submitted.externalTaskId);
    if (poll.state !== 'succeeded') {
      const error = new Error(poll.state === 'failed' ? poll.message : 'Document parsing failed');
      Object.assign(error, { code: poll.state === 'failed' ? poll.code : 'DOCUMENT_PARSE_NOT_READY', retryable: poll.state === 'failed' ? poll.retryable : true });
      throw error;
    }
    const parsed = await this.documentProvider.fetchResult(submitted.externalTaskId);
    const now = this.now();
    const statusCounts = { document_parsed: parsed.pages.length };
    await this.prisma.$transaction(async (tx) => {
      const batchClaimed = await tx.questionImportBatch.updateMany({
        where: { id: job.batchId, status: { notIn: ['cancelled', 'expired', 'completed'] } },
        data: { status: 'review', statusCounts, providerSummary: { provider: parsed.provider, model: parsed.model, pages: parsed.pages.length }, revision: { increment: 1 } },
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
          quality: parsed.pages.map((page) => ({ pageNumber: page.pageNumber, quality: page.quality })),
          error: Prisma.DbNull,
        },
      });
      if (completed.count !== 1) throw new Error('QUESTION_IMPORT_LEASE_LOST');
    });
    return { parsedPages: parsed.pages.length, statusCounts };
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
          data: { status: 'failed', statusCounts: { failed: 1 }, failedAt: now, revision: { increment: 1 } },
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
