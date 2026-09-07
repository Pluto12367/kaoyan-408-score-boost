/**
 * V10-4 Sprite Memory — user-stated preference memory (pure module).
 *
 * Constitution §7.3-②: the ONLY persistent sprite memory is what the user
 * explicitly states ("我喜欢计组"). Extraction is deterministic regex — no
 * LLM in the memory path (LLM extraction would need its own design). The
 * store is a bounded, discardable operational state in RuntimeState
 * (`sprite-memory:{userId}`, see sprite-memory.repository.ts): max 12
 * entries, 80 chars each, exact-text dedupe touches lastSeenAt instead of
 * duplicating, least-recently-seen evicted. Never a second source of truth;
 * never written back to the learning engine.
 */

export const MAX_SPRITE_MEMORY_ENTRIES = 12;
export const SPRITE_MEMORY_TEXT_MAX = 80;
export const SPRITE_MEMORY_PER_MESSAGE_MAX = 3;

export interface SpriteMemoryEntry {
  readonly id: string;
  readonly text: string;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  readonly source: 'user_stated';
}

const STATED_PATTERNS =
  /(我喜欢|我想考|我的目标|我在准备|我不擅长|我怕|我每天)([^，。；！!？?\n]{0,24})/g;

export function extractSpritePreferences(rawText: string): string[] {
  const text = String(rawText ?? '');
  const found: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(STATED_PATTERNS)) {
    const candidate = `${match[1]}${match[2]}`.trim().slice(0, SPRITE_MEMORY_TEXT_MAX);
    if (candidate.length < 3 || seen.has(candidate)) continue;
    seen.add(candidate);
    found.push(candidate);
    if (found.length >= SPRITE_MEMORY_PER_MESSAGE_MAX) break;
  }
  return found;
}

export function mergeSpriteMemory(
  existing: readonly SpriteMemoryEntry[],
  candidates: readonly string[],
  asOf: string,
): { entries: SpriteMemoryEntry[]; added: string[] } {
  const entries = existing.map((item) => ({ ...item }));
  const added: string[] = [];
  const stamp = asOf.replace(/\D/g, '');

  for (const rawCandidate of candidates) {
    const text = rawCandidate.slice(0, SPRITE_MEMORY_TEXT_MAX);
    const hit = entries.find((item) => item.text === text);
    if (hit) {
      hit.lastSeenAt = asOf;
      continue;
    }
    entries.push({
      id: `mem:${stamp}:${added.length}`,
      text,
      createdAt: asOf,
      lastSeenAt: asOf,
      source: 'user_stated',
    });
    added.push(text);
  }

  const sorted = [...entries].sort(
    (left, right) =>
      right.lastSeenAt.localeCompare(left.lastSeenAt) || right.createdAt.localeCompare(left.createdAt),
  );
  return { entries: sorted.slice(0, MAX_SPRITE_MEMORY_ENTRIES), added };
}
