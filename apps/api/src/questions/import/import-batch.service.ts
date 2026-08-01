import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateImportBatchDto } from './dto/create-import-batch.dto';
import type { StoredImportFile } from './import-storage.service';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const IMPORT_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

type AuditInput = { actorId?: string; action: string; targetId?: string; result: 'success' | 'rejected' | 'failed'; metadata?: Record<string, string | number | boolean> };

@Injectable()
export class ImportBatchService {
  constructor(private readonly prisma: PrismaService) {}

  async create(actorId: string, input: CreateImportBatchDto, file: StoredImportFile) {
    if (input.rightsConfirmed !== true) throw new BadRequestException('rightsConfirmed must be explicitly true');
    const source = input.source.trim();
    if (!source) throw new BadRequestException('source is required');
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const batch = await tx.questionImportBatch.create({
        data: {
          uploadedById: actorId, originalFileName: file.originalFileName, originalStorageKey: file.storageKey,
          fileSha256: file.fileSha256, fileType: file.fileType, source,
          title: input.title?.trim() || null, year: input.year ?? null,
          defaultSubject: input.defaultSubject?.trim() || null, defaultChapter: input.defaultChapter?.trim() || null,
          pageRange: input.pageRange?.trim() || null, rightsConfirmed: true, rightsConfirmedAt: now,
          status: 'queued', statusCounts: { pending: 1 }, expiresAt: new Date(now.getTime() + IMPORT_EXPIRY_MS),
          jobs: { create: { pageStart: 1, pageEnd: 1, provider: file.fileType === 'pdf' ? 'document-parser' : 'table-parser', state: 'pending' } },
        },
        select: { id: true, status: true },
      });
      await this.recordInTransaction(tx, { actorId, action: 'question_import.upload', targetId: batch.id, result: 'success', metadata: { fileSha256: file.fileSha256, fileType: file.fileType, byteSize: file.byteSize, pendingJobs: 1 } });
      return { batchId: batch.id, status: batch.status };
    });
  }

  async list(pageValue?: number, pageSizeValue?: number) {
    const page = Number.isInteger(pageValue) && pageValue! > 0 ? pageValue! : 1;
    const pageSize = Math.min(Math.max(Number.isInteger(pageSizeValue) ? pageSizeValue! : DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.questionImportBatch.findMany({ orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, select: { id: true, originalFileName: true, fileType: true, source: true, status: true, statusCounts: true, createdAt: true, updatedAt: true, expiresAt: true } }),
      this.prisma.questionImportBatch.count(),
    ]);
    return { items, page, pageSize, total };
  }

  async detail(batchId: string) {
    const batch = await this.prisma.questionImportBatch.findUnique({ where: { id: batchId }, include: { jobs: { orderBy: { createdAt: 'asc' }, select: { id: true, pageStart: true, pageEnd: true, provider: true, attempt: true, state: true, retryAt: true, createdAt: true, updatedAt: true } }, assets: { select: { id: true, scope: true, mediaType: true, byteSize: true, pageNumber: true, createdAt: true } } } });
    if (!batch) throw new NotFoundException('Question import batch was not found');
    return batch;
  }

  async cancel(actorId: string, batchId: string) {
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.questionImportBatch.findUnique({ where: { id: batchId }, select: { status: true } });
      if (!batch) throw new NotFoundException('Question import batch was not found');
      if (['cancelled', 'completed', 'expired'].includes(batch.status)) throw new BadRequestException('Question import batch cannot be cancelled');
      const updated = await tx.questionImportBatch.updateMany({ where: { id: batchId, status: batch.status }, data: { status: 'cancelled', revision: { increment: 1 } } });
      if (updated.count !== 1) throw new BadRequestException('Question import batch changed while cancelling');
      const cancelledJobs = await tx.questionImportJob.updateMany({ where: { batchId, state: { in: ['pending', 'queued'] } }, data: { state: 'cancelled' } });
      const counts = await this.countStates(tx, batchId);
      await tx.questionImportBatch.update({ where: { id: batchId }, data: { statusCounts: counts } });
      await this.recordInTransaction(tx, { actorId, action: 'question_import.cancel', targetId: batchId, result: 'success', metadata: { cancelledJobs: cancelledJobs.count } });
      return { batchId, status: 'cancelled', cancelledJobs: cancelledJobs.count };
    });
  }

  async retry(actorId: string, batchId: string, jobIds: unknown) {
    if (!Array.isArray(jobIds) || jobIds.length === 0 || jobIds.some((id) => typeof id !== 'string' || !id)) throw new BadRequestException('jobIds must be a non-empty array of failed job IDs');
    const ids = [...new Set(jobIds)];
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.questionImportBatch.findUnique({ where: { id: batchId }, select: { status: true } });
      if (!batch) throw new NotFoundException('Question import batch was not found');
      if (['cancelled', 'expired', 'completed'].includes(batch.status)) throw new BadRequestException('Question import batch cannot accept retries');
      const jobs = await tx.questionImportJob.findMany({ where: { id: { in: ids } }, select: { id: true, batchId: true, state: true } });
      if (jobs.length !== ids.length || jobs.some((job) => job.batchId !== batchId || job.state !== 'failed')) throw new BadRequestException('Every retry job must belong to this batch and be failed');
      const claim = await tx.questionImportJob.updateMany({ where: { id: { in: ids }, batchId, state: 'failed' }, data: { state: 'queued', retryAt: null, attempt: { increment: 1 } } });
      if (claim.count !== ids.length) throw new BadRequestException('A retry job changed while claiming');
      const counts = await this.countStates(tx, batchId);
      await tx.questionImportBatch.update({ where: { id: batchId }, data: { status: 'queued', statusCounts: counts, revision: { increment: 1 } } });
      await this.recordInTransaction(tx, { actorId, action: 'question_import.retry', targetId: batchId, result: 'success', metadata: { requestedJobs: ids.length, retriedJobs: claim.count } });
      return { batchId, retriedJobs: claim.count };
    });
  }

  async recordRejection(actorId: string | undefined, file: { size?: number; originalname?: string } | undefined) {
    const extension = file?.originalname ? file.originalname.slice(file.originalname.lastIndexOf('.') + 1).toLowerCase() : '';
    const fileType = extension === 'pdf' || extension === 'xlsx' || extension === 'csv' ? extension : 'unknown';
    await this.prisma.auditEvent.create({ data: { actorId, action: 'question_import.reject', targetType: 'question_import', result: 'rejected', metadata: { fileType, byteSize: file?.size ?? 0, status: 'rejected' } } });
  }

  private async countStates(tx: Prisma.TransactionClient, batchId: string): Promise<Prisma.InputJsonObject> {
    const groups = await tx.questionImportJob.groupBy({ by: ['state'], where: { batchId }, _count: { _all: true } });
    return Object.fromEntries(groups.map((group) => [group.state, group._count._all])) as Prisma.InputJsonObject;
  }

  private async recordInTransaction(tx: Prisma.TransactionClient, input: AuditInput) {
    await tx.auditEvent.create({ data: { actorId: input.actorId, action: input.action, targetType: 'question_import', targetId: input.targetId, result: input.result, metadata: input.metadata } });
  }
}
