import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { mergePostExamTasks } from '@kaoyan408/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { ScheduledStudyTaskState, SevenDayPlanState } from './onboarding-plan.repository';

export interface ExamReviewDay {
  dayIndex: number;
  date: string;
  taskId: string;
  knowledgePointId: string;
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

export interface SaveActionableReviewPlanInput {
  reviewPlan: ExamReviewPlanState;
  reviewTasks: ScheduledStudyTaskState[];
  fallbackPlan: SevenDayPlanState;
}

type StudyPlanWithTasks = Prisma.StudyPlanGetPayload<{
  include: { tasks: true };
}>;

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
    await this.prisma.$transaction((tx) => this.upsertExamReviewPlan(tx, plan));
  }

  async saveActionablePlan(input: SaveActionableReviewPlanInput): Promise<{
    reviewPlan: ExamReviewPlanState;
    studyPlan: SevenDayPlanState;
  }> {
    if (!this.enabled) {
      const tasks = mergePostExamTasks(input.fallbackPlan.tasks, input.reviewTasks);
      return {
        reviewPlan: this.withActualDates(input.reviewPlan, tasks),
        studyPlan: { ...input.fallbackPlan, tasks },
      };
    }

    return this.prisma.$transaction(async (tx) => {
      const session = await tx.learningSession.findFirst({
        where: {
          id: input.reviewPlan.examSessionId,
          userId: input.reviewPlan.userId,
          type: 'paper',
          completed: true,
        },
        select: { id: true },
      });
      if (!session) throw new BadRequestException('Exam session is not a completed paper owned by this user');

      let row = await tx.studyPlan.findFirst({
        where: { userId: input.reviewPlan.userId, status: 'ACTIVE' },
        include: { tasks: { orderBy: [{ scheduledDate: 'asc' }, { id: 'asc' }] } },
        orderBy: { createdAt: 'desc' },
      });
      if (!row) row = await this.createPlan(tx, input.fallbackPlan);

      const current = this.mapStudyPlan(row);
      const tasks = mergePostExamTasks(current.tasks, input.reviewTasks);
      const reviewTaskIds = new Set(input.reviewTasks.map((task) => task.id));
      const mergedTasksById = new Map(tasks.map((task) => [task.id, task]));

      for (const task of input.reviewTasks) {
        const existing = await tx.studyTask.findUnique({ where: { id: task.id } });
        if (existing && existing.planId !== current.id) {
          throw new BadRequestException('Post-exam review task ID belongs to another study plan');
        }
        if (!existing) {
          await tx.studyTask.create({
            data: { ...this.taskData(mergedTasksById.get(task.id) ?? task), planId: current.id },
          });
        }
      }

      await this.persistSchedule(tx, current.tasks, tasks, reviewTaskIds);
      const reviewPlan = this.withActualDates(input.reviewPlan, tasks);
      await this.upsertExamReviewPlan(tx, reviewPlan);
      return { reviewPlan, studyPlan: { ...current, tasks } };
    });
  }

  private async upsertExamReviewPlan(tx: Prisma.TransactionClient, plan: ExamReviewPlanState) {
    await tx.examReviewPlan.upsert({
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

  private async createPlan(tx: Prisma.TransactionClient, plan: SevenDayPlanState): Promise<StudyPlanWithTasks> {
    const created = await tx.studyPlan.create({
      data: {
        id: plan.id,
        userId: plan.userId,
        phase: plan.phase,
        targetScore: plan.targetScore,
        remainingDays: plan.remainingDays,
        dailyHours: plan.dailyHours,
        checkpoint: plan.checkpoint,
        tasks: { create: plan.tasks.map((task) => this.taskData(task)) },
      },
      select: { id: true },
    });
    return tx.studyPlan.findUniqueOrThrow({
      where: { id: created.id },
      include: { tasks: { orderBy: [{ scheduledDate: 'asc' }, { id: 'asc' }] } },
    });
  }

  private mapStudyPlan(row: StudyPlanWithTasks): SevenDayPlanState {
    return {
      id: row.id,
      userId: row.userId,
      phase: row.phase,
      targetScore: row.targetScore,
      remainingDays: row.remainingDays,
      dailyHours: row.dailyHours,
      checkpoint: row.checkpoint,
      startDate: row.tasks[0]?.scheduledDate ?? row.createdAt.toISOString().slice(0, 10),
      tasks: row.tasks.map((task) => ({
        id: task.id,
        knowledgePointId: task.knowledgePointId,
        subject: task.subject as ScheduledStudyTaskState['subject'],
        chapter: task.chapter,
        title: task.title,
        mode: task.mode,
        minutes: task.minutes,
        questionCount: task.questionCount,
        scheduledDate: task.scheduledDate,
        priority: task.priority as ScheduledStudyTaskState['priority'],
        reason: task.reason,
        nextAction: task.nextAction,
        status: task.status as ScheduledStudyTaskState['status'],
        postponeCount: task.postponeCount,
        startedAt: task.startedAt?.toISOString(),
        nextAvailableAt: task.nextAvailableAt?.toISOString(),
        completedAt: task.completedAt?.toISOString(),
      })),
    };
  }

  private async persistSchedule(
    tx: Prisma.TransactionClient,
    currentTasks: ScheduledStudyTaskState[],
    tasks: ScheduledStudyTaskState[],
    reviewTaskIds: Set<string>,
  ) {
    const currentDates = new Map(currentTasks.map((task) => [task.id, task.scheduledDate]));
    for (const task of tasks) {
      if (reviewTaskIds.has(task.id) || currentDates.get(task.id) === task.scheduledDate) continue;
      await tx.studyTask.update({ where: { id: task.id }, data: { scheduledDate: task.scheduledDate } });
    }
  }

  private withActualDates(plan: ExamReviewPlanState, tasks: ScheduledStudyTaskState[]): ExamReviewPlanState {
    const datesByTaskId = new Map(tasks.map((task) => [task.id, task.scheduledDate]));
    return {
      ...plan,
      days: plan.days.map((day) => ({ ...day, date: datesByTaskId.get(day.taskId) ?? day.date })),
    };
  }

  private taskData(task: ScheduledStudyTaskState) {
    return {
      id: task.id,
      knowledgePointId: task.knowledgePointId,
      subject: task.subject,
      chapter: task.chapter,
      title: task.title,
      mode: task.mode,
      minutes: task.minutes,
      questionCount: task.questionCount,
      scheduledDate: task.scheduledDate,
      priority: task.priority,
      reason: task.reason,
      nextAction: task.nextAction,
      status: task.status,
      postponeCount: task.postponeCount,
      startedAt: task.startedAt ? new Date(task.startedAt) : undefined,
      nextAvailableAt: task.nextAvailableAt ? new Date(task.nextAvailableAt) : undefined,
      completedAt: task.completedAt ? new Date(task.completedAt) : undefined,
      completed: task.status === 'completed',
    };
  }
}
