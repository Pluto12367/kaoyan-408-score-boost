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

interface MineruClient { extract(source: string, options: { model: string; timeout: number }): Promise<ExtractResult>; }
export interface MineruProviderOptions {
  resolveSource?: (input: ProviderInput) => Promise<string>;
  persistRaw?: (result: ExtractResult) => Promise<string>;
  createClient?: (token: string) => MineruClient;
}

interface Task { input: ProviderInput; rawResultKey?: string; result?: ExtractResult; error?: unknown; promise: Promise<void>; }

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
    if (!this.token) throw new PdfParserNotConfiguredError();
    const externalTaskId = `mineru-${randomUUID()}`;
    const task: Task = { input, promise: Promise.resolve() };
    task.promise = (async () => {
      try {
        task.result = await this.createClient(this.token!).extract(await this.resolveSource(input), { model: 'vlm', timeout: 600 });
        task.rawResultKey = await this.persistRaw(task.result);
      }
      catch (error) { task.error = error; }
    })();
    this.tasks.set(externalTaskId, task);
    return { externalTaskId };
  }

  async poll(externalTaskId: string): Promise<ProviderPollResult> {
    const task = this.tasks.get(externalTaskId);
    if (!task) return { state: 'failed', code: 'DOCUMENT_TASK_NOT_FOUND', retryable: false, message: 'Document parsing task was not found' };
    await task.promise;
    if (task.error) return failure(task.error);
    if (task.result?.state === 'done') return { state: 'succeeded' };
    return { state: 'failed', code: 'DOCUMENT_PARSE_FAILED', retryable: false, message: 'Document parsing failed' };
  }

  async fetchResult(externalTaskId: string): Promise<ParsedDocument> {
    const task = this.tasks.get(externalTaskId);
    if (!task) throw new Error('DOCUMENT_TASK_NOT_FOUND');
    await task.promise;
    if (task.error || !task.result || task.result.state !== 'done') throw new Error('DOCUMENT_PARSE_NOT_READY');
    const pages = mapPages(task.result, task.input.pageStart, this.quality);
    if (!task.rawResultKey) throw new Error('DOCUMENT_RESULT_STORAGE_UNAVAILABLE');
    return { provider: 'mineru', model: 'vlm', pages, rawResultKey: task.rawResultKey };
  }
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
