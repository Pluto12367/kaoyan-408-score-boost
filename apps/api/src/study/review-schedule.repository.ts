import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type ReviewStability = 'learning' | 'review' | 'mastered';

export interface ReviewScheduleState {
  questionId: string;
  userId: string;
  inferredReason?: string;
  selfReportedReason?: string;
  note?: string;
  redoCorrect: boolean;
  timeSpentSec: number;
  consecutiveCorrect: number;
  stability: ReviewStability;
  nextReviewAt: string;
  reviewCount: number;
  lastReviewedAt?: string;
}

export interface ReviewAttemptState {
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
          redoCorrect: row.attempts.at(-1)?.redoCorrect ?? false,
          timeSpentSec: row.attempts.at(-1)?.timeSpentSec ?? 0,
          consecutiveCorrect: row.consecutiveCorrect,
          stability: row.stability as ReviewStability,
          nextReviewAt: row.nextReviewAt.toISOString(),
          reviewCount: row.reviewCount,
          lastReviewedAt: row.lastReviewedAt?.toISOString(),
        },
        attempts: row.attempts.map((attempt) => ({
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

  async saveSchedule(schedule: ReviewScheduleState) {
    if (!this.enabled) return;
    await this.prisma.reviewSchedule.upsert({
      where: { userId_questionId: { userId: schedule.userId, questionId: schedule.questionId } },
      create: toScheduleData(schedule),
      update: toScheduleUpdate(schedule),
    });
  }

  async saveReview(schedule: ReviewScheduleState, attempt: ReviewAttemptState) {
    if (!this.enabled) return;
    await this.prisma.$transaction(async (tx) => {
      const saved = await tx.reviewSchedule.upsert({
        where: { userId_questionId: { userId: schedule.userId, questionId: schedule.questionId } },
        create: toScheduleData(schedule),
        update: toScheduleUpdate(schedule),
      });
      await tx.reviewAttempt.create({
        data: {
          scheduleId: saved.id,
          redoCorrect: attempt.redoCorrect,
          timeSpentSec: attempt.timeSpentSec,
          reportedReason: attempt.reportedReason,
          inferredReason: attempt.inferredReason,
          nextIntervalDays: attempt.nextIntervalDays,
          reviewedAt: new Date(attempt.reviewedAt),
        },
      });
    });
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
    consecutiveCorrect: schedule.consecutiveCorrect,
    stability: schedule.stability,
    nextReviewAt: new Date(schedule.nextReviewAt),
    reviewCount: schedule.reviewCount,
    lastReviewedAt: schedule.lastReviewedAt ? new Date(schedule.lastReviewedAt) : null,
  };
}

function toScheduleUpdate(schedule: ReviewScheduleState) {
  return {
    inferredReason: schedule.inferredReason,
    selfReportedReason: schedule.selfReportedReason,
    note: schedule.note,
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
