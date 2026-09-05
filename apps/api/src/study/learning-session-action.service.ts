import { Inject, Injectable } from '@nestjs/common';
import { ActionDomainError, RecommendationActionService } from './recommendation-action.service';
import { LearningSessionRepository, type PersistedLearningSession } from './learning-session.repository';

export type CreateLearningSessionFromActionCommand = { userId: string; actionId: string; resourceId: string; metadata?: Record<string, unknown> };

@Injectable()
export class LearningSessionActionService {
  constructor(
    private readonly actions: RecommendationActionService,
    @Inject(LearningSessionRepository) private readonly sessions: { findByActionId(actionId: string, userId: string): Promise<PersistedLearningSession | null>; createFromAction?(session: PersistedLearningSession): Promise<PersistedLearningSession>; save(session: PersistedLearningSession): Promise<void> },
  ) {}

  async createLearningSessionFromAction(input: CreateLearningSessionFromActionCommand): Promise<PersistedLearningSession> {
    const action = await this.actions.getAction(input.userId, input.actionId);
    if (action.status !== 'CREATED' && action.status !== 'STARTED') throw new ActionDomainError('ACTION_INVALID_TRANSITION');
    const existing = await this.sessions.findByActionId(input.actionId, input.userId);
    if (existing) return existing;
    const now = new Date().toISOString();
    const session: PersistedLearningSession = {
      id: `session-action-${input.actionId}`,
      userId: input.userId,
      actionId: input.actionId,
      type: 'practice_set',
      resourceId: input.resourceId,
      questionIds: action.targetType === 'QUESTION' ? [action.targetId] : [],
      questionSnapshot: [], answers: {}, markedQuestions: [], currentIndex: 0, revision: 0,
      startedAt: now, lastActiveAt: now, totalActiveMs: 0, lastResumeAt: Date.now(), completed: false,
    };
    try {
      if (this.sessions.createFromAction) return await this.sessions.createFromAction(session);
      await this.sessions.save(session);
    } catch (error) {
      const retry = await this.sessions.findByActionId(input.actionId, input.userId);
      if (retry) return retry;
      throw error;
    }
    return session;
  }
}
