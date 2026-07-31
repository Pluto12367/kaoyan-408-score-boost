import { createHash } from 'node:crypto';
import { questionFingerprintPayload, type QuestionFingerprintInput } from './questionImport';

export function computeContentFingerprint(question: QuestionFingerprintInput): string {
  return createHash('sha256').update(JSON.stringify(questionFingerprintPayload(question))).digest('hex');
}
