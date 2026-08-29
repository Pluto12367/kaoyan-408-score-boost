import { Injectable, Optional } from '@nestjs/common';
import {
  buildAssessmentHistorySummary,
  deriveNodeMasteryStatus,
  type NodeMasteryRow,
  type Subject,
} from '@kaoyan408/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildStudentStateSnapshot,
  type StudentStateMasteryRow,
  type StudentStateSnapshot,
  type StudentStateTaskRow,
  type StudentStateWrongQuestionRow,
} from './student-state.snapshot';
import {
  MasterySummaryProjectionService,
  toStudentStateMasteryDto,
} from './mastery-summary-projection.service';

const SUBJECT_NAME_BY_CODE: Record<string, Subject | '未分类'> = {
  DS: '数据结构',
  DATA_STRUCTURE: '数据结构',
  CO: '计算机组成原理',
  COMPUTER_ORGANIZATION: '计算机组成原理',
  OS: '操作系统',
  OPERATING_SYSTEM: '操作系统',
  CN: '计算机网络',
  COMPUTER_NETWORK: '计算机网络',
};

@Injectable()
export class StudentStateProjectionService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly masterySummaryProjection?: MasterySummaryProjectionService,
  ) {}

  async getSnapshot(userId: string, asOf = new Date()): Promise<StudentStateSnapshot> {
    if (!process.env.DATABASE_URL) {
      return buildStudentStateSnapshot({
        userId,
        asOf,
        user: null,
        masteryRows: [],
        wrongQuestionRows: [],
        reviewSchedules: [],
        studyTasks: [],
        assessmentSummary: buildAssessmentHistorySummary([]),
      });
    }

    const [
      user,
      masteryRows,
      practiceRecords,
      wrongQuestionReviews,
      reviewSchedules,
      studyTasks,
      taskProgressRows,
      assessmentItems,
    ] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          targetSchool: true,
          targetScore: true,
          currentScore: true,
          dailyHours: true,
          remainingDays: true,
          studyStage: true,
          weakestSubject: true,
          diagnosis: true,
          examYear: true,
          onboardingCompletedAt: true,
        },
      }),
      this.prisma.userKnowledgeMastery.findMany({
        where: { userId },
        include: {
          knowledgeNode: {
            select: {
              subject: true,
              name: true,
              importance: true,
              parent: {
                select: {
                  name: true,
                  parent: { select: { name: true } },
                },
              },
              frequency: {
                orderBy: { snapshotDate: 'desc' },
                take: 1,
                select: { recent3Frequency: true },
              },
            },
          },
        },
        orderBy: { knowledgeNodeId: 'asc' },
      }),
      this.prisma.practiceRecord.findMany({
        where: { userId },
        select: {
          questionId: true,
          correct: true,
          submittedAt: true,
        },
        orderBy: { submittedAt: 'desc' },
      }),
      this.prisma.wrongQuestionReview.findMany({
        where: { userId },
        select: {
          questionId: true,
          reviewedAt: true,
          resolved: true,
        },
      }),
      this.prisma.reviewSchedule.findMany({
        where: { userId },
        select: {
          questionId: true,
          nextReviewAt: true,
          reviewCount: true,
          stability: true,
        },
        orderBy: { nextReviewAt: 'asc' },
      }),
      this.prisma.studyTask.findMany({
        where: {
          plan: {
            userId,
            status: 'ACTIVE',
          },
        },
        select: {
          id: true,
          title: true,
          status: true,
          scheduledDate: true,
          completed: true,
          completedAt: true,
          priority: true,
          mode: true,
          questionCount: true,
          minutes: true,
        },
        orderBy: [
          { scheduledDate: 'asc' },
          { id: 'asc' },
        ],
      }),
      this.prisma.studyTaskProgress.findMany({
        where: { userId },
        select: {
          taskId: true,
          completedQuestionCount: true,
          correctCount: true,
          minutesSpent: true,
        },
      }),
      this.prisma.assessmentHistoryItem.findMany({
        where: { userId },
        select: {
          score: true,
          accuracyRate: true,
        },
        orderBy: { submittedAt: 'desc' },
      }),
    ]);
    const masteryProjectionService = this.masterySummaryProjection ?? new MasterySummaryProjectionService(this.prisma);
    const masteryProjection = masteryProjectionService.getProjectionFromRows(
      userId,
      masteryRows.map(toNodeMasteryRow),
      asOf,
    );
    const masteryDto = toStudentStateMasteryDto(
      masteryProjection,
      latestUpdatedAt(masteryRows),
    );

    return buildStudentStateSnapshot({
      userId,
      asOf,
      user,
      masteryRows: [],
      wrongQuestionRows: toWrongQuestionRows(practiceRecords, wrongQuestionReviews),
      reviewSchedules,
      studyTasks: toTaskRows(studyTasks, taskProgressRows),
      assessmentSummary: buildAssessmentHistorySummary(assessmentItems),
      mastery: masteryDto.mastery,
      weakPoints: masteryDto.weakPoints,
    });
  }
}

