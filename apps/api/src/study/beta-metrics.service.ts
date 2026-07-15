import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface RateMetric {
  rate: number | null;
  numerator: number;
  denominator: number;
  window: string;
}

@Injectable()
export class BetaMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  get enabled() {
    return Boolean(process.env.DATABASE_URL);
  }

  async calculate(pendingReviewCount: number) {
    const now = new Date();
    const todayStart = utcDayStart(now);
    const sevenDaysAgo = new Date(todayStart.getTime() - 6 * DAY_MS);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);

    const [students, diagnosticCompletedCount, firstTaskUsers, questionCount, knowledgePointCount,
      practiceSummary, correctPracticeCount, todayPracticeCount, completedTaskCount,
      todayCompletedTaskCount, weeklyTasks, reviewSchedules, reviewAttempts, examSessions,
      operationLogs, wrongRecords] = await Promise.all([
      this.prisma.user.findMany({
        where: { role: UserRole.STUDENT },
        select: {
          id: true,
          createdAt: true,
          operationLogs: {
            where: { createdAt: { gte: new Date(now.getTime() - 40 * DAY_MS) } },
            select: { createdAt: true },
          },
        },
      }),
      this.prisma.user.count({ where: { role: UserRole.STUDENT, onboardingCompletedAt: { not: null } } }),
      this.prisma.studyPlan.findMany({
        where: { user: { role: UserRole.STUDENT }, tasks: { some: { completed: true } } },
        select: { userId: true },
        distinct: ['userId'],
      }),
      this.prisma.question.count(),
      this.prisma.knowledgePoint.count(),
      this.prisma.practiceRecord.aggregate({ _count: true, _avg: { timeSpentSec: true } }),
      this.prisma.practiceRecord.count({ where: { correct: true } }),
      this.prisma.practiceRecord.count({ where: { submittedAt: { gte: todayStart } } }),
      this.prisma.studyTask.count({ where: { completed: true } }),
      this.prisma.studyTask.count({ where: { completedAt: { gte: todayStart } } }),
      this.prisma.studyTask.findMany({
        where: { scheduledDate: { gte: dayKey(sevenDaysAgo), lte: dayKey(now) } },
        select: { completed: true },
      }),
      this.prisma.reviewSchedule.findMany({ select: { id: true, stability: true } }),
      this.prisma.reviewAttempt.findMany({
        orderBy: [{ scheduleId: 'asc' }, { reviewedAt: 'asc' }],
        select: { scheduleId: true, redoCorrect: true },
      }),
      this.prisma.learningSession.findMany({ where: { type: 'paper' }, select: { completed: true } }),
      this.prisma.operationLog.findMany({
        where: { createdAt: { gte: thirtyDaysAgo } },
        select: { userId: true, method: true, path: true, statusCode: true, createdAt: true },
      }),
      this.prisma.practiceRecord.findMany({
        where: { correct: false },
        select: { knowledgePoint: { select: { title: true } } },
      }),
    ]);

    const studentCount = students.length;
    const lastSevenDayLogs = operationLogs.filter((log) => log.createdAt >= sevenDaysAgo);
    const activeStudentIds = new Set(lastSevenDayLogs.map((log) => log.userId).filter((id): id is string => Boolean(id)));
    const activeLearningDays = new Set(lastSevenDayLogs.filter((log) => log.userId).map((log) => dayKey(log.createdAt)));
    const registrationLogs = operationLogs.filter((log) => log.method === 'POST' && log.path === '/auth/register');
    const recoveryLogs = operationLogs.filter((log) => log.method === 'GET' && /^\/sessions\/practice\/[^/]+$/.test(log.path));
    const firstReviewAttempts = new Map<string, boolean>();
    for (const attempt of reviewAttempts) {
      if (!firstReviewAttempts.has(attempt.scheduleId)) firstReviewAttempts.set(attempt.scheduleId, attempt.redoCorrect);
    }

    const day1 = retention(students, 1, now);
    const day7 = retention(students, 7, now);
    const wrongPointTitles = wrongRecords.map((record) => record.knowledgePoint.title);
    const practiceRecordCount = practiceSummary._count;

    return {
      source: 'postgresql' as const,
      activeStudentCount: activeStudentIds.size,
      questionCount,
      knowledgePointCount,
      practiceRecordCount,
      todayPracticeCount,
      todayCompletedTaskCount,
      completedTaskCount,
      accuracyRate: percentage(correctPracticeCount, practiceRecordCount).rate ?? 0,
      weakPointCount: new Set(wrongPointTitles).size,
      pendingWrongQuestionCount: reviewSchedules.filter((schedule) => schedule.stability !== 'mastered').length,
      pendingReviewCount,
      averagePracticeTimeSec: Math.round(practiceSummary._avg.timeSpentSec ?? 0),
      retentionDays: activeLearningDays.size,
      topWeakPoint: mostFrequent(wrongPointTitles),
      core: {
        registrationCompletionRate: percentage(registrationLogs.filter(isSuccessful).length, registrationLogs.length, '最近 30 天'),
        diagnosticCompletionRate: percentage(diagnosticCompletedCount, studentCount, '全部内测学生'),
        firstTaskCompletionRate: percentage(firstTaskUsers.length, studentCount, '全部内测学生'),
        day1RetentionRate: percentage(day1.retained, day1.eligible, '已满 1 天注册用户'),
        day7RetentionRate: percentage(day7.retained, day7.eligible, '已满 7 天注册用户'),
        weeklyPlanCompletionRate: percentage(weeklyTasks.filter((task) => task.completed).length, weeklyTasks.length, '最近 7 个自然日'),
        wrongQuestionSecondAccuracyRate: percentage([...firstReviewAttempts.values()].filter(Boolean).length, firstReviewAttempts.size, '首次到期重做'),
        mockExamCompletionRate: percentage(examSessions.filter((session) => session.completed).length, examSessions.length, '全部模拟考试会话'),
        apiFailureRate: percentage(lastSevenDayLogs.filter((log) => log.statusCode >= 500).length, lastSevenDayLogs.length, '最近 7 天'),
        sessionRecoverySuccessRate: percentage(recoveryLogs.filter(isSuccessful).length, recoveryLogs.length, '最近 30 天'),
      },
      generatedAt: now.toISOString(),
    };
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

function percentage(numerator: number, denominator: number, window = ''): RateMetric {
  return { rate: denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null, numerator, denominator, window };
}

function isSuccessful(log: { statusCode: number }) {
  return log.statusCode >= 200 && log.statusCode < 300;
}

function utcDayStart(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dayKey(date: Date) {
  return utcDayStart(date).toISOString().slice(0, 10);
}

function retention(users: Array<{ createdAt: Date; operationLogs: Array<{ createdAt: Date }> }>, offsetDays: number, now: Date) {
  const today = utcDayStart(now).getTime();
  let eligible = 0;
  let retained = 0;
  for (const user of users) {
    const targetDay = utcDayStart(user.createdAt).getTime() + offsetDays * DAY_MS;
    if (targetDay >= today) continue;
    eligible += 1;
    if (user.operationLogs.some((log) => utcDayStart(log.createdAt).getTime() === targetDay)) retained += 1;
  }
  return { eligible, retained };
}

function mostFrequent(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
}
