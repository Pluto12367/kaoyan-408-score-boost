import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface PersistedLearningProgress {
  completedTasks: Map<string, Map<string, string>>;
  wrongQuestionReviews: Map<string, Map<string, string>>;
}

@Injectable()
export class LearningProgressRepository {
  constructor(private readonly prisma: PrismaService) {}

  get enabled() {
    return Boolean(process.env.DATABASE_URL);
  }

  async load(): Promise<PersistedLearningProgress> {
    const completedTasks = new Map<string, Map<string, string>>();
    const wrongQuestionReviews = new Map<string, Map<string, string>>();
    if (!this.enabled) return { completedTasks, wrongQuestionReviews };

    const [taskRows, reviewRows] = await Promise.all([
      this.prisma.studyTaskCompletion.findMany({ orderBy: { completedAt: 'asc' } }),
      this.prisma.wrongQuestionReview.findMany({ orderBy: { reviewedAt: 'asc' } }),
    ]);

    for (const row of taskRows) {
      const userTasks = completedTasks.get(row.userId) ?? new Map<string, string>();
      userTasks.set(taskCompletionKey(row.taskId, row.completedDate), row.completedDate);
      completedTasks.set(row.userId, userTasks);
    }
    for (const row of reviewRows) {
      const userReviews = wrongQuestionReviews.get(row.userId) ?? new Map<string, string>();
      userReviews.set(row.questionId, row.reviewedAt.toISOString());
      wrongQuestionReviews.set(row.userId, userReviews);
    }

    return { completedTasks, wrongQuestionReviews };
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
    completedQuestionCount?: number;
    correctCount?: number;
    minutesSpent?: number;
    selfRating?: number;
  }) {
    if (!this.enabled) return;
    const data = {
      completedAt: new Date(input.completedAt),
      completedDate: input.completedAt.slice(0, 10),
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
