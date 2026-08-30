import type { ContextualCoachDraft } from './contextual-coach.types';

export type ContextualCoachFallbackReason = 'invalid_model_json' | 'empty_model_response' | 'unsafe_model_content';

export interface ContextualCoachNormalizationResult {
  draft: ContextualCoachDraft;
  fallbackReason?: ContextualCoachFallbackReason;
}

export function normalizeContextualCoachModelResponse(
  raw: unknown,
  fallbackDraft: ContextualCoachDraft,
): ContextualCoachNormalizationResult {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { draft: fallbackDraft, fallbackReason: 'empty_model_response' };
  }
  try {
    const draft = normalizeContextualCoachDraft(JSON.parse(raw));
    return containsSystemActionClaim(draft)
      ? { draft: fallbackDraft, fallbackReason: 'unsafe_model_content' }
      : { draft };
  } catch {
    return { draft: fallbackDraft, fallbackReason: 'invalid_model_json' };
  }
}

export function normalizeContextualCoachDraft(input: unknown): ContextualCoachDraft {
  const value = isRecord(input) ? input : {};
  const cards: ContextualCoachDraft['reviewCards'] = Array.isArray(value.reviewCards)
    ? value.reviewCards.slice(0, 3).map((card, index) => {
      const item = isRecord(card) ? card : {};
      return {
        id: stringValue(item.id, `context-card-${index + 1}`),
        type: item.type === 'rule' || item.type === 'confusion' ? item.type : 'concept',
        title: stringValue(item.title, '复盘卡片'),
        content: stringValue(item.content, '回到上下文事实进行核对。'),
        nextAction: stringValue(item.nextAction, '完成一次复述'),
      };
    })
    : [];
  return {
    summary: stringValue(value.summary, '请根据已提供的学习事实完成复盘。'),
    replySteps: stringArray(value.replySteps),
    misconceptionTips: stringArray(value.misconceptionTips),
    reviewCards: cards,
    nextActions: stringArray(value.nextActions),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').slice(0, 5)
    : [];
}

function containsSystemActionClaim(draft: ContextualCoachDraft): boolean {
  const text = [
    draft.summary,
    ...draft.replySteps,
    ...draft.misconceptionTips,
    ...draft.reviewCards.flatMap((card) => [card.title, card.content, card.nextAction]),
    ...draft.nextActions,
  ].join(' ');
  return /已(?:经)?(?:帮你)?(?:修改|调整|创建|安排|写入|记录)|掌握度(?:已经|已)?提升|created\s+(?:a\s+)?(?:study\s+)?plan|updated?\s+mastery|scheduled?\s+review|modified?\s+student\s+state/i.test(text);
}
