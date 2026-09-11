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
  /**
   * V12-M3-B — the caller's own declaration, recorded verbatim. `undefined`
   * means "not supplied" and is stored as NULL, which readers must treat as
   * unknown rather than as false.
   */
  isReview?: boolean | null;
  /** V12-M3-B — closed set: 'recommendation_action' | 'wrong_question'. */
  source?: string | null;
}

/** The factual outcome of persisting one review attempt. */
export interface SavedReviewAttempt {
  /** V12-M3-A — the stable per-occurrence identity used by the evidence key. */
  attemptId: string;
  /** The schedule row this attempt belongs to (already the attempt's FK). */
  scheduleId: string;
  /** The schedule's nextReviewAt immediately BEFORE this attempt (the due time). */
  dueAt: string | null;
  /** Whether an existing schedule row was already due when the attempt happened. */
  scheduleDriven: boolean;
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

  /**
   * Persists the schedule and one attempt, and returns the attempt's factual
   * identity (V12-M3-A: the evidence receipt is keyed by it) plus the
   * schedule-time facts V12-M3-B asked for.
   *
   * `dueAt` and `scheduleDriven` are read from the schedule row INSIDE the same
   * transaction, before the upsert overwrites `nextReviewAt` — so they describe
   * the due time this attempt actually answered, and cannot be clobbered by a
   * concurrent review of the same question.
   *
   * Returns null when the store is unavailable: there is then no durable
   * attempt, and the caller must not project mastery from a non-existent one.
   */
  async saveReview(
    schedule: ReviewScheduleState,
    attempt: ReviewAttemptState,
    tx?: Prisma.TransactionClient,
  ): Promise<SavedReviewAttempt | null> {
    if (!this.enabled) return null;
    const save = async (db: Prisma.TransactionClient | PrismaService): Promise<SavedReviewAttempt> => {
      const prior = await db.reviewSchedule.findUnique({
        where: { userId_questionId: { userId: schedule.userId, questionId: schedule.questionId } },
        select: { nextReviewAt: true },
      });
      const reviewedAt = new Date(attempt.reviewedAt);
      const dueAt = prior?.nextReviewAt ?? null;
      // A factual timestamp comparison, not a derived score: was the schedule
      // already due when this redo happened.
      const scheduleDriven = dueAt != null && dueAt.getTime() <= reviewedAt.getTime();

      const saved = await db.reviewSchedule.upsert({
        where: { userId_questionId: { userId: schedule.userId, questionId: schedule.questionId } },
        create: toScheduleData(schedule),
        update: toScheduleUpdate(schedule),
      });
      const created = await db.reviewAttempt.create({
        data: {
          scheduleId: saved.id,
          redoCorrect: attempt.redoCorrect,
          timeSpentSec: attempt.timeSpentSec,
          reportedReason: attempt.reportedReason,
          inferredReason: attempt.inferredReason,
          actionId: attempt.actionId ?? null,
          idempotencyKey: attempt.idempotencyKey ?? null,
          nextIntervalDays: attempt.nextIntervalDays,
          reviewedAt,
          isReview: attempt.isReview ?? null,
          source: attempt.source ?? null,
          scheduleDriven,
          dueAt,
        },
      });
      return {
        attemptId: created.id,
        scheduleId: saved.id,
        dueAt: dueAt ? dueAt.toISOString() : null,
        scheduleDriven,
        reviewedAt: reviewedAt.toISOString(),
      };
    };
    if (tx) return save(tx);
    return this.prisma.$transaction(save);
  }

  /**
   * V12-M3 — recent review attempts for one user, newest first.
   * Read-only input for the review-semantics shadow and the review→mastery
   * shadow; never used on a write path.
   *
   * `attemptId` / `scheduleId` / `idempotencyKey` exist so each attempt can be
   * given a stable, collision-free identity downstream (`reviewEventIdOf`).
   */
  async listAttemptsByUser(userId: string, limit = 200): Promise<Array<{
    attemptId: string;
    scheduleId: string;
    questionId: string;
    reviewedAt: string;
    redoCorrect: boolean;
    nextIntervalDays: number;
    idempotencyKey: string | null;
    isReview: boolean | null;
    scheduleDriven: boolean | null;
    source: string | null;
    dueAt: string | null;
  }>> {
    if (!this.enabled) return [];
    const rows = await this.prisma.reviewAttempt.findMany({
      where: { schedule: { userId } },
      orderBy: { reviewedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        scheduleId: true,
        reviewedAt: true,
        redoCorrect: true,
        nextIntervalDays: true,
        idempotencyKey: true,
        isReview: true,
        scheduleDriven: true,
        source: true,
        dueAt: true,
        schedule: { select: { questionId: true } },
      },
    });
    return rows.map((row) => ({
      attemptId: row.id,
      scheduleId: row.scheduleId,
      questionId: row.schedule.questionId,
      reviewedAt: row.reviewedAt.toISOString(),
      redoCorrect: row.redoCorrect,
      nextIntervalDays: row.nextIntervalDays,
      idempotencyKey: row.idempotencyKey ?? null,
      isReview: row.isReview ?? null,
      scheduleDriven: row.scheduleDriven ?? null,
      source: row.source ?? null,
      dueAt: row.dueAt ? row.dueAt.toISOString() : null,
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
