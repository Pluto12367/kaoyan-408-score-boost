import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Question } from '@kaoyan408/shared';
import { PrismaService } from '../prisma/prisma.service';

export type SessionType = 'practice_set' | 'stage_assessment' | 'paper';

export interface PersistedLearningSession {
  id: string;
  userId: string;
  type: SessionType;
  resourceId?: string;
  questionIds: string[];
  questionSnapshot: Question[];
  answers: Record<string, { selectedAnswer: string; timeSpentSec: number; selfScore?: number; maxScore?: number }>;
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

  async claimForSubmission(session: PersistedLearningSession): Promise<boolean> {
    if (!this.enabled) return true;
    const result = await this.prisma.learningSession.updateMany({
      where: { id: session.id, userId: session.userId, completed: false },
      data: {
        ...toPersistenceData(session),
        completed: true,
        submittedAt: new Date(),
      },
    });
    return result.count === 1;
  }

  async releaseSubmission(sessionId: string, userId: string): Promise<void> {
    if (!this.enabled) return;
    await this.prisma.learningSession.updateMany({
      where: { id: sessionId, userId },
      data: { completed: false, submittedAt: null },
    });
  }
}

function toPersistenceData(session: PersistedLearningSession) {
  return {
    userId: session.userId,
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
