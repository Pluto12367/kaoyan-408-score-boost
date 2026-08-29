import { Injectable } from '@nestjs/common';
import type { DashboardPracticeFacts, DashboardPracticeFact } from './dashboard.snapshot';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PracticeProjectionService {
  constructor(private readonly prisma: PrismaService) {}

  async getFacts(userId: string, asOf: Date = new Date()): Promise<DashboardPracticeFacts> {
    const asOfIso = asOf.toISOString();
    if (!process.env.DATABASE_URL) return emptyFacts();

    const dayStart = new Date(asOf);
    dayStart.setUTCHours(0, 0, 0, 0);
    const [records, sessions] = await Promise.all([
      this.prisma.practiceRecord.findMany({
        where: { userId, submittedAt: { lte: asOf } },
        orderBy: { submittedAt: 'asc' },
        select: { id: true, userId: true, questionId: true, knowledgePointId: true, correct: true, timeSpentSec: true, mistakeReason: true, submittedAt: true, variantQuestionId: true },
      }),
      this.prisma.learningSession.findMany({
        where: { userId, startedAt: { lte: asOf } },
        select: { startedAt: true, lastActiveAt: true, totalActiveMs: true },
      }),
    ]);
    const facts = records.map(toPracticeFact);
    const todayCount = records.filter((record) => record.submittedAt >= dayStart).length;
    const correctCount = records.filter((record) => record.correct).length;
    return {
      source: facts.length ? 'practice_record' : 'empty',
      totalCount: facts.length,
      todayCount,
      correctCount,
      accuracy: facts.length ? correctCount / facts.length : 0,
      lastPracticeAt: facts.at(-1)?.submittedAt ?? null,
      studyDuration: sessions.reduce((sum, session) => sum + session.totalActiveMs, 0),
      latestSubmittedAt: facts.at(-1)?.submittedAt ?? null,
      records: facts,
    };
  }
}

function toPracticeFact(record: {
  id: string;
  userId: string;
  questionId: string;
  knowledgePointId: string;
  correct: boolean;
  timeSpentSec: number;
  mistakeReason: string | null;
  submittedAt: Date;
  variantQuestionId: string | null;
}): DashboardPracticeFact {
  return {
    id: record.id,
    userId: record.userId,
    questionId: record.questionId,
    knowledgePointId: record.knowledgePointId,
    correct: record.correct,
    timeSpentSec: record.timeSpentSec,
    mistakeReason: record.mistakeReason,
    submittedAt: record.submittedAt.toISOString(),
    variantQuestionId: record.variantQuestionId,
  };
}

function emptyFacts(): DashboardPracticeFacts {
  return { source: 'empty', totalCount: 0, todayCount: 0, correctCount: 0, accuracy: 0, lastPracticeAt: null, studyDuration: 0, latestSubmittedAt: null, records: [] };
}
