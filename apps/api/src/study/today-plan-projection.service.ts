import { Injectable } from '@nestjs/common';
import { buildTodayPlanSnapshot } from './today-plan.snapshot';
import type {
  TodayPlanActivityFacts,
  TodayPlanMasteryFacts,
  TodayPlanPlanFacts,
  TodayPlanReviewFacts,
  TodayPlanScoreFacts,
  TodayPlanSnapshot,
  TodayPlanTaskFact,
  TodayPlanTaskFacts,
} from './today-plan.snapshot';
import type { StudentStateSnapshot } from './student-state.snapshot';
import type { WrongQuestionSnapshot } from './wrong-question.snapshot';
import { PrismaService } from '../prisma/prisma.service';
import { StudentStateProjectionService } from './student-state-projection.service';
import { WrongQuestionProjectionService } from './wrong-question-projection.service';

// StudyPlan/StudyTask rows as selected in loadPlanFacts(). scheduledDate is a
// date string in the schema; test fixtures may pass Date instances, so every
// date comparison goes through dateKey().
interface TodayPlanStudyTaskRow {
  id: string;
  knowledgePointId: string;
  subject: string;
  chapter: string;
  title: string;
  status: string;
  scheduledDate: string;
  completed: boolean;
  completedAt: Date | null;
  startedAt: Date | null;
  postponeCount: number;
  nextAvailableAt: Date | null;
  priority: string;
  mode: string;
  questionCount: number;
  minutes: number;
}

interface TodayPlanStudyPlanRow {
  id: string;
  phase: string;
  status: string;
  createdAt: Date;
  checkpoint: string;
  tasks: TodayPlanStudyTaskRow[];
}

@Injectable()
export class TodayPlanProjectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly studentStateProjection: StudentStateProjectionService,
    private readonly wrongQuestionProjection: WrongQuestionProjectionService,
  ) {}

  async getSnapshot(userId: string, asOf: Date = new Date()): Promise<TodayPlanSnapshot> {
    if (!process.env.DATABASE_URL) {
      return buildTodayPlanSnapshot({
        userId,
        asOf,
        planFacts: emptyPlanFacts(),
        taskFacts: emptyTaskFacts(),
        reviewFacts: emptyReviewFacts(),
        activityFacts: emptyActivityFacts(),
        masteryFacts: emptyMasteryFacts(),
        scoreFacts: emptyScoreFacts(),
      });
    }
    const [studentState, wrongQuestionSnapshot, plan] = await Promise.all([
      this.studentStateProjection.getSnapshot(userId, asOf),
      this.wrongQuestionProjection.getSnapshot(userId, asOf),
      this.loadPlanFacts(userId),
    ]);
    const taskFacts = buildTaskFacts(studentState, plan?.tasks ?? [], asOf);
    const masteryFacts: TodayPlanMasteryFacts = {
      source: studentState.mastery.source,
      averageMastery: studentState.mastery.averageMastery,
      weakCount: studentState.mastery.weakCount,
      reviewCount: studentState.mastery.reviewCount,
      masteredCount: studentState.mastery.masteredCount,
      lastUpdatedAt: studentState.mastery.lastUpdatedAt,
      weakPoints: studentState.weakPoints,
    };
    const reviewFacts = studentState.reviewDue;
    void wrongQuestionSnapshot;
    return buildTodayPlanSnapshot({
      userId,
      asOf,
      planFacts: plan ? toPlanFacts(plan) : emptyPlanFacts(),
      taskFacts,
      reviewFacts,
      activityFacts: {
        streakDays: 0,
        isActiveToday: studentState.studyTasks.today.length > 0,
        latestActivityAt: studentState.wrongQuestionSummary.latestWrongAt,
      },
      masteryFacts,
      scoreFacts: emptyScoreFacts(),
    });
  }

  async loadPlanFacts(userId: string): Promise<TodayPlanStudyPlanRow | null> {
    const plan = await this.prisma.studyPlan.findFirst({
      where: { userId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        phase: true,
        status: true,
        createdAt: true,
        checkpoint: true,
        tasks: {
          select: {
            id: true,
            knowledgePointId: true,
            subject: true,
            chapter: true,
            title: true,
            status: true,
            scheduledDate: true,
            completed: true,
            completedAt: true,
            startedAt: true,
            postponeCount: true,
            nextAvailableAt: true,
            priority: true,
            mode: true,
            questionCount: true,
            minutes: true,
          },
        },
      },
    });
    return plan;
  }
}

