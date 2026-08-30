import { BadRequestException, Injectable } from '@nestjs/common';
import { AiTutorService } from './ai-tutor.service';
import { ContextualCoachContextAssembler } from './contextual-coach-context-assembler.service';
import type { ContextualCoachRequest, ContextualCoachResponse } from './contextual-coach.types';

@Injectable()
export class ContextualCoachService {
  constructor(
    private readonly contextAssembler: ContextualCoachContextAssembler,
    private readonly aiTutorService: AiTutorService,
  ) {}

  async contextualCoach(userId: string, request: ContextualCoachRequest): Promise<ContextualCoachResponse> {
    this.validate(request);
    const context = await this.contextAssembler.assemble(userId, request);
    const result = await this.aiTutorService.contextualCoach(userId, context, request.message);
    return {
      contextType: context.context.type,
      contextId: context.context.id,
      ...result.draft,
      source: result.source,
      assembledAt: context.assembledAt,
      ...(result.fallbackReason ? { fallbackReason: result.fallbackReason } : {}),
    };
  }

  private validate(request: ContextualCoachRequest) {
    if (!request || typeof request !== 'object' || typeof request.contextType !== 'string') {
      throw new BadRequestException('Invalid contextual coach request');
    }
    if ('userId' in request) throw new BadRequestException('userId is not allowed in request body');
    if (request.contextType === 'question' || request.contextType === 'wrong_question') {
      if (!request.questionId?.trim()) throw new BadRequestException('questionId is required');
    } else if (request.contextType === 'knowledge_node') {
      if (!request.knowledgeNodeId?.trim()) throw new BadRequestException('knowledgeNodeId is required');
    } else if (request.contextType === 'assessment') {
      if (request.assessmentId !== undefined && !request.assessmentId.trim()) throw new BadRequestException('assessmentId must not be empty');
    } else {
      throw new BadRequestException('Unsupported contextType');
    }
  }
}
