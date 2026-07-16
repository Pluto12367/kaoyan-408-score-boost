export interface TaskCompletionDraft {
  completedQuestionCount?: number;
  correctCount?: number;
  minutesSpent?: number;
  selfRating?: number;
}

type ValidTaskCompletion = Required<TaskCompletionDraft>;

export function validateTaskCompletionDraft(draft: TaskCompletionDraft):
  | { valid: true; value: ValidTaskCompletion }
  | { valid: false; error: string } {
  const { completedQuestionCount, correctCount, minutesSpent, selfRating } = draft;
  if (
    completedQuestionCount == null
    || correctCount == null
    || minutesSpent == null
    || selfRating == null
  ) {
    return { valid: false, error: '请填写实际完成题数、正确题数、学习分钟和掌握自评。' };
  }
  if (!Number.isInteger(completedQuestionCount) || completedQuestionCount < 0 || completedQuestionCount > 200) {
    return { valid: false, error: '实际完成题数需为 0-200 的整数。' };
  }
  if (!Number.isInteger(correctCount) || correctCount < 0 || correctCount > completedQuestionCount) {
    return { valid: false, error: '正确题数不能超过实际完成题数。' };
  }
  if (!Number.isInteger(minutesSpent) || minutesSpent < 1 || minutesSpent > 600) {
    return { valid: false, error: '实际学习时间需为 1-600 分钟。' };
  }
  if (!Number.isInteger(selfRating) || selfRating < 1 || selfRating > 5) {
    return { valid: false, error: '请选择 1-5 级掌握自评。' };
  }
  return {
    valid: true,
    value: { completedQuestionCount, correctCount, minutesSpent, selfRating },
  };
}
