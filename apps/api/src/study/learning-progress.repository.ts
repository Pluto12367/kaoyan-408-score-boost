import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface PersistedLearningProgress {
  completedTasks: Map<string, Map<string, string>>;
  taskCompletionMetrics: Map<string, Map<string, TaskCompletionMetric>>;
  wrongQuestionReviews: Map<string, Map<string, string>>;
}

export interface TaskCompletionMetric {
  completedQuestionCount: number;
  correctCount: number;
  minutesSpent: number;
  selfRating: number;
  completedAt: string;
}

export interface StudyTaskProgressMetric {
  completedQuestionCount: number;
  correctCount: number;
  minutesSpent: number;
}

@Injectable()
export class LearningProgressRepository {
  constructor(private readonly prisma: PrismaService) {}

  get enabled() {
    return Boolean(process.env.DATABASE_URL);
  }

  async load(): Promise<PersistedLearningProgress> {
    const completedTasks = new Map<string, Map<string, string>>();
    const taskCompletionMetrics = new Map<string, Map<string, TaskCompletionMetric>>();
    const wrongQuestionReviews = new Map<string, Map<string, string>>();
    if (!this.enabled) return { completedTasks, taskCompletionMetrics, wrongQuestionReviews };

    const [taskRows, reviewRows] = await Promise.all([
      this.prisma.studyTaskCompletion.findMany({ orderBy: { completedAt: 'asc' } }),
      this.prisma.wrongQuestionReview.findMany({ orderBy: { reviewedAt: 'asc' } }),
    ]);

    for (const row of taskRows) {
      const userTasks = completedTasks.get(row.userId) ?? new Map<string, string>();
      userTasks.set(taskCompletionKey(row.taskId, row.completedDate), row.completedDate);
      completedTasks.set(row.userId, userTasks);
      const userMetrics = taskCompletionMetrics.get(row.userId) ?? new Map<string, TaskCompletionMetric>();
      userMetrics.set(row.taskId, {
        completedQuestionCount: row.completedQuestionCount ?? 0,
        correctCount: row.correctCount ?? 0,
        minutesSpent: row.minutesSpent ?? 0,
        selfRating: row.selfRating ?? 3,
        completedAt: row.completedAt.toISOString(),
      });
      taskCompletionMetrics.set(row.userId, userMetrics);
    }
    for (const row of reviewRows) {
      const userReviews = wrongQuestionReviews.get(row.userId) ?? new Map<string, string>();
      userReviews.set(row.questionId, row.reviewedAt.toISOString());
      wrongQuestionReviews.set(row.userId, userReviews);
    }

    return { completedTasks, taskCompletionMetrics, wrongQuestionReviews };
  }

  async saveWrongQuestionReview(userId: string, questionId: string, reviewedAt: string, tx?: Prisma.TransactionClient) {
    if (!this.enabled) return;
    const db = tx ?? this.prisma;
    await db.wrongQuestionReview.upsert({
      where: { userId_questionId: { userId, questionId } },
      create: { userId, questionId, reviewedAt: new Date(reviewedAt) },
      update: { reviewedAt: new Date(reviewedAt) },
    });
  }

  async loadStudyTaskProgress(userId: string, tx?: Prisma.TransactionClient): Promise<Map<string, StudyTaskProgressMetric>> {
    const progress = new Map<string, StudyTaskProgressMetric>();
    if (!this.enabled) return progress;
    const db = tx ?? this.prisma;
    const rows = await db.studyTaskProgress.findMany({
      where: { userId },
      orderBy: { updatedAt: 'asc' },
    });
    for (const row of rows) {
      progress.set(row.taskId, {
        completedQuestionCount: row.completedQuestionCount,
        correctCount: row.correctCount,
        minutesSpent: row.minutesSpent,
      });
    }
    return progress;
  }

  async incrementStudyTaskProgress(input: {
    userId: string;
    taskId: string;
    completedQuestionIncrement: number;
    correctIncrement: number;
    minutesIncrement: number;
  }, tx?: Prisma.TransactionClient): Promise<StudyTaskProgressMetric & { taskId: string }> {
    if (!this.enabled) {
      return {
        taskId: input.taskId,
        completedQuestionCount: input.completedQuestionIncrement,
        correctCount: input.correctIncrement,
        minutesSpent: input.minutesIncrement,
      };
    }
    const db = tx ?? this.prisma;
    const row = await db.studyTaskProgress.upsert({
      where: {
        userId_taskId: {
          userId: input.userId,
          taskId: input.taskId,
        },
      },
      create: {
        userId: input.userId,
        taskId: input.taskId,
        completedQuestionCount: input.completedQuestionIncrement,
        correctCount: input.correctIncrement,
        minutesSpent: input.minutesIncrement,
      },
      update: {
        completedQuestionCount: { increment: input.completedQuestionIncrement },
        correctCount: { increment: input.correctIncrement },
        minutesSpent: { increment: input.minutesIncrement },
      },
    });
    return {
      taskId: row.taskId,
      completedQuestionCount: row.completedQuestionCount,
      correctCount: row.correctCount,
      minutesSpent: row.minutesSpent,
    };
  }

  async saveTaskCompletion(input: {
    userId: string;
    taskId: string;
    completedAt: string;
    completedDate: string;
    completedQuestionCount?: number;
    correctCount?: number;
    minutesSpent?: number;
    selfRating?: number;
  }) {
    if (!this.enabled) return;
    const data = {
      completedAt: new Date(input.completedAt),
      completedDate: input.completedDate,
      completedQuestionCount: input.completedQuestionCount,
      correctCount: input.correctCount,
      minutesSpent: input.minutesSpent,
      selfRating: input.selfRating,
    };
    await this.prisma.studyTaskCompletion.upsert({
      where: {
        userId_taskId_completedDate: {
          userId: input.userId,
          taskId: input.taskId,
          completedDate: data.completedDate,
        },
      },
      create: { userId: input.userId, taskId: input.taskId, ...data },
      update: data,
    });
  }
}

function taskCompletionKey(taskId: string, completedDate: string) {
  return `${taskId}@${completedDate}`;
}
