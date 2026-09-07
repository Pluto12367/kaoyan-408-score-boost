/**
 * V10-4 Sprite Memory Repository.
 *
 * Persists the bounded preference list in the existing RuntimeState key/value
 * table (key = sprite-memory:{userId}) — same Design Gate as CoachSessionRepository
 * (PX-1): no schema change, no new fact source, discardable at any time.
 * When the database is unavailable the repository is disabled and callers
 * degrade honestly (empty list / disabled flag — no silent mock).
 */

import { Injectable, Optional } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MAX_SPRITE_MEMORY_ENTRIES, type SpriteMemoryEntry } from './sprite-memory';

const MEMORY_KEY_PREFIX = 'sprite-memory:';

function memoryKey(userId: string): string {
  return `${MEMORY_KEY_PREFIX}${userId}`;
}

@Injectable()
export class SpriteMemoryRepository {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  get enabled() {
    return Boolean(process.env.DATABASE_URL && this.prisma);
  }

  async load(userId: string): Promise<SpriteMemoryEntry[]> {
    if (!this.enabled) return [];
    const row = await this.prisma!.runtimeState.findUnique({ where: { key: memoryKey(userId) } });
    if (!row || typeof row.value !== 'object' || row.value === null) return [];
    const value = row.value as { userId?: unknown; entries?: unknown };
    if (value.userId !== userId || !Array.isArray(value.entries)) return [];
    return value.entries
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((raw) => ({
        id: String(raw.id ?? ''),
        text: String(raw.text ?? ''),
        createdAt: String(raw.createdAt ?? ''),
        lastSeenAt: String(raw.lastSeenAt ?? ''),
        source: 'user_stated' as const,
      }))
      .filter((item) => item.id && item.text)
      .slice(0, MAX_SPRITE_MEMORY_ENTRIES);
  }

  async save(userId: string, entries: readonly SpriteMemoryEntry[]): Promise<void> {
    if (!this.enabled) return;
    const json = JSON.parse(JSON.stringify({ userId, entries })) as Prisma.InputJsonValue;
    await this.prisma!.runtimeState.upsert({
      where: { key: memoryKey(userId) },
      update: { value: json },
      create: { key: memoryKey(userId), value: json },
    });
  }
}
