import { createHash } from 'node:crypto';
import type { CreatePracticeRecordDto } from './dto/create-practice-record.dto';

export const PRACTICE_RECORD_HASH_VERSION = 'v1';

type PracticeRecordHashInput = CreatePracticeRecordDto & {
  userId: string;
};

export function computePracticeRecordRequestHash(
  input: PracticeRecordHashInput,
  hashVersion = PRACTICE_RECORD_HASH_VERSION,
): string {
  const payload = {
    operation: 'POST /practice-records',
    userId: input.userId,
    questionId: input.questionId,
    knowledgePointId: input.knowledgePointId,
    selectedAnswer: input.selectedAnswer ?? null,
    timeSpentSec: input.timeSpentSec,
    expectedTimeSec: input.expectedTimeSec ?? null,
    sessionId: input.sessionId ?? null,
    selfScore: input.selfScore ?? null,
    maxScore: input.maxScore ?? null,
    confidence: input.confidence ?? null,
    usedHint: input.usedHint ?? null,
    answerModified: input.answerModified ?? null,
    variantQuestionId: input.variantQuestionId ?? null,
  };
  const digest = createHash('sha256')
    .update(stableStringify({ hashVersion, payload }))
    .digest('hex');
  return `${hashVersion}:${digest}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
}
