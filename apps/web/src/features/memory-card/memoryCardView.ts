// V14-② — pure view helpers for the memory-card workspace.
// Zero local thresholds, zero recomputation: presentation only. Honesty rules:
//   • retention null → 「未复习」 (never rendered as a number, RULE-06)
//   • card retention ≠ mastery ≠ score — the label states what it is.

import type { MemoryCardQueueItem } from '../../api/endpoints/memoryCard';

export const RATING_OPTIONS = [
  { value: 'forgot', label: '没记住', hint: '尽快再见' },
  { value: 'fuzzy', label: '模糊', hint: '保持当前节奏' },
  { value: 'remembered', label: '记住', hint: '间隔放长' },
] as const;

export const CARD_TYPE_LABELS: Record<string, string> = {
  CONCLUSION: '结论卡',
  FORMULA: '公式卡',
};

export function cardTypeLabel(cardType: string): string {
  return CARD_TYPE_LABELS[cardType] ?? '记忆卡';
}

/** null = never reviewed: a status, not a zero and not a fabricated prior. */
export function retentionLabel(retention: number | null): string {
  if (retention == null) return '未复习';
  return `保持率约 ${Math.round(retention * 100)}%`;
}

export function phaseLabel(item: MemoryCardQueueItem): string {
  return item.phase === 'due' ? '到期复习' : '新卡';
}

export function hasRenderableQueue(queue: MemoryCardQueueItem[] | null | undefined): boolean {
  return Array.isArray(queue) && queue.length > 0;
}

export function progressLabel(index: number, total: number): string {
  return `${Math.min(index + 1, total)} / ${total}`;
}
