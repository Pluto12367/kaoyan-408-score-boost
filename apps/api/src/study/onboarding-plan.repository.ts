import { Injectable } from '@nestjs/common';
import { TrialStatus } from '@prisma/client';
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
        tasks: row.tasks.map((task) => ({
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
        })),
      });
    }
    return { profiles, plans };
  }

  async saveOnboarding(userId: string, profile: OnboardingProfileState, plan: SevenDayPlanState) {
    if (!this.enabled) return;
    await this.prisma.$transaction(async (tx) => {
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

  async saveTask(userId: string, task: ScheduledStudyTaskState) {
    if (!this.enabled) return;
    const owned = await this.prisma.studyTask.findFirst({
      where: { id: task.id, plan: { userId, status: 'ACTIVE' } },
      select: { id: true },
    });
    if (!owned) return;
    await this.prisma.studyTask.update({
      where: { id: task.id },
      data: {
        minutes: task.minutes,
        questionCount: task.questionCount,
        scheduledDate: task.scheduledDate,
        mode: task.mode,
        reason: task.reason,
        nextAction: task.nextAction,
        status: task.status,
        postponeCount: task.postponeCount,
        startedAt: task.startedAt ? new Date(task.startedAt) : null,
        nextAvailableAt: task.nextAvailableAt ? new Date(task.nextAvailableAt) : null,
        completedAt: task.completedAt ? new Date(task.completedAt) : null,
        completed: task.status === 'completed',
      },
    });
  }
}
