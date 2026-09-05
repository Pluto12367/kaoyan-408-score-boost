import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  type AiFollowUpDraft,
  type AiTutorContext,
  type AiTutorFollowUpMode,
  type AiTutorReplyDraft,
  type AiTutorSimilarQuestion,
  buildFollowUpSystemPrompt,
  buildFollowUpUserPrompt,
  buildTemplateFollowUp,
  buildTemplateTutorReply,
  buildTutorSystemPrompt,
  buildTutorUserPrompt,
  parseFollowUpJson,
  parseTutorReplyJson,
} from '@kaoyan408/shared';
import { ChatCompletionError, DeepSeekClient } from './deepseek-client';
import { AiTutorLogRepository } from './ai-tutor-log.repository';
import {
  buildContextualCoachSystemPrompt,
  buildContextualCoachUserPrompt,
  buildTemplateContextualCoach,
} from './contextual-coach.prompt';
import type { ContextualCoachContext, ContextualCoachDraft } from './contextual-coach.types';
import { normalizeContextualCoachModelResponse } from './contextual-coach-normalizer';
import { AiMetricsService } from '../ai-metrics/ai-metrics.service';

export interface AiTutorResult<T> {
  draft: T;
  source: string;
  prompt: string;
  rawResponse?: string;
  fallbackReason?: string;
  durationMs?: number;
  errorType?: string;
}

// AI 答疑编排：构造提示词 -> 调用 DeepSeek -> 解析 JSON -> 记录 AiTutorLog。
// 未配置 AI_API_KEY 时回退到标准解析模板，source 字段可区分。
@Injectable()
export class AiTutorService {
  private readonly logger = new Logger(AiTutorService.name);
  private readonly client: DeepSeekClient | null;

  constructor(
    private readonly logRepository: AiTutorLogRepository,
    // Live metrics (AI-12): appended last per the positional-constructor
    // convention; optional so existing compositions stay valid.
    @Optional() private readonly metrics?: AiMetricsService,
  ) {
    const apiKey = process.env.AI_API_KEY;
    this.client = apiKey ? new DeepSeekClient({ apiKey }) : null;
  }

  get configured(): boolean {
    return this.client !== null;
  }

  async explain(
    context: AiTutorContext,
    similarQuestions: AiTutorSimilarQuestion[],
  ): Promise<AiTutorResult<AiTutorReplyDraft>> {
    if (!this.client) {
      return {
        draft: buildTemplateTutorReply(context, similarQuestions),
        source: 'standard-analysis-assisted',
        prompt: '',
        fallbackReason: 'AI_API_KEY not configured',
      };
    }
    const prompt = `${buildTutorSystemPrompt()}\n\n${buildTutorUserPrompt(context)}`;
    try {
      const { content, model } = await this.client.chatCompletions({
        messages: [
          { role: 'system', content: buildTutorSystemPrompt() },
          { role: 'user', content: buildTutorUserPrompt(context) },
        ],
        jsonMode: true,
      });
      const draft = parseTutorReplyJson(content);
      await this.logRepository.create({
        userId: context.userId,
        questionId: context.questionId,
        prompt,
        response: content,
      });
      return { draft, source: model, prompt, rawResponse: content };
    } catch (error) {
      await this.logRepository.create({
        userId: context.userId,
        questionId: context.questionId,
        prompt,
        response: `ERROR: ${describeError(error)}`,
      });
      throw error;
    }
  }

  async followUp(
    context: AiTutorContext,
    message: string,
    mode?: AiTutorFollowUpMode,
  ): Promise<AiTutorResult<AiFollowUpDraft>> {
    if (!this.client) {
      return {
        draft: buildTemplateFollowUp(context, message),
        source: 'standard-analysis-follow-up',
        prompt: '',
        fallbackReason: 'AI_API_KEY not configured',
      };
    }
    const prompt = `${buildFollowUpSystemPrompt()}\n\n${buildFollowUpUserPrompt(context, message, mode)}`;
    try {
      const { content, model } = await this.client.chatCompletions({
        messages: [
          { role: 'system', content: buildFollowUpSystemPrompt() },
          { role: 'user', content: buildFollowUpUserPrompt(context, message, mode) },
        ],
        jsonMode: true,
      });
      const draft = parseFollowUpJson(content);
      await this.logRepository.create({
        userId: context.userId,
        questionId: context.questionId,
        prompt,
        response: content,
      });
      return { draft, source: model, prompt, rawResponse: content };
    } catch (error) {
      await this.logRepository.create({
        userId: context.userId,
        questionId: context.questionId,
        prompt,
        response: `ERROR: ${describeError(error)}`,
      });
      throw error;
    }
  }

