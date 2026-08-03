import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ImportStorageService } from './import-storage.service';

export interface CleanupSummary { temporaryObjects: number; permanentObjects: number; bytes: number; unresolvedBatches: number; }
const DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class ImportCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImportCleanupService.name);
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService, private readonly storage: ImportStorageService) {}

  onModuleInit(): void { void this.runSafely(); this.timer = setInterval(() => void this.runSafely(), DAY); this.timer.unref(); }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  async run(now: Date): Promise<CleanupSummary> {
    const summary: CleanupSummary = { temporaryObjects: 0, permanentObjects: 0, bytes: 0, unresolvedBatches: 0 };
    const expired = await this.prisma.questionImportBatch.findMany({
      where: { expiresAt: { lte: now } },
      select: { id: true, originalStorageKey: true, candidates: { where: { status: { in: ['pending_review', 'needs_edit', 'duplicate_suspected', 'approved', 'parse_failed'] } }, select: { id: true } }, assets: { where: { scope: 'temporary' }, select: { id: true, storageKey: true, byteSize: true } }, jobs: { select: { state: true, providerInputStorageKey: true, quality: true } } },
    });
    for (const batch of expired) {
      const activeJob = batch.jobs.some((job) => ['pending', 'queued', 'running'].includes(job.state));
      if (batch.candidates.length || activeJob) { summary.unresolvedBatches += 1; this.logger.warn(`Retaining expired question import batch ${batch.id}: unresolved candidates or jobs`); continue; }
      await this.storage.removeTemporary(batch.originalStorageKey);
      for (const job of batch.jobs) {
        await this.storage.removeTemporaryObject(job.providerInputStorageKey ?? '');
        await this.storage.removeTemporaryObject(rawResultKey(job.quality));
      }
      for (const asset of batch.assets) {
        await this.storage.removeTemporaryObject(asset.storageKey);
        await this.prisma.questionImportAsset.delete({ where: { id: asset.id } });
        summary.temporaryObjects += 1; summary.bytes += asset.byteSize;
      }
    }
    const permanent = await this.storage.listPermanentObjects();
    for (const object of permanent) {
      const reference = await this.prisma.questionImportAsset.findFirst({ where: { storageKey: object.storageKey, scope: 'permanent' }, select: { id: true } });
      if (!reference) { await this.storage.removePermanentObject(object.storageKey); summary.permanentObjects += 1; summary.bytes += object.byteSize; }
    }
    return summary;
  }

  private async runSafely(): Promise<void> {
    try { await this.run(new Date()); } catch (error) { this.logger.error(`Question import cleanup failed: ${error instanceof Error ? error.message : 'unknown error'}`); }
  }
}

function rawResultKey(quality: unknown): string {
  if (!quality || typeof quality !== 'object' || Array.isArray(quality)) return '';
  const value = (quality as Record<string, unknown>).rawResultKey;
  return typeof value === 'string' ? value : '';
}
