import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditEventService } from '../../operations/audit-event.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateImportBatchDto } from './dto/create-import-batch.dto';
import type { StoredImportFile } from './import-storage.service';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const IMPORT_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class ImportBatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditEventService: AuditEventService,
  ) {}

  async create(actorId: string, input: CreateImportBatchDto, file: StoredImportFile) {
    if (input.rightsConfirmed !== true) throw new BadRequestException('rightsConfirmed must be explicitly true');
    const source = input.source.trim();
    if (!source) throw new BadRequestException('source is required');
    const now = new Date();
    const batch = await this.prisma.$transaction(async (tx) => tx.questionImportBatch.create({
      data: {
        uploadedById: actorId,
        originalFileName: file.originalFileName,
        originalStorageKey: file.storageKey,
        fileSha256: file.fileSha256,
        fileType: file.fileType,
        source,
        title: input.title?.trim() || null,
        year: input.year ?? null,
        defaultSubject: input.defaultSubject?.trim() || null,
        defaultChapter: input.defaultChapter?.trim() || null,
        pageRange: input.pageRange?.trim() || null,
        rightsConfirmed: true,
        rightsConfirmedAt: now,
        status: 'queued',
        statusCounts: { pending: 1 },
        expiresAt: new Date(now.getTime() + IMPORT_EXPIRY_MS),
        jobs: {
          create: {
            pageStart: 1,
            pageEnd: 1,
            provider: file.fileType === 'pdf' ? 'document-parser' : 'table-parser',
            state: 'pending',
          },
        },
      },
      select: { id: true, status: true },
    }));
    await this.auditEventService.record({
      actorId,
      action: 'question_import.upload',
      targetType: 'question_import',
      targetId: batch.id,
      result: 'success',
      metadata: { fileSha256: file.fileSha256, fileType: file.fileType, byteSize: file.byteSize, pendingJobs: 1 },
    });
    return { batchId: batch.id, status: batch.status };
  }

  async list(pageValue?: number, pageSizeValue?: number) {
    const page = Number.isInteger(pageValue) && pageValue! > 0 ? pageValue! : 1;
    const pageSize = Math.min(Math.max(Number.isInteger(pageSizeValue) ? pageSizeValue! : DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.questionImportBatch.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, originalFileName: true, fileType: true, source: true, status: true,
          statusCounts: true, createdAt: true, updatedAt: true, expiresAt: true,
        },
      }),
      this.prisma.questionImportBatch.count(),
    ]);
    return { items, page, pageSize, total };
  }

  async detail(batchId: string) {
    const batch = await this.prisma.questionImportBatch.findUnique({
      where: { id: batchId },
      include: {
        jobs: { orderBy: { createdAt: 'asc' }, select: { id: true, pageStart: true, pageEnd: true, provider: true, attempt: true, state: true, retryAt: true, createdAt: true, updatedAt: true } },
        assets: { select: { id: true, scope: true, mediaType: true, byteSize: true, pageNumber: true, createdAt: true } },
      },
    });
    if (!batch) throw new NotFoundException('Question import batch was not found');
    return batch;
  }

  async cancel(actorId: string, batchId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.questionImportBatch.updateMany({
        where: { id: batchId, status: { notIn: ['cancelled', 'completed', 'expired'] } },
        data: { status: 'cancelled' },
      });
      if (updated.count !== 1) throw new BadRequestException('Question import batch cannot be cancelled');
      const cancelledJobs = await tx.questionImportJob.updateMany({
        where: { batchId, state: { in: ['pending', 'queued'] } },
        data: { state: 'cancelled' },
      });
      return cancelledJobs.count;
    });
    await this.auditEventService.record({
      actorId,
      action: 'question_import.cancel',
      targetType: 'question_import',
      targetId: batchId,
      result: 'success',
      metadata: { cancelledJobs: result },
    });
    return { batchId, status: 'cancelled', cancelledJobs: result };
  }

  async retry(actorId: string, batchId: string, jobIds: unknown) {
    if (!Array.isArray(jobIds) || jobIds.length === 0 || jobIds.some((id) => typeof id !== 'string' || !id)) {
      throw new BadRequestException('jobIds must be a non-empty array of failed job IDs');
    }
    const claimed = await this.prisma.$transaction(async (tx) => {
      const batch = await tx.questionImportBatch.findUnique({ where: { id: batchId }, select: { status: true } });
      if (!batch) throw new NotFoundException('Question import batch was not found');
      if (batch.status === 'cancelled' || batch.status === 'expired' || batch.status === 'completed') {
        throw new BadRequestException('Question import batch cannot accept retries');
      }
      let count = 0;
      for (const id of jobIds) {
        const claim = await tx.questionImportJob.updateMany({
          where: { id, batchId, state: 'failed' },
          data: { state: 'queued', retryAt: null, attempt: { increment: 1 } },
        });
        count += claim.count;
      }
      return count;
    });
    await this.auditEventService.record({
      actorId,
      action: 'question_import.retry',
      targetType: 'question_import',
      targetId: batchId,
      result: claimed > 0 ? 'success' : 'rejected',
      metadata: { requestedJobs: jobIds.length, retriedJobs: claimed },
    });
    return { batchId, retriedJobs: claimed };
  }

  async recordRejection(actorId: string | undefined, file: { size?: number; originalname?: string } | undefined) {
    const extension = file?.originalname?.split('.').pop()?.toLowerCase();
    await this.auditEventService.record({
      actorId,
      action: 'question_import.reject',
      targetType: 'question_import',
      result: 'rejected',
      metadata: { fileType: extension ?? 'unknown', byteSize: file?.size ?? 0, status: 'rejected' },
    });
  }
}
