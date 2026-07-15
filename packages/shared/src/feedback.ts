export const FEEDBACK_SCENES = [
  'diagnostic',
  'today_plan',
  'practice',
  'mistakes',
  'exam',
  'overall',
] as const;

export type FeedbackScene = (typeof FEEDBACK_SCENES)[number];

export interface FeedbackDraft {
  rating: number;
  scene: FeedbackScene;
  message: string;
}

export type FeedbackDraftErrors = Partial<Record<keyof FeedbackDraft, string>>;

export type FeedbackDraftValidation =
  | { valid: true; value: FeedbackDraft }
  | { valid: false; errors: FeedbackDraftErrors };

export function countUnicodeCharacters(value: string): number {
  return Array.from(value).length;
}

export function validateFeedbackDraft(input: {
  rating: number;
  scene: string;
  message: string;
}): FeedbackDraftValidation {
  const errors: FeedbackDraftErrors = {};
  const message = input.message.trim();

  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    errors.rating = '请选择 1-5 分的整数评分';
  }

  if (!FEEDBACK_SCENES.includes(input.scene as FeedbackScene)) {
    errors.scene = '请选择反馈场景';
  }

  const messageLength = countUnicodeCharacters(message);
  if (messageLength < 10 || messageLength > 1000) {
    errors.message = '反馈正文需为 10-1000 个字符';
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      rating: input.rating,
      scene: input.scene as FeedbackScene,
      message,
    },
  };
}
