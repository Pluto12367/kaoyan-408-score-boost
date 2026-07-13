import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface ExamReviewDay {
  dayIndex: number;
  date: string;
  focus: string;
  subject: string;
  questionCount: number;
  minutes: number;
  tasks: string[];
}

export interface ExamReviewPlanState {
  userId: string;
  examSessionId: string;
  generatedAt: string;
  examAccuracyRate: number;
  weakPointTitles: string[];
  days: ExamReviewDay[];
  recommendation: string;
}

@Injectable()
export class ExamReviewPlanRepository {
  constructor(private readonly prisma: PrismaService) {}

  get enabled() {
    return Boolean(process.env.DATABASE_URL);
  }

  async loadAll() {
    const plans = new Map<string, ExamReviewPlanState>();
    if (!this.enabled) return plans;
    const rows = await this.prisma.examReviewPlan.findMany();
    for (const row of rows) {
      plans.set(row.sessionId, {
        userId: row.userId,
        examSessionId: row.sessionId,
        generatedAt: row.createdAt.toISOString(),
        examAccuracyRate: row.examAccuracyRate,
        weakPointTitles: row.weakPointTitles,
        days: row.days as unknown as ExamReviewDay[],
        recommendation: row.recommendation,
      });
    }
    return plans;
  }

  async save(plan: ExamReviewPlanState) {
    if (!this.enabled) return;
    await this.prisma.examReviewPlan.upsert({
      where: { sessionId: plan.examSessionId },
      create: {
        sessionId: plan.examSessionId,
        userId: plan.userId,
        days: plan.days as unknown as Prisma.InputJsonValue,
        recommendation: plan.recommendation,
        examAccuracyRate: plan.examAccuracyRate,
        weakPointTitles: plan.weakPointTitles,
        createdAt: new Date(plan.generatedAt),
      },
      update: {
        days: plan.days as unknown as Prisma.InputJsonValue,
        recommendation: plan.recommendation,
        examAccuracyRate: plan.examAccuracyRate,
        weakPointTitles: plan.weakPointTitles,
      },
    });
  }
}
