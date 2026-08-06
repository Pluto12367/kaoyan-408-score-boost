import type { MistakeReason } from '@kaoyan408/shared';
import type { PracticeAnswerResult } from '../../api/endpoints/practice';

export interface PracticeReasonQueueItem {
  questionId: string;
  correct: boolean;
  timeSpentSec: number;
  isReview: boolean;
  mistakeReason?: MistakeReason | null;
}

export interface PracticeAttemptState {
  answerResult: PracticeAnswerResult | null;
  submitting: boolean;
  reasonQueue: PracticeReasonQueueItem[];
  redoQuestionId: string | null;
  variantOfQuestionId: string | null;
  index: number;
}

/**
 * 重做入口：清理上一次答题尝试的结果、提交中、错因队列，
 * 保留当前题目索引，仅切换目标题目。
 */
export function beginRedo(state: PracticeAttemptState, questionId: string): PracticeAttemptState {
  return {
    ...state,
    answerResult: null,
    submitting: false,
    reasonQueue: [],
    redoQuestionId: questionId,
    variantOfQuestionId: null,
  };
}

/**
 * 变式复测入口：与重做相同，额外记录原题与变式题映射。
 */
export function beginVariantRetest(
  state: PracticeAttemptState,
  originalQuestionId: string,
  variantQuestionId: string,
): PracticeAttemptState {
  return {
    ...state,
    answerResult: null,
    submitting: false,
    reasonQueue: [],
    redoQuestionId: originalQuestionId,
    variantOfQuestionId: variantQuestionId,
  };
}

/**
 * 切题入口：清理本次答题尝试的全部状态。
 * nextIndex 不传时仅清理（题库末尾分支），不移动题目索引。
 */
export function advanceQuestion(
  state: PracticeAttemptState,
  nextIndex?: number,
): PracticeAttemptState {
  return {
    ...state,
    answerResult: null,
    submitting: false,
    reasonQueue: [],
    redoQuestionId: null,
    variantOfQuestionId: null,
    ...(nextIndex === undefined ? {} : { index: nextIndex }),
  };
}