function latestUpdatedAt(rows: Array<{ updatedAt: Date | string | null }>): string | null {
  return rows
    .map((row) => toIsoOrNull(row.updatedAt))
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
}

function toIsoOrNull(value: Date | string | null): string | null {
  return value == null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toNodeMasteryRow(row: {
  knowledgeNodeId: string;
  mastery: number;
  attempts: number;
  correctCount: number;
  wrongCount: number;
  knowledgeNode: {
    subject: string;
    name: string;
    importance: number;
    parent: { name: string; parent: { name: string } | null } | null;
    frequency?: Array<{ recent3Frequency: number }>;
  };
}): NodeMasteryRow {
  return {
    knowledgeNodeId: row.knowledgeNodeId,
    subject: SUBJECT_NAME_BY_CODE[row.knowledgeNode.subject] ?? '未分类',
    chapter: row.knowledgeNode.parent?.parent?.name ?? row.knowledgeNode.parent?.name ?? '',
    title: row.knowledgeNode.name,
    importance: row.knowledgeNode.importance,
    frequency: row.knowledgeNode.frequency?.[0]?.recent3Frequency ?? row.knowledgeNode.importance,
    mastery: row.mastery,
    attempts: row.attempts,
    correctCount: row.correctCount,
    wrongCount: row.wrongCount,
    status: deriveNodeMasteryStatus({ mastery: row.mastery, attempts: row.attempts }),
  };
}

function toMasteryRow(row: {
  knowledgeNodeId: string;
  mastery: number;
  attempts: number;
  correctCount: number;
  wrongCount: number;
  updatedAt: Date;
  knowledgeNode: {
    subject: string;
    name: string;
    importance: number;
    parent: { name: string } | null;
  };
}): StudentStateMasteryRow {
  return {
    knowledgeNodeId: row.knowledgeNodeId,
    subject: row.knowledgeNode.subject,
    chapter: row.knowledgeNode.parent?.name ?? row.knowledgeNode.name,
    title: row.knowledgeNode.name,
    importance: row.knowledgeNode.importance,
    frequency: 0,
    mastery: row.mastery,
    attempts: row.attempts,
    correctCount: row.correctCount,
    wrongCount: row.wrongCount,
    status: deriveNodeMasteryStatus({ mastery: row.mastery, attempts: row.attempts }),
    updatedAt: row.updatedAt,
  };
}

function toTaskRows(
  tasks: StudentStateTaskRow[],
  progressRows: Array<{
    taskId: string;
    completedQuestionCount: number;
    correctCount: number;
    minutesSpent: number;
  }>,
): StudentStateTaskRow[] {
  const progressByTask = new Map(progressRows.map((row) => [row.taskId, row]));
  return tasks.map((task) => {
    const progress = progressByTask.get(task.id);
    if (!progress) return task;
    return {
      ...task,
      completedQuestionCount: progress.completedQuestionCount,
      correctCount: progress.correctCount,
      minutesSpent: progress.minutesSpent,
      reachedTarget: progress.completedQuestionCount >= task.questionCount,
    };
  });
}

function toWrongQuestionRows(
  practiceRecords: Array<{ questionId: string; correct: boolean; submittedAt: Date }>,
  reviews: Array<{ questionId: string; reviewedAt: Date; resolved: boolean | null }>,
): StudentStateWrongQuestionRow[] {
  const reviewByQuestion = new Map(reviews.map((review) => [review.questionId, review]));
  const latestByQuestion = new Map<string, { questionId: string; correct: boolean; submittedAt: Date }>();
  for (const record of practiceRecords) {
    if (!latestByQuestion.has(record.questionId)) {
      latestByQuestion.set(record.questionId, record);
    }
  }
  return [...latestByQuestion.values()].map((record) => {
    const review = reviewByQuestion.get(record.questionId);
    return {
      questionId: record.questionId,
      latestCorrect: record.correct,
      latestSubmittedAt: record.submittedAt,
      reviewedAt: review?.reviewedAt ?? null,
      resolved: review?.resolved ?? null,
    };
  });
}
