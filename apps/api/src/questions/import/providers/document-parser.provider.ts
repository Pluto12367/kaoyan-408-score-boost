import type { ParsedDocument } from '../document-blocks';

export interface ProviderInput {
  jobId: string;
  storageKey: string;
  fileName: string;
  pageStart: number;
  pageEnd: number;
}

export type ProviderPollResult =
  | { state: 'queued' | 'running'; retryAfterMs: number }
  | { state: 'succeeded' }
  | { state: 'failed'; code: string; retryable: boolean; message: string };

export interface DocumentParserProvider {
  readonly name: 'mineru' | 'tencent-ocr';
  submit(input: ProviderInput): Promise<{ externalTaskId: string }>;
  poll(externalTaskId: string): Promise<ProviderPollResult>;
  fetchResult(externalTaskId: string): Promise<ParsedDocument>;
}
