import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type StudyPlanGenerationDraft = {
  userId: string;
  generationKey: string;
  phase: string;
  targetScore: number;
  remainingDays: number;
  dailyHours: number;
  checkpoint: string;
  source?: string | null;
  modelVersion?: string | null;
  targetExamDate?: Date | null;
  availableMinutes?: number | null;
  stale?: boolean;
  status?: string;
  tasks?: Prisma.StudyTaskCreateWithoutPlanInput[];
};

type StudyPlanWithTasks = Prisma.StudyPlanGetPayload<{
  include: { tasks: { orderBy: { generatedRank: 'asc' } } };
}>;

type StudyPlanDb = PrismaService | Prisma.TransactionClient;

function isUniqueConflict(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002');
}

@Injectable()
export class StudyPlanRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the plan already materialized for a user generation identity.
   * The compound unique key is intentionally queried only with a non-empty
   * generation key; legacy plans remain readable through their existing paths.
   */
  async findByGenerationKey(
    userId: string,
    generationKey: string,
    db: StudyPlanDb = this.prisma,
  ): Promise<StudyPlanWithTasks | null> {
    this.requireValue('userId', userId);
    this.requireValue('generationKey', generationKey);
    return this.studyPlanDelegate(db).findUnique({
      where: { userId_generationKey: { userId, generationKey } },
      include: { tasks: { orderBy: { generatedRank: 'asc' } } },
    });
  }

  /**
   * Creates one plan for a generation identity, or returns the winner of a
   * concurrent create. Without a caller transaction, the create runs in its
   * own transaction so a PostgreSQL unique violation cannot poison the
   * transaction used for the recovery read. Callers that already own a
   * transaction can pass it through to keep plan creation atomic with their
   * surrounding work.
   */
  async createOrGetByGenerationKey(
    input: StudyPlanGenerationDraft,
    tx?: Prisma.TransactionClient,
  ): Promise<StudyPlanWithTasks> {
    this.requireValue('userId', input.userId);
    this.requireValue('generationKey', input.generationKey);

    const existing = await this.findByGenerationKey(input.userId, input.generationKey, tx ?? this.prisma);
    if (existing) return existing;

    // When a caller already owns a transaction, keep plan creation in that
    // transaction. A concurrent unique conflict is intentionally propagated
    // so the caller can roll back and recover the winner on a fresh read.
    if (tx) return this.create(tx, input);

    try {
      return await this.prisma.$transaction((tx) => this.create(tx, input));
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;

      // The failed transaction is not reused: PostgreSQL marks it aborted
      // after the unique violation. Read the winner through a fresh client
      // transaction instead.
      const winner = await this.findByGenerationKey(input.userId, input.generationKey);
      if (winner) return winner;
      throw error;
    }
  }

  private async create(
    db: StudyPlanDb,
    input: StudyPlanGenerationDraft,
  ): Promise<StudyPlanWithTasks> {
    const { tasks, ...plan } = input;
    return this.studyPlanDelegate(db).create({
      data: {
        ...plan,
        ...(tasks ? { tasks: { create: tasks } } : {}),
      },
      include: { tasks: { orderBy: { generatedRank: 'asc' } } },
    });
  }

  private studyPlanDelegate(db: StudyPlanDb) {
    return (db as StudyPlanDb & { studyPlan: any }).studyPlan;
  }

  private requireValue(name: string, value: string): void {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`${name} must be a non-empty string`);
    }
  }
}
