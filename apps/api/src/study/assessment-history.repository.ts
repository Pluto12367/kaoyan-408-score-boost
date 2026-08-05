import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface PersistedAssessmentHistoryItem {
  id: string;
  sessionId?: string;
  paperId?: string;
  userId: string;
  title: string;
  submittedAt: string;
  score: number;
  totalScore: number;
  accuracyRate: number;
  elapsedSec: number;
  unansweredCount: number;
  weakPointTitle: string;
  reviewSuggestion: string;
}

@Injectable()
export class AssessmentHistoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  get enabled() {
    return Boolean(process.env.DATABASE_URL);
  }

  async loadAll(): Promise<PersistedAssessmentHistoryItem[]> {
    if (!this.enabled) return [];
    const rows = await this.prisma.assessmentHistoryItem.findMany({
      orderBy: { submittedAt: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.sessionId ?? undefined,
      paperId: row.paperId ?? undefined,
      userId: row.userId,
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
  }

  async save(item: PersistedAssessmentHistoryItem): Promise<void> {
    if (!this.enabled) return;
    const data = {
      sessionId: item.sessionId ?? null,
      paperId: item.paperId ?? null,
      userId: item.userId,
      title: item.title,
      submittedAt: new Date(item.submittedAt),
      score: item.score,
      totalScore: item.totalScore,
      accuracyRate: item.accuracyRate,
      elapsedSec: item.elapsedSec,
      unansweredCount: item.unansweredCount,
      weakPointTitle: item.weakPointTitle,
      reviewSuggestion: item.reviewSuggestion,
    };
    await this.prisma.assessmentHistoryItem.upsert({
      where: { id: item.id },
      create: { id: item.id, ...data },
      update: data,
    });
  }
}
