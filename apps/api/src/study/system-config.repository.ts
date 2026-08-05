import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface PersistedSystemConfig {
  recommendation: {
    stageAssessmentQuestionLimit: number;
    dailyTargetQuestionCount: number;
    speedRiskMultiplier: number;
  };
  updatedBy: string;
  updatedAt: string;
}

@Injectable()
export class SystemConfigRepository {
  constructor(private readonly prisma: PrismaService) {}

  get enabled() {
    return Boolean(process.env.DATABASE_URL);
  }

  async load(): Promise<PersistedSystemConfig | null> {
    if (!this.enabled) return null;
    const row = await this.prisma.systemConfig.findFirst({ orderBy: { id: 'desc' } });
    if (!row) return null;
    return {
      recommendation: row.recommendation as PersistedSystemConfig['recommendation'],
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async save(config: PersistedSystemConfig): Promise<void> {
    if (!this.enabled) return;
    const data = {
      recommendation: config.recommendation as unknown as Prisma.InputJsonValue,
      updatedBy: config.updatedBy,
    };
    const existing = await this.prisma.systemConfig.findFirst({ orderBy: { id: 'desc' } });
    if (existing) {
      await this.prisma.systemConfig.update({ where: { id: existing.id }, data });
    } else {
      await this.prisma.systemConfig.create({ data });
    }
  }
}
