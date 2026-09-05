import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  feedbackDedupeKey,
  USER_ACTION_FEEDBACK_EVENT,
  type StudentStateFeedbackEvent,
} from './student-state-feedback.adapter';

export type StoredStudentStateFeedback = {
  id: string;
  userId: string;
  type: typeof USER_ACTION_FEEDBACK_EVENT;
  payload: StudentStateFeedbackEvent;
  createdAt: Date;
};

type PersistenceResult = {
  created: boolean;
  record: StoredStudentStateFeedback;
};

@Injectable()
export class StudentStateFeedbackRepository {
  private readonly inFlight = new Map<string, Promise<PersistenceResult | null>>();

  constructor(private readonly prisma: PrismaService) {}

  get enabled() {
    return Boolean(process.env.DATABASE_URL);
  }

  async createIfAbsent(event: StudentStateFeedbackEvent): Promise<PersistenceResult | null> {
    if (!this.enabled) return null;
    const key = feedbackDedupeKey(event);
    const pending = this.inFlight.get(key);
    if (pending) {
      const result = await pending;
      return result ? { created: false, record: result.record } : null;
    }
    const work = this.persistIfAbsent(event, key).finally(() => {
      if (this.inFlight.get(key) === work) this.inFlight.delete(key);
    });
    this.inFlight.set(key, work);
    return work;
  }

  private async persistIfAbsent(event: StudentStateFeedbackEvent, key: string): Promise<PersistenceResult> {
    try {
      const row = await this.prisma.userEvent.create({
        data: {
          userId: event.userId,
          type: USER_ACTION_FEEDBACK_EVENT,
          eventKey: key,
          payload: event as unknown as Prisma.InputJsonValue,
        },
      });
      return { created: true, record: toStoredRecord(row) };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const existing = await this.findByEventKey(event.userId, key);
      if (!existing) throw error;
      return { created: false, record: existing };
    }
  }

  private async findByEventKey(userId: string, eventKey: string): Promise<StoredStudentStateFeedback | null> {
    const row = await this.prisma.userEvent.findUnique({
      where: { userId_eventKey: { userId, eventKey } },
    });
    return row ? toStoredRecord(row) : null;
  }
}

function isUniqueConstraintError(error: unknown): error is { code: 'P2002' } {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'P2002');
}

function parsePayload(value: unknown): StudentStateFeedbackEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const payload = value as Partial<StudentStateFeedbackEvent>;
  if (typeof payload.userId !== 'string' || typeof payload.actionId !== 'string' || typeof payload.signalType !== 'string') return null;
  return payload as StudentStateFeedbackEvent;
}

function toStoredRecord(row: { id: string; userId: string; type: string; payload: unknown; createdAt: Date }, payload?: StudentStateFeedbackEvent): StoredStudentStateFeedback {
  const parsed = payload ?? parsePayload(row.payload);
  if (!parsed) throw new Error('Invalid USER_ACTION_FEEDBACK payload');
  return {
    id: row.id,
    userId: row.userId,
    type: USER_ACTION_FEEDBACK_EVENT,
    payload: parsed,
    createdAt: row.createdAt,
  };
}
