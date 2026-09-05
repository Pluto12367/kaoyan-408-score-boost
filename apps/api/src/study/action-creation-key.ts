export const ACTION_KEY_NAMESPACE = 'ACTION' as const;

function requireValue(name: string, value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

/**
 * Builds the generation-scoped identity for one recommendation action.
 *
 * This is intentionally a pure contract function. Runtime persistence and
 * migration of existing creation keys remain outside this phase.
 */
export function createRecommendationActionKey(
  generationKey: string,
  actionType: string,
  targetType: string,
  targetId: string,
): string {
  return [
    ACTION_KEY_NAMESPACE,
    requireValue('generationKey', generationKey),
    requireValue('actionType', actionType),
    requireValue('targetType', targetType),
    requireValue('targetId', targetId),
  ].join(':');
}