  async contextualCoach(
    userId: string,
    context: ContextualCoachContext,
    message?: string,
    sessionBrief?: string,
    personalizationSections?: string,
  ): Promise<AiTutorResult<ContextualCoachDraft>> {
    const startedAt = Date.now();
    if (!this.client) {
      const result = {
        draft: buildTemplateContextualCoach(context, message),
        source: 'contextual-coach-template',
        prompt: '',
        fallbackReason: 'AI unavailable',
        durationMs: Date.now() - startedAt,
      };
      this.logContextualCoachObservation({
        userId,
        context,
        source: result.source,
        fallbackReason: result.fallbackReason,
        durationMs: result.durationMs,
      });
      return result;
    }
    const prompt = `${buildContextualCoachSystemPrompt()}\n\n${buildContextualCoachUserPrompt(context, message, sessionBrief, personalizationSections)}`;
    const questionId = context.context.type === 'question' || context.context.type === 'wrong_question'
      ? context.context.id
      : null;
    try {
      const { content, model } = await this.client.chatCompletions({
        messages: [
          { role: 'system', content: buildContextualCoachSystemPrompt() },
          { role: 'user', content: buildContextualCoachUserPrompt(context, message, sessionBrief, personalizationSections) },
        ],
        jsonMode: true,
      });
      const normalized = normalizeContextualCoachModelResponse(
        content,
        buildTemplateContextualCoach(context, message),
      );
      await this.logRepository.create({ userId, questionId, prompt, response: content });
      const result = {
        draft: normalized.draft,
        source: normalized.fallbackReason ? 'contextual-coach-template' : model,
        prompt,
        rawResponse: content,
        ...(normalized.fallbackReason ? { fallbackReason: normalized.fallbackReason } : {}),
        durationMs: Date.now() - startedAt,
        ...(normalized.fallbackReason ? { errorType: 'model_output' } : {}),
      };
      this.logContextualCoachObservation({
        userId,
        context,
        source: result.source,
        fallbackReason: result.fallbackReason,
        durationMs: result.durationMs,
        errorType: result.errorType,
      });
      return result;
    } catch (error) {
      const errorType = describeErrorType(error);
      const fallbackReason = contextualFallbackReason(error);
      await this.logRepository.create({
        userId,
        questionId,
        prompt,
        response: `ERROR: ${describeError(error)}`,
      });
      const durationMs = Date.now() - startedAt;
      this.logContextualCoachObservation({
        userId,
        context,
        source: 'contextual-coach-template',
        fallbackReason,
        errorType,
        durationMs,
      });
      return {
        draft: buildTemplateContextualCoach(context, message),
        source: 'contextual-coach-template',
        prompt,
        fallbackReason,
        durationMs,
        errorType,
      };
    }
  }

  private logContextualCoachObservation(input: {
    userId: string;
    context: ContextualCoachContext;
    source: string;
    fallbackReason?: string;
    errorType?: string;
    durationMs: number;
  }): void {
    this.metrics?.recordCoachResponse({
      source: input.source,
      fallback: Boolean(input.fallbackReason),
      durationMs: input.durationMs,
    });
    this.logger.log(JSON.stringify({
      event: 'contextual_coach.completed',
      userId: input.userId,
      contextType: input.context.context.type,
      source: input.source,
      fallback: Boolean(input.fallbackReason),
      ...(input.fallbackReason ? { fallbackReason: input.fallbackReason } : {}),
      ...(input.errorType ? { errorType: input.errorType } : {}),
      durationMs: input.durationMs,
    }));
  }
}

function describeError(error: unknown): string {
  if (error instanceof ChatCompletionError) return `${error.kind}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

function describeErrorType(error: unknown): string {
  if (error instanceof ChatCompletionError) return error.kind;
  return 'unknown';
}

function contextualFallbackReason(error: unknown): string {
  if (!(error instanceof ChatCompletionError)) return 'provider_error';
  switch (error.kind) {
    case 'timeout': return 'provider_timeout';
    case 'rate-limited': return 'provider_rate_limited';
    case 'http': return 'provider_http_error';
    case 'network': return 'provider_network_error';
    case 'invalid-response': return 'provider_invalid_response';
    default: return 'provider_error';
  }
}
