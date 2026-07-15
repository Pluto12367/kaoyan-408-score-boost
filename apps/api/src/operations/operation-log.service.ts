import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface OperationLogInput {
  requestId: string;
  userId?: string;
  role?: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
}

@Injectable()
export class OperationLogService implements OnModuleInit {
  private readonly logger = new Logger(OperationLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    if (!process.env.DATABASE_URL) return;
    const retentionDays = operationLogRetentionDays();
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.operationLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
    if (result.count > 0) this.logger.log(`Deleted ${result.count} operation logs older than ${retentionDays} days`);
  }

  async record(input: OperationLogInput) {
    if (!process.env.DATABASE_URL || input.path === '/health') return;
    await this.prisma.operationLog.create({ data: input });
  }
}

export function operationLogRetentionDays() {
  const parsed = Number(process.env.AUDIT_LOG_RETENTION_DAYS ?? 90);
  return Number.isInteger(parsed) && parsed >= 7 && parsed <= 365 ? parsed : 90;
}
