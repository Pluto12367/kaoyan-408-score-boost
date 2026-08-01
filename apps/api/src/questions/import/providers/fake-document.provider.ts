import type { ParsedDocument } from '../document-blocks';
import type { DocumentParserProvider, ProviderInput, ProviderPollResult } from './document-parser.provider';

type FakeState = 'queued' | 'running' | 'succeeded' | 'failed' | 'timeout';

export interface FakeDocumentProviderOptions {
  states?: FakeState[];
  failure?: { code: string; retryable: boolean; message: string };
  document?: ParsedDocument;
}

/** A deterministic, credential-free provider for tests and local sample gates. */
export class FakeDocumentProvider implements DocumentParserProvider {
  readonly name = 'mineru' as const;
  private readonly tasks = new Map<string, { states: FakeState[]; index: number; document: ParsedDocument }>();

  constructor(private readonly options: FakeDocumentProviderOptions = {}) {}

  async submit(input: ProviderInput): Promise<{ externalTaskId: string }> {
    const externalTaskId = `fake-${input.jobId}-${this.tasks.size + 1}`;
    this.tasks.set(externalTaskId, {
      states: this.options.states ?? ['queued', 'running', 'succeeded'], index: 0,
      document: this.options.document ?? emptyDocument(input),
    });
    return { externalTaskId };
  }

  async poll(externalTaskId: string): Promise<ProviderPollResult> {
    const task = this.tasks.get(externalTaskId);
    if (!task) return { state: 'failed', code: 'DOCUMENT_TASK_NOT_FOUND', retryable: false, message: 'Document parsing task was not found' };
    const state = task.states[Math.min(task.index++, task.states.length - 1)];
    if (state === 'queued' || state === 'running') return { state, retryAfterMs: 100 };
    if (state === 'succeeded') return { state: 'succeeded' };
    if (state === 'timeout') return { state: 'failed', code: 'DOCUMENT_PARSE_TIMEOUT', retryable: true, message: 'Document parsing timed out' };
    return { state: 'failed', ...(this.options.failure ?? { code: 'DOCUMENT_PARSE_FAILED', retryable: false, message: 'Document parsing failed' }) };
  }

  async fetchResult(externalTaskId: string): Promise<ParsedDocument> {
    const task = this.tasks.get(externalTaskId);
    if (!task) throw new Error('DOCUMENT_TASK_NOT_FOUND');
    return task.document;
  }
}

function emptyDocument(input: ProviderInput): ParsedDocument {
  return { provider: 'mineru', model: 'fake', pages: [{ pageNumber: input.pageStart, width: 1, height: 1, blocks: [], quality: { score: 0, signals: ['empty_page'] } }] };
}
