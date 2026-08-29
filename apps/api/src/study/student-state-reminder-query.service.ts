import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type {
  StudentReviewDueItemSnapshot,
  StudentStateSnapshot,
  StudentTaskSnapshot,
} from './student-state.snapshot';
import { StudentStateProjectionService } from './student-state-projection.service';
import { ActivityProjectionService } from './activity-projection.service';
import { lastNDatesEndingAt } from './study-date';
import {
  buildStudyRemindersDto,
  type BuildStudyRemindersInput,
  type StudentReminderActivitySnapshot,
  type StudentReminderTrialSnapshot,
  type StudentReminderWrongQuestionSnapshot,
  type StudyRemindersDto,
} from './student-state-reminder.adapter';

@Injectable()
export class StudentStateReminderQueryService {
  constructor(
    private readonly studentStateProjection: StudentStateProjectionService,
    private readonly prisma: PrismaService,
    private readonly activityProjection: ActivityProjectionService = new ActivityProjectionService(),
  ) {}

  async getStudyRemindersCompat(
    userId: string,
    generatedAt: Date | string = new Date(),
  ): Promise<StudyRemindersDto> {
    const asOf = toDate(generatedAt);
    const snapshot = await this.studentStateProjection.getSnapshot(userId, asOf);
    const [activity, trial] = await Promise.all([
      this.getActivity(userId, asOf),
      this.getTrial(snapshot, userId),
    ]);

    return buildStudyRemindersDto({
      userId,
      generatedAt: asOf,
      weakPoints: snapshot.weakPoints,
      wrongQuestion: toReminderWrongQuestion(snapshot),
      todayTasks: snapshot.studyTasks.today.map(toReminderTask),
      activity,
      trial,
    });
  }

  private async getActivity(
    userId: string,
    asOf: Date,
  ): Promise<StudentReminderActivitySnapshot> {
    if (!process.env.DATABASE_URL) {
      return { streakDays: 0, todayPracticeCount: 0 };
    }

    const windowStart = new Date(asOf);
    windowStart.setUTCDate(windowStart.getUTCDate() - 6);
    windowStart.setUTCHours(0, 0, 0, 0);
    const rows = await this.prisma.practiceRecord.findMany({
      where: {
        userId,
        submittedAt: {
          gte: windowStart,
          lte: asOf,
        },
      },
      select: { submittedAt: true },
      orderBy: { submittedAt: 'desc' },
    });
    const activity = this.activityProjection.buildSnapshot({
      dates: lastNDatesEndingAt(asOf, 7),
      practiceRecords: rows,
      taskCompletions: [],
    });

    return {
      streakDays: activity.streakDays,
      todayPracticeCount: activity.todayPracticeCount,
    };
  }

  private async getTrial(
    snapshot: StudentStateSnapshot,
    userId: string,
  ): Promise<StudentReminderTrialSnapshot> {
    if (!process.env.DATABASE_URL) {
      return { completedCount: 0, totalCount: 5 };
    }

    const [
      completedTaskCount,
      completedPracticeSetCount,
      wrongReviewCount,
      feedbackCount,
    ] = await Promise.all([
      this.prisma.studyTaskCompletion.count({ where: { userId } }),
      this.prisma.learningSession.count({
        where: {
          userId,
          type: 'practice_set',
          completed: true,
        },
      }),
      this.prisma.wrongQuestionReview.count({ where: { userId } }),
      this.prisma.feedbackSubmission.count({ where: { userId } }),
    ]);

    const completed = [
      Boolean(snapshot.goal.diagnosis || snapshot.goal.onboardingCompletedAt),
      completedTaskCount > 0 || snapshot.studyTasks.counts.completed > 0,
      completedPracticeSetCount > 0,
      wrongReviewCount > 0 || snapshot.wrongQuestionSummary.reviewed > 0,
      feedbackCount > 0,
    ];

    return {
      completedCount: completed.filter(Boolean).length,
      totalCount: completed.length,
    };
  }
}

function toReminderWrongQuestion(
  snapshot: StudentStateSnapshot,
): StudentReminderWrongQuestionSnapshot | null {
  const due = snapshot.reviewDue.items[0];
  if (due) {
    return {
      questionId: due.questionId,
      knowledgePointTitle: '到期复盘题目',
      wrongCount: Math.max(1, due.reviewCount),
      reviewStatus: 'pending',
    };
  }
  if (snapshot.wrongQuestionSummary.total <= 0) return null;
  return {
    questionId: 'wrong-question-summary',
    knowledgePointTitle: '错题本',
    wrongCount: snapshot.wrongQuestionSummary.total,
    reviewStatus: snapshot.wrongQuestionSummary.unresolved > 0 ? 'pending' : 'reviewed',
  };
}

function toReminderTask(task: StudentTaskSnapshot): BuildStudyRemindersInput['todayTasks'][number] {
  const taskWithReason = task as StudentTaskSnapshot & { reason?: string | null };
  return {
    id: task.id,
    title: task.title,
    completed: task.completed,
    reason: taskWithReason.reason,
  };
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
