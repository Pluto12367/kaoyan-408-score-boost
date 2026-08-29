import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StudentStateProjectionService } from './student-state-projection.service';
import { studyDateKey, lastNDatesEndingAt } from './study-date';
import { ActivityProjectionService } from './activity-projection.service';
import {
  buildSprintPlanDto,
  type SprintPlanDto,
  type SprintPlanTaskFocus,
} from './student-state-sprint-plan.adapter';

interface SprintPlanActivitySignal {
  todayPracticeCount: number;
  accuracyRate: number | null;
}

@Injectable()
export class StudentStateSprintPlanQueryService {
  constructor(
    private readonly studentStateProjection: StudentStateProjectionService,
    private readonly prisma: PrismaService,
    private readonly activityProjection: ActivityProjectionService = new ActivityProjectionService(),
  ) {}

  async getSprintPlanCompat(
    userId: string,
    generatedAt: Date | string = new Date(),
  ): Promise<SprintPlanDto> {
    const asOf = toDate(generatedAt);
    const dates = nextDateKeysFrom(asOf, 7);
    const snapshot = await this.studentStateProjection.getSnapshot(userId, asOf);
    const [planTasks, dailyTargetQuestionCount, activity] = await Promise.all([
      this.getActivePlanTasks(userId, dates),
      this.getDailyTargetQuestionCount(),
      this.getActivity(userId, asOf),
    ]);

    return buildSprintPlanDto({
      snapshot,
      generatedAt: asOf,
      dates,
      planTasks,
      dailyTargetQuestionCount,
      todayPracticeCount: activity.todayPracticeCount,
      accuracyRate: activity.accuracyRate,
    });
  }

  private async getActivePlanTasks(
    userId: string,
    dates: string[],
  ): Promise<SprintPlanTaskFocus[]> {
    if (!process.env.DATABASE_URL) return [];

    const plan = await this.prisma.studyPlan.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
        source: null,
      },
      select: {
        tasks: {
          where: {
            scheduledDate: { in: dates },
          },
          select: {
            id: true,
            title: true,
            scheduledDate: true,
            status: true,
          },
          orderBy: [
            { scheduledDate: 'asc' },
            { id: 'asc' },
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return (plan?.tasks ?? [])
      .filter((task) => task.status !== 'completed')
      .map((task) => ({ title: task.title }));
  }

  private async getDailyTargetQuestionCount(): Promise<number> {
    if (!process.env.DATABASE_URL) return 30;

    const row = await this.prisma.systemConfig.findFirst({
      orderBy: { id: 'desc' },
      select: { recommendation: true },
    });
    const recommendation = row?.recommendation;
    if (!isRecord(recommendation)) return 30;
    const value = recommendation.dailyTargetQuestionCount;
    return typeof value === 'number' && Number.isFinite(value) ? value : 30;
  }

  private async getActivity(
    userId: string,
    asOf: Date,
  ): Promise<SprintPlanActivitySignal> {
    if (!process.env.DATABASE_URL) return { todayPracticeCount: 0, accuracyRate: null };

    const rows = await this.prisma.practiceRecord.findMany({
      where: {
        userId,
        submittedAt: { lte: asOf },
      },
      select: {
        correct: true,
        submittedAt: true,
      },
      orderBy: { submittedAt: 'desc' },
      take: 200,
    });
    const activity = this.activityProjection.buildSnapshot({
      dates: lastNDatesEndingAt(asOf, 7),
      practiceRecords: rows,
      taskCompletions: [],
    });
    const correctCount = rows.filter((row) => row.correct).length;

    return {
      todayPracticeCount: activity.todayPracticeCount,
      accuracyRate: rows.length ? Math.round((correctCount / rows.length) * 100) : null,
    };
  }
}

function nextDateKeysFrom(asOf: Date, count: number): string[] {
  const today = new Date(`${studyDateKey(asOf)}T00:00:00.000Z`);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}
