import type { WrongQuestion } from '../../api';

export interface WrongReviewPriorityResult {
  priority: '高' | '中' | '低';
  reason: string;
  suggestedAction: string;
}

function scoreWrongQuestion(item: WrongQuestion): number {
  const repeated = Math.min(item.wrongCount, 5) * 18;
  const importance = (item.importance ?? 3) * 12;
  const dueBoost = item.reviewedAt ? Math.max(0, 16 - Math.floor((Date.now() - Date.parse(item.reviewedAt)) / 86_400_000)) : 18;
  const notReviewedBoost = item.reviewStatus === 'pending' ? 10 : 0;
  const masteryBoost = item.masteryStatus === '未掌握' ? 16 : item.masteryStatus === '复习中' ? 8 : 0;
  const sameTypePenalty = item.masteryCriteria?.variantCorrectCount === 0 && item.wrongCount > 1 ? 6 : 0;
  return repeated + importance + dueBoost + notReviewedBoost + masteryBoost + sameTypePenalty;
}

export function buildWrongReviewPriority(item: WrongQuestion): WrongReviewPriorityResult {
  const score = scoreWrongQuestion(item);
  const priority = score >= 80 ? '高' : score >= 55 ? '中' : '低';
  const dueText = item.reviewedAt ? `，上次复盘在 ${item.reviewedAt.slice(0, 10)}` : '，还没有完整复盘记录';
  const reason = `这道题错了 ${item.wrongCount} 次，重要度 ${item.importance ?? 0}，当前状态 ${item.masteryStatus}${dueText}。`;
  const suggestedAction = priority === '高'
    ? '先复盘标准解析，再做同考点变式'
    : priority === '中'
      ? '先回看错因，再做一次重做'
      : '确认掌握后再做一题验证';

  return { priority, reason, suggestedAction };
}

export function rankWrongReviewItems(items: WrongQuestion[]): WrongQuestion[] {
  return [...items].sort((a, b) => scoreWrongQuestion(b) - scoreWrongQuestion(a));
}
