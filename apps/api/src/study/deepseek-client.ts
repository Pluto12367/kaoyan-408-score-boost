import { Injectable } from '@nestjs/common';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type ChatCompletionErrorKind = 'timeout' | 'rate-limited' | 'http' | 'network' | 'invalid-response';

export class ChatCompletionError extends Error {
  readonly kind: ChatCompletionErrorKind;
  readonly status?: number;

  constructor(kind: ChatCompletionErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'ChatCompletionError';
    this.kind = kind;
    this.status = status;
  }
}

export interface DeepSeekClientOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  maxTokens?: number;
  fetchImpl?: typeof fetch;
}

export interface ChatCompletionInput {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  jsonMode?: boolean;
}

export interface ChatCompletionResult {
  content: string;
  model: string;
}

// OpenAI 兼容 Chat Completions 客户端。默认对接 DeepSeek，也可通过
// AI_BASE_URL 指向其他兼容服务。测试时可注入 fetchImpl。
@Injectable()
export class DeepSeekClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly defaultTimeoutMs: number;
  private readonly defaultMaxTokens: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: DeepSeekClientOptions) {
    if (!options.apiKey) {
      throw new Error('DeepSeek API key is required');
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? process.env.AI_BASE_URL ?? 'https://api.deepseek.com').replace(/\/+$/, '');
    this.defaultModel = options.model ?? process.env.AI_MODEL ?? 'deepseek-v4-flash';
    this.defaultTimeoutMs = options.timeoutMs ?? Number(process.env.AI_TIMEOUT_MS ?? 25000);
    this.defaultMaxTokens = options.maxTokens ?? Number(process.env.AI_MAX_TOKENS ?? 2000);
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async chatCompletions(input: ChatCompletionInput): Promise<ChatCompletionResult> {
    const timeoutMs = input.timeoutMs ?? this.defaultTimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: input.model ?? this.defaultModel,
          messages: input.messages,
          max_tokens: input.maxTokens ?? this.defaultMaxTokens,
          temperature: input.temperature ?? 0.3,
          stream: false,
          // deepseek-v4-flash defaults to thinking mode, which can exhaust max_tokens
          // and return an empty content. Disable thinking for fast, stable tutoring.
          // Official API (api.deepseek.com) uses thinking.type=disabled; chat_template_kwargs
          // is kept for vLLM / self-hosted DeepSeek V3.1+ deployments.
          thinking: { type: 'disabled' },
          chat_template_kwargs: { thinking: false },
          ...(input.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 429) {
          throw new ChatCompletionError('rate-limited', 'DeepSeek request was rate limited (429)');
        }
        throw new ChatCompletionError('http', `DeepSeek request failed with ${response.status}`, response.status);
      }
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
        model?: string;
      };
      const message = payload.choices?.[0]?.message;
      const content = message?.content || message?.reasoning_content;
      if (!content) {
        throw new ChatCompletionError('invalid-response', 'DeepSeek returned an empty completion');
      }
      return { content, model: payload.model ?? this.defaultModel };
    } catch (error) {
      if (error instanceof ChatCompletionError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ChatCompletionError('timeout', `DeepSeek request timed out after ${timeoutMs}ms`);
      }
      throw new ChatCompletionError('network', error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timer);
    }
  }
}
