/**
 * LE-V10 F3 M1 — Review Shadow Service (read-only assembly).
 *
 * Loads recent ReviewAttempts (with their schedules for user/question
 * linkage) and the same-question PracticeRecords inside the observation
 * window, then hands both to the pure shadow evaluator. Read-only; the
 * store-unavailable case degrades to null (no shadow conclusions possible).
 */

import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildReviewShadow, type ReviewShadowResult } from '@kaoyan408/shared';

const MAX_ATTEMPTS = 500;
const MAX_PRACTICES = 2000;
const OBSERVATION_HORIZON_DAYS = 17;

@Injectable()
export class ReviewShadowService {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  get enabled() {
    return Boolean(process.env.DATABASE_URL && this.prisma);
  }

  /** null = store unavailable (no conclusions possible, honestly absent). */
  async getReviewShadow(): Promise<ReviewShadowResult | null> {
    if (!this.enabled) return null;
    const db = this.prisma!;
    const since = new Date(Date.now() - (OBSERVATION_HORIZON_DAYS + 30) * 86_400_000);

    const attempts = await db.reviewAttempt.findMany({
      where: { reviewedAt: { gte: since } },
      orderBy: { reviewedAt: 'desc' },
      take: MAX_ATTEMPTS,
      select: {
        reviewedAt: true,
        redoCorrect: true,
        nextIntervalDays: true,
        schedule: { select: { userId: true, questionId: true } },
      },
    });
    if (attempts.length === 0) {
    return buildReviewShadow([], []);
    }

    const questionIds = [...new Set(attempts.map((row) => row.schedule.questionId))];
    const practices = await db.practiceRecord.findMany({
      where: { questionId: { in: questionIds }, submittedAt: { gte: since } },
      orderBy: { submittedAt: 'desc' },
      take: MAX_PRACTICES,
      select: {
        userId: true,
        questionId: true,
        submittedAt: true,
        correct: true,
      },
    });

    return buildReviewShadow(
      attempts.map((row) => ({
        userId: row.schedule.userId,
        questionId: row.schedule.questionId,
        reviewedAt: row.reviewedAt.toISOString(),
        redoCorrect: row.redoCorrect,
        nextIntervalDays: row.nextIntervalDays,
      })),
      practices.map((row) => ({
        userId: row.userId,
        questionId: row.questionId,
        practicedAt: row.submittedAt.toISOString(),
        correct: row.correct,
      })),
    );
  }
}

