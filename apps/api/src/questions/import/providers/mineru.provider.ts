import { MinerU, TimeoutError, type ExtractResult } from 'mineru-open-sdk';
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { DocumentBlock, ParsedDocument, SourceRegion } from '../document-blocks';
import { ImportQualityService } from '../import-quality.service';
import type { DocumentParserProvider, ProviderInput, ProviderPollResult } from './document-parser.provider';

export const PDF_PARSER_NOT_CONFIGURED = 'PDF_PARSER_NOT_CONFIGURED';
export const PDF_PARSER_NOT_CONFIGURED_MESSAGE = 'PDF 解析服务尚未配置，Excel/CSV 导入仍可使用';

export class PdfParserNotConfiguredError extends Error {
  readonly code = PDF_PARSER_NOT_CONFIGURED;
  constructor(readonly requestId = randomUUID()) { super(`${PDF_PARSER_NOT_CONFIGURED_MESSAGE}（请求 ID：${requestId}）`); }
}

interface MineruClient {
  extract(source: string, options: { model: string; timeout: number }): Promise<ExtractResult>;
  getTask(taskId: string): Promise<ExtractResult>;
}
export interface MineruProviderOptions {
  resolveSource?: (input: ProviderInput) => Promise<string>;
  persistRaw?: (result: ExtractResult) => Promise<string>;
  createClient?: (token: string) => MineruClient;
}

interface Task { input?: ProviderInput; rawResultKey?: string; result: ExtractResult; }

@Injectable()
export class MineruProvider implements DocumentParserProvider {
  readonly name = 'mineru' as const;
  private readonly tasks = new Map<string, Task>();
  private readonly resolveSource: (input: ProviderInput) => Promise<string>;
  private readonly persistRaw: (result: ExtractResult) => Promise<string>;
  private readonly createClient: (token: string) => MineruClient;

  constructor(
    private readonly token = process.env.MINERU_API_TOKEN,
    options: MineruProviderOptions = {},
    private readonly quality = new ImportQualityService(),
  ) {
    this.resolveSource = options.resolveSource ?? (async () => { throw new Error('DOCUMENT_SOURCE_UNRESOLVED'); });
    this.persistRaw = options.persistRaw ?? (async () => { throw new Error('DOCUMENT_RESULT_STORAGE_UNRESOLVED'); });
    this.createClient = options.createClient ?? ((value) => new MinerU(value));
  }

  async submit(input: ProviderInput): Promise<{ externalTaskId: string }> {
    this.assertConfigured();
    const result = await this.createClient(this.token!).extract(await this.resolveSource(input), { model: 'vlm', timeout: 600 });
    if (!result.taskId) throw new Error('DOCUMENT_TASK_ID_MISSING');
    const task: Task = { input, result };
    if (result.state === 'done') task.rawResultKey = await this.persistRaw(result);
    this.tasks.set(result.taskId, task);
    return { externalTaskId: result.taskId };
  }

  assertConfigured(): void {
    if (!this.token) throw new PdfParserNotConfiguredError();
  }

  async poll(externalTaskId: string): Promise<ProviderPollResult> {
    this.assertConfigured();
    try {
      return pollResult((await this.loadTask(externalTaskId, false)).result);
    } catch (error) {
      return failure(error);
    }
  }

  async fetchResult(externalTaskId: string, input?: ProviderInput): Promise<ParsedDocument> {
    this.assertConfigured();
    const task = await this.loadTask(externalTaskId, true);
    if (task.result.state !== 'done') throw new Error('DOCUMENT_PARSE_NOT_READY');
    const context = input ?? task.input;
    if (!context) throw new Error('DOCUMENT_TASK_CONTEXT_MISSING');
    task.input = context;
    const pages = mapPages(task.result, context.pageStart, this.quality);
    if (!task.rawResultKey) throw new Error('DOCUMENT_RESULT_STORAGE_UNAVAILABLE');
    return { provider: 'mineru', model: 'vlm', pages, rawResultKey: task.rawResultKey };
  }

