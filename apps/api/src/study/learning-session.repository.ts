import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type SessionType = 'practice_set' | 'stage_assessment' | 'paper';

export interface PersistedLearningSession {
  id: string;
  userId: string;
  type: SessionType;
  resourceId?: string;
  questionIds: string[];
  answers: Record<string, { selectedAnswer: string; timeSpentSec: number }>;
  markedQuestions: string[];
  currentIndex: number;
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
    const data = {
      userId: session.userId,
      type: session.type,
      resourceId: session.resourceId,
      questionIds: session.questionIds,
      answers: session.answers as Prisma.InputJsonValue,
      markedQuestions: session.markedQuestions,
      currentIndex: session.currentIndex,
      startedAt: new Date(session.startedAt),
      lastActiveAt: new Date(session.lastActiveAt),
      totalActiveMs: session.totalActiveMs,
      lastResumeAt: new Date(session.lastResumeAt),
      completed: session.completed,
      submittedAt: session.completed ? new Date(session.lastActiveAt) : null,
    };
    await this.prisma.learningSession.upsert({
      where: { id: session.id },
      create: { id: session.id, ...data },
      update: data,
    });
  }

  async claimForSubmission(sessionId: string, userId: string): Promise<boolean> {
    if (!this.enabled) return true;
    const result = await this.prisma.learningSession.updateMany({
      where: { id: sessionId, userId, completed: false },
      data: { completed: true, submittedAt: new Date(), lastActiveAt: new Date() },
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

function toDomainSession(row: {
  id: string;
  userId: string;
  type: string;
  resourceId: string | null;
  questionIds: string[];
  answers: Prisma.JsonValue;
  markedQuestions: string[];
  currentIndex: number;
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
    answers: row.answers as PersistedLearningSession['answers'],
    markedQuestions: row.markedQuestions,
    currentIndex: row.currentIndex,
    startedAt: row.startedAt.toISOString(),
    lastActiveAt: row.lastActiveAt.toISOString(),
    totalActiveMs: row.totalActiveMs,
    lastResumeAt: row.lastResumeAt.getTime(),
    completed: row.completed,
  };
}
