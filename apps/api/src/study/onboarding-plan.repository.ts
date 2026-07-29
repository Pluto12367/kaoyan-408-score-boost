import { BadRequestException, Injectable } from '@nestjs/common';
import { TrialStatus, type Prisma } from '@prisma/client';
import { mergePostExamTasks, type Subject } from '@kaoyan408/shared';
import { PrismaService } from '../prisma/prisma.service';

export type ScheduledTaskStatus = 'pending' | 'in_progress' | 'postponed' | 'completed';

export interface OnboardingProfileState {
  examYear?: number;
  targetScore: number;
  currentScore: number;
  remainingDays: number;
  dailyHours: number;
  weakestSubject: Subject;
  completedAt: string;
}

export interface ScheduledStudyTaskState {
  id: string;
  knowledgePointId: string;
  subject: Subject;
  chapter: string;
  title: string;
  mode: string;
  minutes: number;
  questionCount: number;
  scheduledDate: string;
  priority: '高' | '中' | '低';
  reason: string;
  nextAction: string;
  status: ScheduledTaskStatus;
  postponeCount: number;
  startedAt?: string;
  nextAvailableAt?: string;
  completedAt?: string;
}

export interface SevenDayPlanState {
  id: string;
  userId: string;
  phase: string;
  targetScore: number;
  remainingDays: number;
  dailyHours: number;
  checkpoint: string;
  startDate: string;
  tasks: ScheduledStudyTaskState[];
}

export interface FutureTaskAdjustment {
  questionCount: number;
  intensity: 'increase' | 'decrease' | 'hold';
  reason: string;
  nextAction: string;
}

export interface CompletedTaskMutation {
  task: ScheduledStudyTaskState;
  futureTask: ScheduledStudyTaskState | null;
}

export function nearestAvailableStudyDate(
  tasks: ReadonlyArray<Pick<ScheduledStudyTaskState, 'scheduledDate'>>,
  scheduledDate: string,
): string {
  let targetDate = nextStudyDate(scheduledDate);
  while (tasks.filter((task) => task.scheduledDate === targetDate).length >= 3) {
    targetDate = nextStudyDate(targetDate);
  }
  return targetDate;
}

type StudyPlanWithTasks = Prisma.StudyPlanGetPayload<{
  include: { tasks: true };
}>;

@Injectable()
export class OnboardingPlanRepository {
  constructor(private readonly prisma: PrismaService) {}

  get enabled() {
    return Boolean(process.env.DATABASE_URL);
  }

  async load() {
    const profiles = new Map<string, OnboardingProfileState>();
    const plans = new Map<string, SevenDayPlanState>();
    if (!this.enabled) return { profiles, plans };

    const users = await this.prisma.user.findMany({
      where: { onboardingCompletedAt: { not: null } },
    });
    for (const user of users) {
      if (user.targetScore == null || user.currentScore == null || user.remainingDays == null || user.dailyHours == null || !user.weakestSubject) continue;
      profiles.set(user.id, {
        examYear: user.examYear ?? undefined,
        targetScore: user.targetScore,
        currentScore: user.currentScore,
        remainingDays: user.remainingDays,
        dailyHours: user.dailyHours,
        weakestSubject: user.weakestSubject as Subject,
        completedAt: user.onboardingCompletedAt!.toISOString(),
      });
    }

    const rows = await this.prisma.studyPlan.findMany({
      where: { status: 'ACTIVE' },
      include: { tasks: { orderBy: [{ scheduledDate: 'asc' }, { id: 'asc' }] } },
      orderBy: { createdAt: 'desc' },
    });
    for (const row of rows) {
      if (plans.has(row.userId)) continue;
      plans.set(row.userId, this.mapPlan(row));
    }
    return { profiles, plans };
  }

