export const GENERATION_KEY_NAMESPACE = {
  LEARNING_LOOP: 'LEARNING_LOOP',
  MANUAL: 'MANUAL',
  AI_COACH: 'AI_COACH',
} as const;

function requireValue(name: string, value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

export function createLearningLoopGenerationKey(
  userId: string,
  scheduledDate: string,
  version = 'v1',
): string {
  return [
    GENERATION_KEY_NAMESPACE.LEARNING_LOOP,
    requireValue('userId', userId),
    requireValue('scheduledDate', scheduledDate),
    requireValue('version', version),
  ].join(':');
}

export function createManualGenerationKey(
  userId: string,
  scheduledDate: string,
  requestKey: string,
): string {
  return [
    GENERATION_KEY_NAMESPACE.MANUAL,
    requireValue('userId', userId),
    requireValue('scheduledDate', scheduledDate),
    requireValue('requestKey', requestKey),
  ].join(':');
}

export function createAiCoachGenerationKey(
  userId: string,
  scheduledDate: string,
  contextHash: string,
  version = 'v1',
): string {
  return [
    GENERATION_KEY_NAMESPACE.AI_COACH,
    requireValue('userId', userId),
    requireValue('scheduledDate', scheduledDate),
    requireValue('contextHash', contextHash),
    requireValue('version', version),
  ].join(':');
}
