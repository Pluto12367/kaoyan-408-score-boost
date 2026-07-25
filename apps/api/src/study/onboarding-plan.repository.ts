import { BadRequestException, Injectable } from '@nestjs/common';
import { TrialStatus, type Prisma } from '@prisma/client';
import type { Subject } from '@kaoyan408/shared';
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
      plans.set(row.userId, {
        id: row.id,
        userId: row.userId,
        phase: row.phase,
        targetScore: row.targetScore,
        remainingDays: row.remainingDays,
        dailyHours: row.dailyHours,
        checkpoint: row.checkpoint,
        startDate: row.tasks[0]?.scheduledDate ?? row.createdAt.toISOString().slice(0, 10),
        tasks: row.tasks.map((task) => this.mapTask(task)),
      });
    }
    return { profiles, plans };
  }

  async saveOnboarding(userId: string, profile: OnboardingProfileState, plan: SevenDayPlanState) {
    if (!this.enabled) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
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
      await tx.studyPlan.create({
        data: {
          id: plan.id,
          userId,
          phase: plan.phase,
          targetScore: plan.targetScore,
          remainingDays: plan.remainingDays,
          dailyHours: plan.dailyHours,
          checkpoint: plan.checkpoint,
          tasks: {
            create: plan.tasks.map((task) => ({
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
            })),
          },
        },
      });
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

      const dates = [...new Set(plan.tasks.map((item) => item.scheduledDate))].sort();
      const targetDate = dates
        .filter((date) => date > task.scheduledDate)
        .find((date) => plan.tasks.filter((item) => item.scheduledDate === date).length < 3)
        ?? nextStudyDate(dates.at(-1) ?? task.scheduledDate);
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
}

function nextStudyDate(date: string) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}