  async saveOnboarding(
    userId: string,
    profile: OnboardingProfileState,
    plan: SevenDayPlanState,
  ): Promise<SevenDayPlanState> {
    if (!this.enabled) return plan;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
      const activePlans = await tx.studyPlan.findMany({
        where: { userId, status: 'ACTIVE' },
        include: { tasks: { orderBy: [{ scheduledDate: 'asc' }, { id: 'asc' }] } },
        orderBy: { createdAt: 'desc' },
      });
      const reviewTasks = activePlans
        .flatMap((activePlan) => activePlan.tasks)
        .filter((task) =>
          task.status !== 'completed'
          && (task.mode === '考后复盘' || task.id.startsWith('exam-review-')),
        )
        .map((task) => this.mapTask(task));
      const mergedTasks = mergePostExamTasks(plan.tasks, reviewTasks);
      const reviewTaskIds = new Set(reviewTasks.map((task) => task.id));
      const mergedReviewTasks = mergedTasks.filter((task) => reviewTaskIds.has(task.id));

      await tx.user.update({
        where: { id: userId },
        data: {
          examYear: profile.examYear,
          onboardingCompletedAt: new Date(profile.completedAt),
        },
      });
      await tx.user.updateMany({
        where: { id: userId, trialStatus: TrialStatus.INVITED },
        data: { trialStatus: TrialStatus.ACTIVE },
      });
      await tx.studyPlan.updateMany({ where: { userId, status: 'ACTIVE' }, data: { status: 'ARCHIVED' } });
      const created = await tx.studyPlan.create({
        data: {
          id: plan.id,
          userId,
          phase: plan.phase,
          targetScore: plan.targetScore,
          remainingDays: plan.remainingDays,
          dailyHours: plan.dailyHours,
          checkpoint: plan.checkpoint,
          tasks: {
            create: mergedTasks
              .filter((task) => !reviewTaskIds.has(task.id))
              .map((task) => this.taskData(task)),
          },
        },
        select: { id: true },
      });

      for (const task of mergedReviewTasks) {
        await tx.studyTask.update({
          where: { id: task.id },
          data: { planId: created.id, scheduledDate: task.scheduledDate },
        });
      }

      const reviewDatesByTaskId = new Map(
        mergedReviewTasks.map((task) => [task.id, task.scheduledDate]),
      );
      if (reviewDatesByTaskId.size > 0) {
        const reviewPlans = await tx.examReviewPlan.findMany({ where: { userId } });
        for (const reviewPlan of reviewPlans) {
          const days = reviewPlan.days as unknown as Array<Record<string, unknown>>;
          if (!Array.isArray(days)) continue;
          let changed = false;
          const synchronizedDays = days.map((day) => {
            const taskId = typeof day.taskId === 'string' ? day.taskId : '';
            const date = reviewDatesByTaskId.get(taskId);
            if (!date || day.date === date) return day;
            changed = true;
            return { ...day, date };
          });
          if (changed) {
            await tx.examReviewPlan.update({
              where: { id: reviewPlan.id },
              data: { days: synchronizedDays as Prisma.InputJsonValue },
            });
          }
        }
      }

      const persisted = await tx.studyPlan.findUniqueOrThrow({
        where: { id: created.id },
        include: { tasks: { orderBy: [{ scheduledDate: 'asc' }, { id: 'asc' }] } },
      });
      return this.mapPlan(persisted);
    });
  }

  async postponeTask(userId: string, taskId: string) {
    if (!this.enabled) return null;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
      const plan = await tx.studyPlan.findFirst({
        where: { userId, status: 'ACTIVE' },
        include: { tasks: { orderBy: [{ scheduledDate: 'asc' }, { id: 'asc' }] } },
        orderBy: { createdAt: 'desc' },
      });
      const task = plan?.tasks.find((item) => item.id === taskId);
      if (!plan || !task) return null;
      if (task.status === 'completed') throw new BadRequestException('Completed task cannot be postponed');

      const targetDate = nearestAvailableStudyDate(plan.tasks, task.scheduledDate);
      const nextAvailableAt = new Date(`${targetDate}T00:00:00.000Z`);
      const updated = await tx.studyTask.update({
        where: { id: task.id },
        data: {
          status: 'postponed',
          postponeCount: task.postponeCount + 1,
          scheduledDate: targetDate,
          nextAvailableAt,
        },
      });
      return this.mapTask(updated);
    });
  }

  async startTask(userId: string, taskId: string, startedAt: string) {
    if (!this.enabled) return null;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
      const task = await tx.studyTask.findFirst({
        where: { id: taskId, plan: { userId, status: 'ACTIVE' } },
      });
      if (!task) return null;
      if (task.status === 'completed') throw new BadRequestException('Completed task cannot be started again');
      const updated = await tx.studyTask.update({
        where: { id: task.id },
        data: {
          status: 'in_progress',
          startedAt: task.startedAt ?? new Date(startedAt),
          nextAvailableAt: null,
        },
      });
      return this.mapTask(updated);
    });
  }

  async completeTask(
    userId: string,
    taskId: string,
    completedAt: string,
    adjustment: FutureTaskAdjustment,
  ): Promise<CompletedTaskMutation | null> {
    if (!this.enabled) return null;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
      const plan = await tx.studyPlan.findFirst({
        where: { userId, status: 'ACTIVE' },
        include: { tasks: { orderBy: [{ scheduledDate: 'asc' }, { id: 'asc' }] } },
        orderBy: { createdAt: 'desc' },
      });
      const task = plan?.tasks.find((item) => item.id === taskId);
      if (!plan || !task) return null;
      if (task.status === 'completed') {
        throw new BadRequestException(`Study task ${taskId} has already been completed`);
      }
      const completed = await tx.studyTask.update({
        where: { id: task.id },
        data: {
          status: 'completed',
          completedAt: new Date(completedAt),
          nextAvailableAt: null,
          completed: true,
        },
      });

      const future = plan.tasks
        .filter((item) =>
          item.knowledgePointId === task.knowledgePointId
          && item.scheduledDate > task.scheduledDate
          && item.status !== 'completed'
          && item.mode !== '考后复盘'
          && !item.id.startsWith('exam-review-'),
        )
        .sort((left, right) => left.scheduledDate.localeCompare(right.scheduledDate) || left.id.localeCompare(right.id))[0];
      const updatedFuture = future
        ? await tx.studyTask.update({
          where: { id: future.id },
          data: {
            questionCount: adjustment.questionCount,
            mode: adjustment.intensity === 'increase'
              ? '进阶训练'
              : adjustment.intensity === 'decrease'
                ? '概念复盘'
                : future.mode,
            reason: adjustment.reason,
            nextAction: adjustment.nextAction,
          },
        })
        : null;

      return {
        task: this.mapTask(completed),
        futureTask: updatedFuture ? this.mapTask(updatedFuture) : null,
      };
    });
  }

  private mapTask(task: Prisma.StudyTaskGetPayload<object>): ScheduledStudyTaskState {
    return {
      id: task.id,
      knowledgePointId: task.knowledgePointId,
      subject: task.subject as Subject,
      chapter: task.chapter,
      title: task.title,
      mode: task.mode,
      minutes: task.minutes,
      questionCount: task.questionCount,
      scheduledDate: task.scheduledDate,
      priority: task.priority as ScheduledStudyTaskState['priority'],
      reason: task.reason,
      nextAction: task.nextAction,
      status: task.status as ScheduledTaskStatus,
      postponeCount: task.postponeCount,
      startedAt: task.startedAt?.toISOString(),
      nextAvailableAt: task.nextAvailableAt?.toISOString(),
      completedAt: task.completedAt?.toISOString(),
    };
  }

  private mapPlan(plan: StudyPlanWithTasks): SevenDayPlanState {
    return {
      id: plan.id,
      userId: plan.userId,
      phase: plan.phase,
      targetScore: plan.targetScore,
      remainingDays: plan.remainingDays,
      dailyHours: plan.dailyHours,
      checkpoint: plan.checkpoint,
      startDate: plan.tasks[0]?.scheduledDate ?? plan.createdAt.toISOString().slice(0, 10),
      tasks: plan.tasks.map((task) => this.mapTask(task)),
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

function nextStudyDate(date: string) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}
