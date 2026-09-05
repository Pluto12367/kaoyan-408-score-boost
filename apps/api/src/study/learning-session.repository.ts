import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PracticeRecord, Question } from '@kaoyan408/shared';
import { PrismaService } from '../prisma/prisma.service';
import { toPrismaRecord } from './practice-record.repository';

export type SessionType = 'practice_set' | 'stage_assessment' | 'paper';

export interface PersistedLearningSession {
  id: string;
  userId: string;
  actionId?: string;
  type: SessionType;
  resourceId?: string;
  questionIds: string[];
  questionSnapshot: Question[];
  answers: Record<string, { selectedAnswer: string; timeSpentSec: number; selfScore?: number; maxScore?: number; confidence?: '确定' | '不确定' | '完全不会'; usedHint?: boolean; answerModified?: boolean }>;
  markedQuestions: string[];
  currentIndex: number;
  revision: number;
  startedAt: string;
  lastActiveAt: string;
  totalActiveMs: number;
  lastResumeAt: number;
  completed: boolean;
}

@Injectable()
export class LearningSessionRepository {
  constructor(private readonly prisma: PrismaService) {}

  get enabled() {
    return Boolean(process.env.DATABASE_URL);
  }

  async loadAll(): Promise<PersistedLearningSession[]> {
    if (!this.enabled) return [];
    const rows = await this.prisma.learningSession.findMany({
      orderBy: { lastActiveAt: 'asc' },
    });
    return rows.map(toDomainSession);
  }

  async save(session: PersistedLearningSession): Promise<void> {
    if (!this.enabled) return;
    const data = toPersistenceData(session);
    await this.prisma.learningSession.upsert({
      where: { id: session.id },
      create: { id: session.id, ...data },
      update: data,
    });
  }

  async saveProgress(session: PersistedLearningSession): Promise<boolean> {
    if (!this.enabled) return true;
    const result = await this.prisma.learningSession.updateMany({
      where: {
        id: session.id,
        userId: session.userId,
        completed: false,
        revision: { lt: session.revision },
      },
      data: toPersistenceData(session),
    });
    return result.count === 1;
  }

  async loadOne(sessionId: string, userId: string): Promise<PersistedLearningSession | null> {
    if (!this.enabled) return null;
    const row = await this.prisma.learningSession.findFirst({ where: { id: sessionId, userId } });
    return row ? toDomainSession(row) : null;
  }

  async findByActionId(actionId: string, userId: string): Promise<PersistedLearningSession | null> {
    if (!this.enabled) return null;
    const learningSession = (this.prisma as PrismaService & { learningSession: any }).learningSession;
    const row = await learningSession.findFirst({ where: { actionId, userId } });
    return row ? toDomainSession(row) : null;
  }

  async createFromAction(session: PersistedLearningSession): Promise<PersistedLearningSession> {
    if (!this.enabled) { await this.save(session); return session; }
    return this.prisma.$transaction(async (tx) => {
      const learningSession = (tx as Prisma.TransactionClient & { learningSession: any }).learningSession;
      const existing = await learningSession.findUnique({ where: { actionId: session.actionId } });
      if (existing) return toDomainSession(existing);
      const row = await learningSession.create({ data: { id: session.id, ...toPersistenceData(session) } });
      return toDomainSession(row);
    });
  }

  async commitSubmission(
    session: PersistedLearningSession,
    records: PracticeRecord[],
    onCommitted?: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<boolean> {
    if (!this.enabled) return true;
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.learningSession.updateMany({
        where: { id: session.id, userId: session.userId, completed: false },
        data: toPersistenceData(session),
      });
      if (result.count !== 1) return false;
      if (records.length > 0) {
        await tx.practiceRecord.createMany({
          data: records.map(toPrismaRecord),
        });
      }
      if (onCommitted) {
        await onCommitted(tx);
      }
      return true;
    });
  }
}

function toPersistenceData(session: PersistedLearningSession) {
  return {
    userId: session.userId,
    actionId: session.actionId ?? null,
    type: session.type,
    resourceId: session.resourceId,
    questionIds: session.questionIds,
    questionSnapshot: session.questionSnapshot as unknown as Prisma.InputJsonValue,
    answers: session.answers as Prisma.InputJsonValue,
    markedQuestions: session.markedQuestions,
    currentIndex: session.currentIndex,
    revision: session.revision,
    startedAt: new Date(session.startedAt),
    lastActiveAt: new Date(session.lastActiveAt),
    totalActiveMs: session.totalActiveMs,
    lastResumeAt: new Date(session.lastResumeAt),
    completed: session.completed,
    submittedAt: session.completed ? new Date(session.lastActiveAt) : null,
  };
}

function toDomainSession(row: {
  id: string;
  userId: string;
  actionId?: string | null;
  type: string;
  resourceId: string | null;
  questionIds: string[];
  questionSnapshot: Prisma.JsonValue;
  answers: Prisma.JsonValue;
  markedQuestions: string[];
  currentIndex: number;
  revision: number;
  startedAt: Date;
  lastActiveAt: Date;
  totalActiveMs: number;
  lastResumeAt: Date;
  completed: boolean;
}): PersistedLearningSession {
  return {
    id: row.id,
    userId: row.userId,
    actionId: row.actionId ?? undefined,
    type: row.type as SessionType,
    resourceId: row.resourceId ?? undefined,
    questionIds: row.questionIds,
    questionSnapshot: Array.isArray(row.questionSnapshot) ? row.questionSnapshot as unknown as Question[] : [],
    answers: row.answers as PersistedLearningSession['answers'],
    markedQuestions: row.markedQuestions,
    currentIndex: row.currentIndex,
    revision: row.revision,
    startedAt: row.startedAt.toISOString(),
    lastActiveAt: row.lastActiveAt.toISOString(),
    totalActiveMs: row.totalActiveMs,
    lastResumeAt: row.lastResumeAt.getTime(),
    completed: row.completed,
  };
}
