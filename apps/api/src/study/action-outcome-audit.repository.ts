import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type ActionOutcomeFacts = {
  practice: Array<{ id: string; userId: string; actionId?: string | null; submittedAt: Date }>;
  reviews: Array<{ id: string; userId: string; actionId?: string | null; reviewedAt: Date }>;
};

@Injectable()
export class ActionOutcomeAuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  async aggregate(actionId: string, userId: string): Promise<ActionOutcomeFacts> {
    if (!process.env.DATABASE_URL) return { practice: [], reviews: [] };
    const db = this.prisma as PrismaService & { practiceRecord: any; reviewAttempt: any };
    const [practice, reviews] = await Promise.all([
      db.practiceRecord.findMany({ where: { actionId, userId }, select: { id: true, userId: true, actionId: true, submittedAt: true }, orderBy: { submittedAt: 'asc' } }),
      db.reviewAttempt.findMany({ where: { actionId, schedule: { userId } }, select: { id: true, actionId: true, reviewedAt: true, schedule: { select: { userId: true } } }, orderBy: { reviewedAt: 'asc' } }),
    ]);
    return { practice, reviews: reviews.map((row: any) => ({ id: row.id, userId: row.schedule.userId, actionId: row.actionId, reviewedAt: row.reviewedAt })) };
  }
}
