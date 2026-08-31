import type { DueReviewItem } from '../../../../api/endpoints/review';
import type { WrongQuestion, WrongQuestionSummary } from '../../../../api/types';
import type { StudentAction } from '../studentAction';

type PriorityRedoItem = WrongQuestionSummary['priorityRedoItems'][number];

export function buildReviewActions(input: {
  dueReviews: readonly DueReviewItem[];
  priorityRedoItems: readonly PriorityRedoItem[];
  displayFallbackItems?: readonly WrongQuestion[];
}): StudentAction[] {
  const actions: StudentAction[] = [];
  const seenQuestionIds = new Set<string>();

  for (const item of input.dueReviews) {
    if (seenQuestionIds.has(item.questionId)) continue;
    seenQuestionIds.add(item.questionId);
    actions.push({
      id: `review-due:${item.questionId}`,
      type: 'review_due',
      title: item.stem,
      destination: 'review',
      source: 'review-due',
      reason: item.inferredReason ?? item.selfReportedReason,
      context: { questionId: item.questionId },
    });
  }

  for (const item of input.priorityRedoItems) {
    if (seenQuestionIds.has(item.questionId)) continue;
    seenQuestionIds.add(item.questionId);
    actions.push({
      id: `redo-wrong-question:${item.questionId}`,
      type: 'redo_wrong_question',
      title: item.nextAction,
      destination: 'practice',
      source: 'wrong-summary',
      reason: item.latestMistakeReason ?? undefined,
      context: { questionId: item.questionId },
    });
  }

  for (const item of input.displayFallbackItems ?? []) {
    if (seenQuestionIds.has(item.questionId)) continue;
    seenQuestionIds.add(item.questionId);
    actions.push({
      id: `redo-wrong-question:${item.questionId}`,
      type: 'redo_wrong_question',
      title: `展示兜底：${item.nextAction ?? item.stem}`,
      destination: 'review',
      source: 'wrong-summary-fallback',
      reason: item.latestMistakeReason ?? undefined,
      context: { questionId: item.questionId },
    });
  }

  return actions;
}
