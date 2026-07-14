import { Injectable } from '@nestjs/common';
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

  async saveWrongQuestionReview(userId: string, questionId: string, reviewedAt: string) {
    if (!this.enabled) return;
    await this.prisma.wrongQuestionReview.upsert({
      where: { userId_questionId: { userId, questionId } },
      create: { userId, questionId, reviewedAt: new Date(reviewedAt) },
      update: { reviewedAt: new Date(reviewedAt) },
    });
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
