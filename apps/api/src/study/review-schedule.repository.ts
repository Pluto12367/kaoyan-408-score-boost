import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type ReviewStability = 'learning' | 'review' | 'mastered';

export interface ReviewScheduleState {
  questionId: string;
  userId: string;
  inferredReason?: string;
  selfReportedReason?: string;
  note?: string;
  lastWrongRecordId?: string;
  redoCorrect: boolean;
  timeSpentSec: number;
  consecutiveCorrect: number;
  stability: ReviewStability;
  nextReviewAt: string;
  reviewCount: number;
  lastReviewedAt?: string;
}

export interface ReviewAttemptState {
  id?: string;
  actionId?: string | null;
  idempotencyKey?: string | null;
  redoCorrect: boolean;
  timeSpentSec: number;
  reportedReason?: string;
  inferredReason?: string;
  nextIntervalDays: number;
  reviewedAt: string;
}

@Injectable()
export class ReviewScheduleRepository {
  constructor(private readonly prisma: PrismaService) {}

  get enabled() {
    return Boolean(process.env.DATABASE_URL);
  }

  async loadAll() {
    const result = new Map<string, { schedule: ReviewScheduleState; attempts: ReviewAttemptState[] }>();
    if (!this.enabled) return result;
    const rows = await this.prisma.reviewSchedule.findMany({
      include: { attempts: { orderBy: { reviewedAt: 'asc' } } },
    });
    for (const row of rows) {
      result.set(scheduleKey(row.userId, row.questionId), {
        schedule: {
          questionId: row.questionId,
          userId: row.userId,
          inferredReason: row.inferredReason ?? undefined,
          selfReportedReason: row.selfReportedReason ?? undefined,
          note: row.note ?? undefined,
          lastWrongRecordId: row.lastWrongRecordId ?? undefined,
          redoCorrect: row.redoCorrect,
          timeSpentSec: row.timeSpentSec,
          consecutiveCorrect: row.consecutiveCorrect,
          stability: row.stability as ReviewStability,
          nextReviewAt: row.nextReviewAt.toISOString(),
          reviewCount: row.reviewCount,
          lastReviewedAt: row.lastReviewedAt?.toISOString(),
        },
        attempts: (row.attempts as Array<typeof row.attempts[number] & { actionId?: string | null; idempotencyKey?: string | null }>).map((attempt) => ({
          id: attempt.id,
          actionId: attempt.actionId ?? null,
          idempotencyKey: attempt.idempotencyKey ?? null,
          redoCorrect: attempt.redoCorrect,
          timeSpentSec: attempt.timeSpentSec,
          reportedReason: attempt.reportedReason ?? undefined,
          inferredReason: attempt.inferredReason ?? undefined,
          nextIntervalDays: attempt.nextIntervalDays,
          reviewedAt: attempt.reviewedAt.toISOString(),
        })),
      });
    }
    return result;
  }

  async saveSchedule(schedule: ReviewScheduleState, tx?: Prisma.TransactionClient) {
    if (!this.enabled) return;
    const db = tx ?? this.prisma;
    await db.reviewSchedule.upsert({
      where: { userId_questionId: { userId: schedule.userId, questionId: schedule.questionId } },
      create: toScheduleData(schedule),
      update: toScheduleUpdate(schedule),
    });
  }

  async saveReview(schedule: ReviewScheduleState, attempt: ReviewAttemptState, tx?: Prisma.TransactionClient) {
    if (!this.enabled) return;
    const save = async (db: Prisma.TransactionClient | PrismaService) => {
      const saved = await db.reviewSchedule.upsert({
        where: { userId_questionId: { userId: schedule.userId, questionId: schedule.questionId } },
        create: toScheduleData(schedule),
        update: toScheduleUpdate(schedule),
      });
      await db.reviewAttempt.create({
        data: {
          scheduleId: saved.id,
          redoCorrect: attempt.redoCorrect,
          timeSpentSec: attempt.timeSpentSec,
          reportedReason: attempt.reportedReason,
          inferredReason: attempt.inferredReason,
          actionId: attempt.actionId ?? null,
          idempotencyKey: attempt.idempotencyKey ?? null,
          nextIntervalDays: attempt.nextIntervalDays,
          reviewedAt: new Date(attempt.reviewedAt),
        } as any,
      });
    };
    if (tx) {
      await save(tx);
      return;
    }
    await this.prisma.$transaction(save);
  }

