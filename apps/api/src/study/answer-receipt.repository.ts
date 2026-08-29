import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type AnswerReceiptStatusValue = 'PENDING' | 'SUCCEEDED' | 'FAILED';

export interface AnswerReceiptState {
  id: string;
  userId: string;
  idempotencyKey: string;
  requestHash: string;
  hashVersion: string;
  status: AnswerReceiptStatusValue;
  responseSnapshot: Prisma.JsonValue | null;
  practiceRecordIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class AnswerReceiptRepository {
  constructor(private readonly prisma: PrismaService) {}

  get enabled() {
    return Boolean(process.env.DATABASE_URL);
  }

  async findByKey(userId: string, idempotencyKey: string): Promise<AnswerReceiptState | null> {
    if (!this.enabled) return null;
    return this.prisma.answerReceipt.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
    }) as Promise<AnswerReceiptState | null>;
  }

  async createPending(input: {
    userId: string;
    idempotencyKey: string;
    requestHash: string;
    hashVersion: string;
  }): Promise<AnswerReceiptState> {
    const row = await this.prisma.answerReceipt.create({
      data: {
        userId: input.userId,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        hashVersion: input.hashVersion,
        status: 'PENDING',
      },
    });
    return row as AnswerReceiptState;
  }

  async takeOverPending(input: {
    userId: string;
    idempotencyKey: string;
    requestHash: string;
    staleBefore: Date;
    updatedAt: Date;
  }): Promise<boolean> {
    if (!this.enabled) return false;
    const result = await this.prisma.answerReceipt.updateMany({
      where: {
        userId: input.userId,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        status: 'PENDING',
        updatedAt: { lte: input.staleBefore },
      },
      data: { updatedAt: input.updatedAt },
    });
    return result.count === 1;
  }

  async markSucceeded(
    tx: Prisma.TransactionClient,
    input: {
      id: string;
      responseSnapshot: Prisma.InputJsonValue;
      practiceRecordIds: string[];
    },
  ): Promise<AnswerReceiptState> {
    const row = await tx.answerReceipt.update({
      where: { id: input.id },
      data: {
        status: 'SUCCEEDED',
        responseSnapshot: input.responseSnapshot,
        practiceRecordIds: input.practiceRecordIds,
      },
    });
    return row as AnswerReceiptState;
  }

  async markFailed(input: {
    id: string;
    responseSnapshot: Prisma.InputJsonValue;
  }): Promise<AnswerReceiptState | null> {
    if (!this.enabled) return null;
    const row = await this.prisma.answerReceipt.update({
      where: { id: input.id },
      data: {
        status: 'FAILED',
        responseSnapshot: input.responseSnapshot,
      },
    });
    return row as AnswerReceiptState;
  }
}

export function isPrismaUniqueError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === 'P2002');
}
