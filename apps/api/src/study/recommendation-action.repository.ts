import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type ActionStatus = 'CREATED' | 'STARTED' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';
export type RecommendationActionRow = {
  id: string; userId: string; actionType: string; targetType: string; targetId: string;
  reason: string; evidenceRefs: Prisma.JsonValue; status: string; version: number; creationKey: string;
  studyTaskId: string | null; createdAt: Date; updatedAt: Date; startedAt: Date | null; completedAt: Date | null; cancelledAt: Date | null;
};

@Injectable()
export class RecommendationActionRepository {
  constructor(private readonly prisma: PrismaService) {}
  private get action() { return (this.prisma as PrismaService & { recommendationAction: any }).recommendationAction; }

  async create(input: { userId: string; actionType: string; targetType: string; targetId: string; reason: string; evidenceRefs: Prisma.InputJsonValue; creationKey: string; studyTaskId?: string | null }): Promise<RecommendationActionRow> {
    return this.action.create({ data: { ...input, studyTaskId: input.studyTaskId ?? null } }) as Promise<RecommendationActionRow>;
  }
  async findById(id: string): Promise<RecommendationActionRow | null> { return this.action.findUnique({ where: { id } }) as Promise<RecommendationActionRow | null>; }
  async findByUserAndId(userId: string, id: string): Promise<RecommendationActionRow | null> { return this.action.findFirst({ where: { id, userId } }) as Promise<RecommendationActionRow | null>; }
  async findByCreationKey(userId: string, creationKey: string): Promise<RecommendationActionRow | null> { return this.action.findUnique({ where: { userId_creationKey: { userId, creationKey } } }) as Promise<RecommendationActionRow | null>; }
  async updateStatusWithVersion(input: { id: string; userId: string; expectedVersion: number; expectedStatus: ActionStatus; data: { status: ActionStatus; startedAt?: Date; completedAt?: Date; cancelledAt?: Date } }): Promise<RecommendationActionRow | null> {
    const result = await this.action.updateMany({ where: { id: input.id, userId: input.userId, version: input.expectedVersion, status: input.expectedStatus }, data: { ...input.data, version: { increment: 1 } } });
    if (result.count !== 1) return null;
    return this.findById(input.id);
  }
}
