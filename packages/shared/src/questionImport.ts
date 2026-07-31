import { createHash } from 'node:crypto';
import type { Question } from './domain';

export type QuestionFingerprintInput = Pick<
  Question,
  'stem' | 'options' | 'answer' | 'analysis' | 'knowledgePointIds' | 'difficulty' | 'type' | 'source' | 'year' | 'expectedTimeSec'
>;

export function questionFingerprintPayload(question: QuestionFingerprintInput) {
  return {
    stem: question.stem,
    options: question.options,
    answer: question.answer,
    analysis: question.analysis,
    knowledgePointIds: [...question.knowledgePointIds].sort(),
    difficulty: question.difficulty,
    type: question.type,
    source: question.source,
    year: question.year ?? null,
    expectedTimeSec: question.expectedTimeSec,
  };
}

export function computeContentFingerprint(question: QuestionFingerprintInput): string {
  return createHash('sha256').update(JSON.stringify(questionFingerprintPayload(question))).digest('hex');
}
