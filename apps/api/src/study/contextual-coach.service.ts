import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { AiTutorService } from './ai-tutor.service';
import { ContextualCoachContextAssembler } from './contextual-coach-context-assembler.service';
import { CoachSessionRepository } from './coach-session.repository';
import { appendAndCompress, buildPersonalizedPromptSections, buildSessionBrief, type CoachConversationSession } from './coach-session';
import { LearningMemoryService } from '../agent/learning-memory.service';
import type { ContextualCoachContext, ContextualCoachRequest, ContextualCoachResponse } from './contextual-coach.types';

@Injectable()
export class ContextualCoachService {
  constructor(
    private readonly contextAssembler: ContextualCoachContextAssembler,
    private readonly aiTutorService: AiTutorService,
    // PX-1 productization: session continuity + personalized prompt V2.
    // Both optional so every legacy DI composition stays valid.
    @Optional() private readonly sessionRepository?: CoachSessionRepository,
    @Optional() private readonly learningMemory?: LearningMemoryService,
  ) {}

  async contextualCoach(userId: string, request: ContextualCoachRequest): Promise<ContextualCoachResponse> {
    this.validate(request);
    const context = await this.contextAssembler.assemble(userId, request);

    // Session continuity (short-term memory). Disabled repository → null →
    // stateless single-turn behaviour identical to the pre-PX1 contract.
    const priorSession = await this.loadSession(userId, request.sessionId);

    // Personalized prompt V2 sections (mid/long-term layers via Learning
    // Memory + StudentContext-derived coach context).
    const personalizationSections = await this.buildPersonalization(userId, context);

    const sessionBrief = priorSession ? buildSessionBrief(priorSession) : undefined;
    const result = await this.aiTutorService.contextualCoach(
      userId,
      context,
      request.message,
      sessionBrief,
      personalizationSections,
    );

    let activeSession: CoachConversationSession | null = null;
    if (this.sessionRepository?.enabled) {
      const now = new Date().toISOString();
      const { session } = appendAndCompress(
        priorSession,
        userId,
        request.message ?? '(情境复盘)',
        result.draft.summary,
        now,
      );
      await this.sessionRepository.save(session);
      activeSession = session;
    }

    return {
      contextType: context.context.type,
      contextId: context.context.id,
      ...result.draft,
      source: result.source,
      assembledAt: context.assembledAt,
      ...(result.fallbackReason ? { fallbackReason: result.fallbackReason } : {}),
      ...(activeSession
        ? {
            sessionId: activeSession.sessionId,
            session: {
              summary: activeSession.summary,
              goals: activeSession.goals,
              unresolvedIssues: activeSession.unresolvedIssues,
              compressions: activeSession.compressions,
            },
          }
        : {}),
    };
  }

  private async loadSession(userId: string, sessionId?: string): Promise<CoachConversationSession | null> {
    if (!this.sessionRepository?.enabled) return null;
    const existing = await this.sessionRepository.load(userId);
    if (!existing) return null;
    // Continue only the referenced session; a mismatched/absent sessionId
    // starts a fresh session (old clients never send one → never hijacked).
    if (sessionId && existing.sessionId === sessionId) return existing;
    if (!sessionId) return existing;
    return null;
  }

  private async buildPersonalization(userId: string, context: ContextualCoachContext): Promise<string | undefined> {
    if (!this.learningMemory) return undefined;
    try {
      const memory = await this.learningMemory.getLearningMemory(userId);
      const goal = context.student.goal as { stage?: string | null; weakestSubject?: string | null; targetScore?: number | null };
      const openTaskTitles = (context.currentTasks as Array<{ title?: unknown }> | undefined)
        ?.map((task) => (typeof task.title === 'string' ? task.title : ''))
        .filter(Boolean)
        .slice(0, 3) ?? [];
      const accuracy = memory.longTerm.recentAccuracy.value;
      return buildPersonalizedPromptSections({
        studentProfile: {
          stage: goal.stage,
          weakestSubject: goal.weakestSubject,
          targetScore: goal.targetScore,
        },
        learningMemory: {
          weakTitles: memory.midTerm.weakNodes.slice(0, 2).map((node) => node.title),
          streakDays: memory.longTerm.studyStreak,
        },
        recentBehavior: {
          recentAccuracyPercent: accuracy == null ? null : Math.round(accuracy * 100),
          dueReviews: memory.midTerm.dueCount,
          openTaskTitles,
        },
        currentGoal: null,
      });
    } catch {
      // Personalization is best-effort; the coach keeps working without it.
      return undefined;
    }
  }

  private validate(request: ContextualCoachRequest) {
    if (!request || typeof request !== 'object' || typeof request.contextType !== 'string') {
      throw new BadRequestException('Invalid contextual coach request');
    }
    if ('userId' in request) throw new BadRequestException('userId is not allowed in request body');
    if (request.sessionId !== undefined && typeof request.sessionId !== 'string') {
      throw new BadRequestException('sessionId must be a string');
    }
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