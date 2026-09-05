import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type StoredUserEvent = {
  id: string;
  userId: string;
  type: string;
  eventKey: string | null;
  payload: Prisma.JsonValue | null;
  createdAt: Date;
};

@Injectable()
export class UserEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  get enabled() {
    return Boolean(process.env.DATABASE_URL);
  }

  async record(userId: string, type: string, payload?: Record<string, unknown>) {
    if (!this.enabled) return;
    await this.prisma.userEvent.create({
      data: {
        userId,
        type,
        payload: (payload ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  async recordTelemetry(userId: string, type: string, payload?: Record<string, unknown>) {
    return this.record(userId, type, payload);
  }

  async recordCanonical(
    userId: string,
    type: string,
    eventKey: string,
    payload?: Record<string, unknown>,
  ): Promise<StoredUserEvent | null> {
    if (!this.enabled) return null;
    try {
      const row = await this.prisma.userEvent.create({
        data: {
          userId,
          type,
          eventKey,
          payload: (payload ?? {}) as Prisma.InputJsonValue,
        },
      });
      return toStoredUserEvent(row);
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const existing = await this.prisma.userEvent.findUnique({
        where: { userId_eventKey: { userId, eventKey } },
      });
      if (!existing) throw error;
      return toStoredUserEvent(existing);
    }
  }

  async hasTriggerKey(userId: string, triggerKey: string) {
    if (!this.enabled) return false;
    const events = await this.prisma.userEvent.findMany({
      where: { userId, type: 'plan.generated' },
      select: { payload: true },
    });
    return events.some((event) => (
      event.payload !== null
      && typeof event.payload === 'object'
      && !Array.isArray(event.payload)
      && (event.payload as { triggerKey?: unknown }).triggerKey === triggerKey
    ));
  }
}

function isUniqueConstraintError(error: unknown): error is { code: 'P2002' } {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'P2002');
}

function toStoredUserEvent(row: {
  id: string;
  userId: string;
  type: string;
  eventKey: string | null;
  payload: Prisma.JsonValue | null;
  createdAt: Date;
}): StoredUserEvent {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    eventKey: row.eventKey,
    payload: row.payload,
    createdAt: row.createdAt,
  };
}
