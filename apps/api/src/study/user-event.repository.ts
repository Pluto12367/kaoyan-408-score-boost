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

  /**
   * V12-M3-A — writes the canonical row, optionally inside a caller's
   * transaction, and is idempotent on `eventKey`.
   *
   * Two conflict strategies, because PostgreSQL poisons a transaction when a
   * statement fails:
   *   • outside a transaction — catch P2002 and re-read (the original
   *     behaviour, unchanged);
   *   • inside a transaction — pre-read instead, and let a genuine race abort
   *     the transaction. Aborting is the safe outcome: the caller's whole unit
   *     of work (attempt + receipt + mastery) rolls back together, so nothing
   *     is ever applied twice. Catching P2002 here would continue on a poisoned
   *     connection and turn a clean rollback into a confusing failure.
   */
  async recordCanonical(
    userId: string,
    type: string,
    eventKey: string,
    payload?: Record<string, unknown>,
    tx?: Prisma.TransactionClient,
  ): Promise<StoredUserEvent | null> {
    if (!this.enabled) return null;
    const data = {
      userId,
      type,
      eventKey,
      payload: (payload ?? {}) as Prisma.InputJsonValue,
    };
    if (tx) {
      const existing = await tx.userEvent.findUnique({
        where: { userId_eventKey: { userId, eventKey } },
      });
      if (existing) return toStoredUserEvent(existing);
      const row = await tx.userEvent.create({ data });
      return toStoredUserEvent(row);
    }
    try {
      const row = await this.prisma.userEvent.create({ data });
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

  /**
   * V12-M3-A — existence check for a canonical event, optionally inside a
   * caller's transaction.
   *
   * This is the read half of an exactly-once claim: the writer pre-reads, then
   * creates, so a duplicate application is prevented by construction rather
   * than by hoping the caller checks first.
   */
  async findCanonical(
    userId: string,
    eventKey: string,
    tx?: Prisma.TransactionClient,
  ): Promise<StoredUserEvent | null> {
    if (!this.enabled) return null;
    const db = tx ?? this.prisma;
    const row = await db.userEvent.findUnique({
      where: { userId_eventKey: { userId, eventKey } },
    });
    return row ? toStoredUserEvent(row) : null;
  }

  /** Read canonical events of one type for a user, newest first. */
  async listByType(userId: string, type: string, limit = 50): Promise<StoredUserEvent[]> {
    if (!this.enabled) return [];
    const rows = await this.prisma.userEvent.findMany({
      where: { userId, type },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(toStoredUserEvent);
  }

  async hasTriggerKey(userId: string, triggerKey: string) {    if (!this.enabled) return false;
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