  /**
   * V12-M3 — recent review attempts for one user, newest first.
   * Read-only input for the review-semantics shadow; never used on a write path.
   */
  async listAttemptsByUser(userId: string, limit = 200): Promise<Array<{
    questionId: string;
    reviewedAt: string;
    redoCorrect: boolean;
    nextIntervalDays: number;
  }>> {
    if (!this.enabled) return [];
    const rows = await this.prisma.reviewAttempt.findMany({
      where: { schedule: { userId } },
      orderBy: { reviewedAt: 'desc' },
      take: limit,
      select: {
        reviewedAt: true,
        redoCorrect: true,
        nextIntervalDays: true,
        schedule: { select: { questionId: true } },
      },
    });
    return rows.map((row) => ({
      questionId: row.schedule.questionId,
      reviewedAt: row.reviewedAt.toISOString(),
      redoCorrect: row.redoCorrect,
      nextIntervalDays: row.nextIntervalDays,
    }));
  }

  async findAttemptByIdempotencyKey(userId: string, questionId: string, idempotencyKey: string): Promise<ReviewAttemptState | null> {
    if (!this.enabled) return null;
    const schedule = await this.prisma.reviewSchedule.findUnique({ where: { userId_questionId: { userId, questionId } } });
    if (!schedule) return null;
    const reviewAttempt = (this.prisma as PrismaService & { reviewAttempt: any }).reviewAttempt;
    const attempt = await reviewAttempt.findUnique({ where: { scheduleId_idempotencyKey: { scheduleId: schedule.id, idempotencyKey } } });
    return attempt ? {
      id: attempt.id,
      actionId: attempt.actionId ?? null,
      idempotencyKey: attempt.idempotencyKey ?? null,
      redoCorrect: attempt.redoCorrect,
      timeSpentSec: attempt.timeSpentSec,
      reportedReason: attempt.reportedReason ?? undefined,
      inferredReason: attempt.inferredReason ?? undefined,
      nextIntervalDays: attempt.nextIntervalDays,
      reviewedAt: attempt.reviewedAt.toISOString(),
    } : null;
  }

  async saveNote(userId: string, questionId: string, note: string) {
    if (!this.enabled) return;
    await this.prisma.reviewSchedule.update({
      where: { userId_questionId: { userId, questionId } },
      data: { note },
    });
  }
}

function toScheduleData(schedule: ReviewScheduleState) {
  return {
    userId: schedule.userId,
    questionId: schedule.questionId,
    inferredReason: schedule.inferredReason,
    selfReportedReason: schedule.selfReportedReason,
    note: schedule.note,
    lastWrongRecordId: schedule.lastWrongRecordId,
    redoCorrect: schedule.redoCorrect,
    timeSpentSec: schedule.timeSpentSec,
    consecutiveCorrect: schedule.consecutiveCorrect,
    stability: schedule.stability,
    nextReviewAt: new Date(schedule.nextReviewAt),
    reviewCount: schedule.reviewCount,
    lastReviewedAt: schedule.lastReviewedAt ? new Date(schedule.lastReviewedAt) : null,
  };
}

function toScheduleUpdate(schedule: ReviewScheduleState) {
  return {
    inferredReason: schedule.inferredReason ?? null,
    selfReportedReason: schedule.selfReportedReason ?? null,
    note: schedule.note,
    lastWrongRecordId: schedule.lastWrongRecordId ?? null,
    redoCorrect: schedule.redoCorrect,
    timeSpentSec: schedule.timeSpentSec,
    consecutiveCorrect: schedule.consecutiveCorrect,
    stability: schedule.stability,
    nextReviewAt: new Date(schedule.nextReviewAt),
    reviewCount: schedule.reviewCount,
    lastReviewedAt: schedule.lastReviewedAt ? new Date(schedule.lastReviewedAt) : null,
  };
}

export function scheduleKey(userId: string, questionId: string) {
  return `${userId}@${questionId}`;
}
