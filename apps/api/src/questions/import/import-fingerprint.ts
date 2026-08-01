import { computeContentFingerprint } from '@kaoyan408/shared/questionImport.server';
import { createHash } from 'node:crypto';

export const computeImportFingerprint = computeContentFingerprint;

export function computeInvalidImportFingerprint(jobId: string, sourceRowNumber: number): string {
  return createHash('sha256').update(JSON.stringify({ jobId, sourceRowNumber, invalid: true })).digest('hex');
}
