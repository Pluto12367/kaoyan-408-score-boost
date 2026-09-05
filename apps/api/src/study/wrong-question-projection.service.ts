import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildWrongQuestionSnapshot,
  type WrongQuestionSnapshot,
} from './wrong-question.snapshot';

@Injectable()
export class WrongQuestionProjectionService {
  constructor(private readonly prisma: PrismaService) {}

  async getSnapshot(userId: string, asOf: Date | string = new Date()): Promise<WrongQuestionSnapshot> {
    if (!process.env.DATABASE_URL) {
      return buildWrongQuestionSnapshot({
        userId,
        asOf,
        practiceRecords: [],
        wrongQuestionReviews: [],
        reviewSchedules: [],
        reviewAttempts: [],
        questions: [],
        knowledgePoints: [],
      });
    }

    const [
      practiceRecords,
      wrongQuestionReviews,
      reviewSchedules,
      reviewAttempts,
      questions,
      knowledgePoints,
      knowledgePointNodeMaps,
    ] = await Promise.all([
      this.prisma.practiceRecord.findMany({
        where: { userId },
        select: {
          id: true,
          questionId: true,
          knowledgePointId: true,
          selectedAnswer: true,
          correct: true,
          timeSpentSec: true,
          mistakeReason: true,
          submittedAt: true,
          variantQuestionId: true,
        },
        orderBy: [
          { submittedAt: 'asc' },
          { id: 'asc' },
        ],
      }),
      this.prisma.wrongQuestionReview.findMany({
        where: { userId },
        select: {
          questionId: true,
          reviewedAt: true,
          resolved: true,
          resolvedAt: true,
        },
      }),
      this.prisma.reviewSchedule.findMany({
        where: { userId },
        select: {
          id: true,
          questionId: true,
          stability: true,
          consecutiveCorrect: true,
          nextReviewAt: true,
          reviewCount: true,
          lastReviewedAt: true,
          selfReportedReason: true,
          inferredReason: true,
          note: true,
          redoCorrect: true,
          timeSpentSec: true,
        },
        orderBy: [
          { nextReviewAt: 'asc' },
          { questionId: 'asc' },
        ],
      }),
      this.prisma.reviewAttempt.findMany({
        where: { schedule: { userId } },
        select: {
          redoCorrect: true,
          timeSpentSec: true,
          reportedReason: true,
          inferredReason: true,
          nextIntervalDays: true,
          reviewedAt: true,
          schedule: { select: { questionId: true } },
        },
        orderBy: [
          { scheduleId: 'asc' },
          { reviewedAt: 'asc' },
        ],
      }),
      this.prisma.question.findMany({
        select: {
          id: true,
          stem: true,
          answer: true,
          analysis: true,
          knowledgePoints: {
            select: { knowledgePointId: true },
            orderBy: { knowledgePointId: 'asc' },
          },
        },
      }),
      this.prisma.knowledgePoint.findMany({
        select: {
          id: true,
          title: true,
          subject: true,
          chapter: true,
          importance: true,
        },
      }),
      this.prisma.knowledgePointNodeMap?.findMany
        ? this.prisma.knowledgePointNodeMap.findMany({
          select: { knowledgePointId: true, knowledgeNodeId: true },
          orderBy: [{ knowledgePointId: 'asc' }, { knowledgeNodeId: 'asc' }],
        })
        : Promise.resolve([]),
    ]);

    return buildWrongQuestionSnapshot({
      userId,
      asOf,
      practiceRecords,
      wrongQuestionReviews,
      reviewSchedules,
      reviewAttempts: reviewAttempts.map((attempt) => ({
        questionId: attempt.schedule.questionId,
        redoCorrect: attempt.redoCorrect,
        timeSpentSec: attempt.timeSpentSec,
        reportedReason: attempt.reportedReason,
        inferredReason: attempt.inferredReason,
        nextIntervalDays: attempt.nextIntervalDays,
        reviewedAt: attempt.reviewedAt,
      })),
      questions: questions.map((question) => ({
        id: question.id,
        stem: question.stem,
        answer: question.answer,
        analysis: question.analysis,
        knowledgePointIds: question.knowledgePoints.map((point) => point.knowledgePointId),
      })),
      knowledgePoints,
      knowledgePointNodeMaps,
    });
  }
}
