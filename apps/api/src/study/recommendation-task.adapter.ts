/**
 * Compatibility boundary for consumers that still need an actionId beside a
 * StudyTask. The database relation remains RecommendationAction.studyTaskId;
 * this adapter never pretends that StudyTask has an actionId column.
 */
export type RecommendationTaskWithAction = {
  id: string;
  action?: { id: string } | null;
  [key: string]: unknown;
};

export function toRecommendationTaskCompat(task: RecommendationTaskWithAction) {
  const { action, ...legacyTask } = task;
  return {
    ...legacyTask,
    actionId: action?.id ?? null,
  };
}