function toPlanFacts(plan: TodayPlanStudyPlanRow): TodayPlanPlanFacts {
  const dates = plan.tasks
    .map((task) => dateKey(task.scheduledDate))
    .filter(Boolean)
    .sort();
  return {
    planId: plan.id,
    phase: plan.phase,
    status: plan.status,
    windowStart: dates[0] ?? '',
    windowEnd: dates.at(-1) ?? '',
    generatedAt: plan.createdAt.toISOString(),
    checkpointState: plan.checkpoint,
  };
}

function buildTaskFacts(
  studentState: StudentStateSnapshot,
  planTasks: TodayPlanStudyTaskRow[],
  asOf: Date,
): TodayPlanTaskFacts {
  const progressByTask = new Map(studentState.studyTasks.today.map((task) => [task.id, task]));
  const todayKey = dateKey(asOf);
  const tasks: TodayPlanTaskFact[] = planTasks.map((task) => {
    const stateTask = progressByTask.get(task.id);
    return {
      id: task.id,
      knowledgePointId: task.knowledgePointId,
      questionIds: null,
      title: task.title,
      subject: task.subject,
      chapter: task.chapter,
      minutes: task.minutes,
      questionCount: task.questionCount,
      mode: task.mode,
      priority: task.priority,
      scheduledDate: dateKey(task.scheduledDate),
      status: task.status,
      completed: task.completed,
      completedAt: task.completedAt?.toISOString() ?? null,
      startedAt: task.startedAt?.toISOString() ?? null,
      postponeCount: task.postponeCount,
      nextAvailableAt: task.nextAvailableAt?.toISOString() ?? null,
      progress: stateTask
        ? {
            completedQuestionCount: stateTask.completedQuestionCount,
            correctCount: stateTask.correctCount,
            minutesSpent: stateTask.minutesSpent,
            reachedTarget: stateTask.reachedTarget,
          }
        : null,
    };
  });
  return {
    todayTasks: tasks.filter((task) => task.scheduledDate === todayKey),
    counts: {
      pending: tasks.filter((task) => task.status === 'pending').length,
      inProgress: tasks.filter((task) => task.status === 'in_progress').length,
      postponed: tasks.filter((task) => task.status === 'postponed').length,
      completed: tasks.filter((task) => task.status === 'completed' || task.completed).length,
    },
    weekDays: [],
  };
}

function emptyPlanFacts(): TodayPlanPlanFacts {
  return { planId: null, phase: '', status: 'EMPTY', windowStart: '', windowEnd: '', generatedAt: null, checkpointState: null };
}

function emptyTaskFacts(): TodayPlanTaskFacts {
  return { todayTasks: [], counts: { pending: 0, inProgress: 0, postponed: 0, completed: 0 }, weekDays: [] };
}

function emptyReviewFacts(): TodayPlanReviewFacts {
  return { dueCount: 0, overdueCount: 0, nextReviewAt: null, items: [] };
}

function emptyActivityFacts(): TodayPlanActivityFacts {
  return { streakDays: 0, isActiveToday: false, latestActivityAt: null };
}

function emptyMasteryFacts(): TodayPlanMasteryFacts {
  return { source: 'empty', averageMastery: 0, weakCount: 0, reviewCount: 0, masteredCount: 0, lastUpdatedAt: null, weakPoints: [] };
}

function emptyScoreFacts(): TodayPlanScoreFacts {
  return { available: false, generatedAt: null, raw: null };
}

function dateKey(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString().slice(0, 10);
}
