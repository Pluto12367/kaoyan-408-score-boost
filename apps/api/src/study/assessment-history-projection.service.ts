import { Injectable } from '@nestjs/common';
import { buildAssessmentHistorySnapshot, type AssessmentHistorySnapshot } from './assessment-history.snapshot';
import { AssessmentProjectionService } from './assessment-projection.service';

interface PersistedAssessmentHistoryRow {
  id: string;
  userId: string;
  title: string;
  submittedAt: Date;
  score: number;
  totalScore: number;
  accuracyRate: number;
  elapsedSec: number;
  unansweredCount: number;
  weakPointTitle: string;
  reviewSuggestion: string;
}

@Injectable()
export class AssessmentHistoryProjectionService {
  constructor(private readonly assessmentProjection: AssessmentProjectionService) {}

  async getSnapshot(userId: string, asOf: Date = new Date()): Promise<AssessmentHistorySnapshot> {
    if (!process.env.DATABASE_URL) {
      return buildAssessmentHistorySnapshot({ userId, asOf });
    }

    const rows = await this.assessmentProjection['prisma'].assessmentHistoryItem.findMany({
      where: { userId, submittedAt: { lte: asOf } },
      orderBy: { submittedAt: 'asc' },
      select: {
        id: true,
        userId: true,
        title: true,
        submittedAt: true,
        score: true,
        totalScore: true,
        accuracyRate: true,
        elapsedSec: true,
        unansweredCount: true,
        weakPointTitle: true,
        reviewSuggestion: true,
      },
    }) as PersistedAssessmentHistoryRow[];

    const items = rows
      .slice()
      .sort((left, right) => right.submittedAt.getTime() - left.submittedAt.getTime())
      .map((row) => ({
        id: row.id,
        title: row.title,
        submittedAt: row.submittedAt.toISOString(),
        score: row.score,
        totalScore: row.totalScore,
        accuracyRate: row.accuracyRate,
        elapsedSec: row.elapsedSec,
        unansweredCount: row.unansweredCount,
        weakPointTitle: row.weakPointTitle,
        reviewSuggestion: row.reviewSuggestion,
      }));

    return buildAssessmentHistorySnapshot({
      userId,
      asOf,
      items,
      latestSubmittedAt: items[0]?.submittedAt ?? null,
    });
  }
}
