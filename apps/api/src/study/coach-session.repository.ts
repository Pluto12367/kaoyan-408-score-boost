/**
 * Coach Session Repository (Phase PX-1).
 *
 * Persists CoachConversationSession in the existing RuntimeState key/value
 * table (key = coach-session:{userId}) — Design Gate decision: no schema
 * change, no new fact source. When the database is unavailable the
 * repository is disabled and the coach degrades to stateless single turns
 * (explicit, no silent mock).
 */

import { Injectable, Optional } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CoachConversationSession } from './coach-session';

const SESSION_KEY_PREFIX = 'coach-session:';

@Injectable()
export class CoachSessionRepository {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  get enabled() {
    return Boolean(process.env.DATABASE_URL && this.prisma);
  }

  async load(userId: string): Promise<CoachConversationSession | null> {
    if (!this.enabled) return null;
    const row = await this.prisma!.runtimeState.findUnique({ where: { key: sessionKey(userId) } });
    if (!row || typeof row.value !== 'object' || row.value === null) return null;
    const value = row.value as Partial<CoachConversationSession>;
    if (typeof value.sessionId !== 'string' || value.userId !== userId) return null;
    return {
      sessionId: value.sessionId,
      userId,
      createdAt: String(value.createdAt ?? ''),
      lastActiveAt: String(value.lastActiveAt ?? ''),
      summary: String(value.summary ?? ''),
      goals: Array.isArray(value.goals) ? value.goals.map(String) : [],
      unresolvedIssues: Array.isArray(value.unresolvedIssues) ? value.unresolvedIssues.map(String) : [],
      recentMessages: Array.isArray(value.recentMessages)
        ? value.recentMessages.filter((message) => message && typeof message.content === 'string').map((message) => ({
            role: message.role === 'coach' ? ('coach' as const) : ('student' as const),
            content: String(message.content),
            at: String(message.at ?? ''),
          }))
        : [],
      compressions: Number(value.compressions ?? 0),
    };
  }

  async save(session: CoachConversationSession): Promise<void> {
    if (!this.enabled) return;
    const json = JSON.parse(JSON.stringify(session)) as Prisma.InputJsonValue;
    await this.prisma!.runtimeState.upsert({
      where: { key: sessionKey(session.userId) },
      create: { key: sessionKey(session.userId), value: json },
      update: { value: json },
    });
  }
}

function sessionKey(userId: string): string {
  return `${SESSION_KEY_PREFIX}${userId}`;
}