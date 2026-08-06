import { Injectable, Logger } from '@nestjs/common';
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

export interface AiTutorResult<T> {
  draft: T;
  source: string;
  prompt: string;
  rawResponse?: string;
  fallbackReason?: string;
}

// AI 答疑编排：构造提示词 -> 调用 DeepSeek -> 解析 JSON -> 记录 AiTutorLog。
// 未配置 AI_API_KEY 时回退到标准解析模板，source 字段可区分。
@Injectable()
export class AiTutorService {
  private readonly logger = new Logger(AiTutorService.name);
  private readonly client: DeepSeekClient | null;

  constructor(private readonly logRepository: AiTutorLogRepository) {
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
}

function describeError(error: unknown): string {
  if (error instanceof ChatCompletionError) return `${error.kind}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}