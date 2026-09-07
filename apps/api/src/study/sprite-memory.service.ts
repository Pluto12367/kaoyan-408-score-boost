/**
 * V10-4 Sprite Memory Service.
 *
 * remember() = deterministic extraction (sprite-memory.ts) + bounded merge +
 * RuntimeState persistence. No LLM anywhere; the store is discardable and
 * never consulted by the learning engine. A disabled repository (no DB)
 * degrades with an explicit `disabled` flag — never a silent fake.
 */

import { Injectable, Optional } from '@nestjs/common';
import { extractSpritePreferences, mergeSpriteMemory, type SpriteMemoryEntry } from './sprite-memory';
import { SpriteMemoryRepository } from './sprite-memory.repository';

@Injectable()
export class SpriteMemoryService {
  constructor(@Optional() private readonly repository?: SpriteMemoryRepository) {}

  get enabled() {
    return Boolean(this.repository?.enabled);
  }

  /** `null` entries = memory unavailable (repository disabled). */
  async list(userId: string): Promise<SpriteMemoryEntry[] | null> {
    if (!this.enabled) return null;
    return this.repository!.load(userId);
  }

  async remember(
    userId: string,
    rawText: string,
    now: Date = new Date(),
  ): Promise<{ entries: SpriteMemoryEntry[]; added: string[]; disabled: boolean }> {
    if (!this.enabled) return { entries: [], added: [], disabled: true };
    const existing = await this.repository!.load(userId);
    const candidates = extractSpritePreferences(rawText);
    if (candidates.length === 0) {
      return { entries: existing, added: [], disabled: false };
    }
    const { entries, added } = mergeSpriteMemory(existing, candidates, now.toISOString());
    await this.repository!.save(userId, entries);
    return { entries, added, disabled: false };
  }

  async forget(userId: string, memoryId: string): Promise<{ removed: boolean }> {
    if (!this.enabled) return { removed: false };
    const existing = await this.repository!.load(userId);
    const remaining = existing.filter((item) => item.id !== memoryId);
    if (remaining.length === existing.length) return { removed: false };
    await this.repository!.save(userId, remaining);
    return { removed: true };
  }
}
