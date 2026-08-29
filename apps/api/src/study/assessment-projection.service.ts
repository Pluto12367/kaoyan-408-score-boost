import { Injectable } from '@nestjs/common';
import type { DashboardAssessmentFacts } from './dashboard.snapshot';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AssessmentProjectionService {
  constructor(private readonly prisma: PrismaService) {}

  async getFacts(userId: string, asOf: Date = new Date()): Promise<DashboardAssessmentFacts> {
    if (!process.env.DATABASE_URL) return emptyFacts();

    const rows = await this.prisma.assessmentHistoryItem.findMany({
      where: { userId, submittedAt: { lte: asOf } },
      orderBy: { submittedAt: 'asc' },
      select: { id: true, score: true, submittedAt: true, accuracyRate: true },
    });
    if (rows.length === 0) return emptyFacts();

    const sorted = [...rows].sort((left, right) => left.submittedAt.getTime() - right.submittedAt.getTime());
    const latest = sorted.at(-1);
    const best = sorted.reduce<{ score: number; submittedAt: Date }>((value, row) => row.score > value.score ? row : value, { score: -Infinity, submittedAt: sorted[0].submittedAt });
    return {
      source: 'assessment',
      attemptCount: rows.length,
      bestScore: best.score,
      latestScore: latest?.score ?? null,
      lastAssessmentAt: latest?.submittedAt.toISOString() ?? null,
      latestAccuracyRate: latest?.accuracyRate ?? null,
      latestSubmittedAt: latest?.submittedAt.toISOString() ?? null,
      history: sorted.map((row) => ({ id: row.id, score: row.score, submittedAt: row.submittedAt.toISOString() })),
    };
  }
}

function emptyFacts(): DashboardAssessmentFacts {
  return { source: 'empty', attemptCount: 0, bestScore: null, latestScore: null, lastAssessmentAt: null, latestAccuracyRate: null, latestSubmittedAt: null, history: [] };
}