  private async loadTask(externalTaskId: string, allowCachedTerminal: boolean): Promise<Task> {
    const cached = this.tasks.get(externalTaskId);
    if (cached && (allowCachedTerminal || ['done', 'failed'].includes(cached.result.state))) return cached;
    const result = await this.createClient(this.token!).getTask(externalTaskId);
    const task: Task = { input: cached?.input, rawResultKey: cached?.rawResultKey, result };
    if (result.state === 'done' && !task.rawResultKey) task.rawResultKey = await this.persistRaw(result);
    this.tasks.set(externalTaskId, task);
    return task;
  }
}

function pollResult(result: ExtractResult): ProviderPollResult {
  if (result.state === 'done') return { state: 'succeeded' };
  if (result.state === 'failed') return { state: 'failed', code: result.errCode || 'DOCUMENT_PARSE_FAILED', retryable: false, message: result.error || 'Document parsing failed' };
  return { state: result.state === 'pending' ? 'queued' : 'running', retryAfterMs: 1_000 };
}

function failure(error: unknown): ProviderPollResult {
  if (error instanceof TimeoutError) return { state: 'failed', code: 'DOCUMENT_PARSE_TIMEOUT', retryable: true, message: 'Document parsing timed out' };
  return { state: 'failed', code: 'DOCUMENT_PARSE_FAILED', retryable: false, message: 'Document parsing failed' };
}

function mapPages(result: ExtractResult, pageStart: number, quality: ImportQualityService): ParsedDocument['pages'] {
  const pages = new Map<number, { width: number; height: number; blocks: DocumentBlock[] }>();
  for (const item of result.contentList ?? []) {
    const record = item as Record<string, unknown>;
    const pageIndex = number(record.page_idx) ?? number(record.pageNumber) ?? 0;
    const size = Array.isArray(record.page_size) ? record.page_size : [];
    const width = number(size[0]) ?? number(record.page_width) ?? 1;
    const height = number(size[1]) ?? number(record.page_height) ?? 1;
    const page = pages.get(pageIndex) ?? { width, height, blocks: [] };
    page.blocks.push(...blocksFor(record, width, height));
    pages.set(pageIndex, page);
  }
  return [...pages.entries()].sort(([left], [right]) => left - right).map(([pageIndex, page]) => ({
    pageNumber: pageIndex + pageStart, width: page.width, height: page.height, blocks: page.blocks, quality: quality.assess(page.blocks),
  }));
}

function blocksFor(record: Record<string, unknown>, width: number, height: number): DocumentBlock[] {
  const region = normalizedRegion(record.bbox, width, height);
  const confidence = number(record.score) ?? number(record.confidence);
  const type = String(record.type ?? record.category ?? 'text').toLowerCase();
  const text = String(record.text ?? record.content ?? '');
  if (type.includes('formula')) return text ? [{ kind: 'formula', latex: text, region, ...(confidence === undefined ? {} : { confidence }) }] : [];
  if (type.includes('table')) return text ? [{ kind: 'table', html: text, region }] : [];
  if (type.includes('image')) {
    const providerAssetId = String(record.id ?? record.image_id ?? '');
    return providerAssetId ? [{ kind: 'image', providerAssetId, region }] : [];
  }
  return text ? [{ kind: 'text', text, region, ...(confidence === undefined ? {} : { confidence }) }] : [];
}

function normalizedRegion(value: unknown, width: number, height: number): SourceRegion {
  const bbox = Array.isArray(value) ? value.map(number) : [];
  const [left = 0, top = 0, right = left, bottom = top] = bbox;
  return { x: clamp(left / width), y: clamp(top / height), width: clamp((right - left) / width), height: clamp((bottom - top) / height) };
}

function number(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }
function clamp(value: number): number { return Math.max(0, Math.min(1, value)); }
