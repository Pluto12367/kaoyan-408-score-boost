import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  buildAiVariantSystemPrompt,
  buildAiVariantUserPrompt,
  parseAiVariantJson,
  type AiVariantDraft,
} from '@kaoyan408/shared';
import { DeepSeekClient } from '../study/deepseek-client';
import { AiTutorLogRepository } from '../study/ai-tutor-log.repository';
import { QuestionsService } from './questions.service';

// AI 变式题：同知识点变式题生成 -> 教师核对 -> 确认入库（进入审核队列）。
// 未配置 AI_API_KEY 时明确报错，绝不静默回退到假数据。
@Injectable()
export class AiVariantService {
  private readonly logger = new Logger(AiVariantService.name);
  private readonly client: DeepSeekClient | null;

  constructor(
    private readonly questionsService: QuestionsService,
    private readonly logRepository: AiTutorLogRepository,
  ) {
    const apiKey = process.env.AI_API_KEY;
    this.client = apiKey ? new DeepSeekClient({ apiKey }) : null;
  }

  get configured(): boolean {
    return this.client !== null;
  }

  async generate(userId: string, questionId: string, count: number): Promise<{ source: string; items: AiVariantDraft[] }> {
    const question = await this.questionsService.findQuestionById(questionId);
    if (!question) throw new BadRequestException(`Question ${questionId} was not found`);
    if (!this.client) {
      throw new ServiceUnavailableException('AI_API_KEY 未配置，无法生成 AI 变式题（不会静默回退）。');
    }
    const prompt = `${buildAiVariantSystemPrompt()}\n\n${buildAiVariantUserPrompt(question, count)}`;
    try {
      const { content, model } = await this.client.chatCompletions({
        messages: [
          { role: 'system', content: buildAiVariantSystemPrompt() },
          { role: 'user', content: buildAiVariantUserPrompt(question, count) },
        ],
        jsonMode: true,
      });
      await this.logRepository.create({ userId, questionId, prompt, response: content });
      const items = parseAiVariantJson(content);
      if (items.length === 0) {
        throw new ServiceUnavailableException('AI 返回的变式题格式无效，请重试。');
      }
      return { source: model, items };
    } catch (error) {
      await this.logRepository
        .create({
          userId,
          questionId,
          prompt,
          response: `ERROR: ${error instanceof Error ? error.message : String(error)}`,
        })
        .catch(() => undefined);
      throw error;
    }
  }

  async confirm(userId: string, sourceQuestionId: string, draft: AiVariantDraft) {
    const source = await this.questionsService.findQuestionById(sourceQuestionId);
    if (!source) throw new BadRequestException(`Question ${sourceQuestionId} was not found`);
    const question = await this.questionsService.createQuestion({
      stem: draft.stem,
      options: draft.options,
      answer: draft.answer,
      analysis: draft.analysis,
      knowledgePointIds: source.knowledgePointIds,
      difficulty: draft.difficulty,
      type: '选择题',
      source: 'AI 变式题',
      year: new Date().getFullYear(),
      expectedTimeSec: source.expectedTimeSec ?? 100,
    });
    await this.logRepository
      .create({ userId, questionId: sourceQuestionId, prompt: 'confirm-ai-variant', response: JSON.stringify(draft) })
      .catch(() => undefined);
    return question;
  }
}
