import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RecommendationActionRepository, type ActionStatus, type RecommendationActionRow } from './recommendation-action.repository';

export class ActionDomainError extends Error { constructor(public readonly code: string, message = code) { super(message); this.name = 'ActionDomainError'; } }
export type CreateRecommendationActionCommand = { userId: string; actionType: 'PRACTICE' | 'REVIEW'; targetType: 'KNOWLEDGE_NODE' | 'KNOWLEDGE_POINT' | 'QUESTION'; targetId: string; reason: string; evidenceRefs: Prisma.InputJsonValue; creationKey: string; studyTaskId?: string | null };
export type ActionMutationCommand = { userId: string; actionId: string; expectedVersion: number };

@Injectable()
export class RecommendationActionService {
  constructor(private readonly repository: RecommendationActionRepository) {}

  async createAction(input: CreateRecommendationActionCommand): Promise<RecommendationActionRow> {
    if (!input.userId || !input.targetId || !input.reason || !input.creationKey || !['PRACTICE', 'REVIEW'].includes(input.actionType) || !['KNOWLEDGE_NODE', 'KNOWLEDGE_POINT', 'QUESTION'].includes(input.targetType)) throw new ActionDomainError('ACTION_INVALID_TRANSITION', 'Invalid action contract');
    const existing = await this.repository.findByCreationKey(input.userId, input.creationKey); if (existing) return existing;
    try { return await this.repository.create(input); } catch (error) { if ((error as { code?: string })?.code === 'P2002') { const retry = await this.repository.findByCreationKey(input.userId, input.creationKey); if (retry) return retry; } throw error; }
  }
  async getAction(userId: string, actionId: string): Promise<RecommendationActionRow> { const row = await this.repository.findById(actionId); if (!row) throw new ActionDomainError('ACTION_NOT_FOUND'); if (row.userId !== userId) throw new ActionDomainError('ACTION_FORBIDDEN'); return row; }
  private async transition(input: ActionMutationCommand, from: ActionStatus, to: ActionStatus, field?: 'startedAt' | 'completedAt' | 'cancelledAt'): Promise<RecommendationActionRow> {
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) throw new ActionDomainError('ACTION_VERSION_CONFLICT', 'expectedVersion is required');
    const current = await this.getAction(input.userId, input.actionId); if (current.status !== from) throw new ActionDomainError('ACTION_INVALID_TRANSITION');
    const data = field ? { status: to, [field]: new Date() } : { status: to };
    const updated = await this.repository.updateStatusWithVersion({ id: input.actionId, userId: input.userId, expectedVersion: input.expectedVersion, expectedStatus: from, data });
    if (!updated) throw new ActionDomainError('ACTION_VERSION_CONFLICT'); return updated;
  }
  startAction(input: ActionMutationCommand) { return this.transition(input, 'CREATED', 'STARTED', 'startedAt'); }
  completeAction(input: ActionMutationCommand) { return this.transition(input, 'STARTED', 'COMPLETED', 'completedAt'); }
  cancelAction(input: ActionMutationCommand) { return this.transition(input, input.expectedVersion >= 0 ? 'CREATED' : 'CREATED', 'CANCELLED', 'cancelledAt').catch(async (e) => { if (e.code !== 'ACTION_INVALID_TRANSITION') throw e; return this.transition(input, 'STARTED', 'CANCELLED', 'cancelledAt'); }); }
  expireAction(input: ActionMutationCommand) { return this.transition(input, 'CREATED', 'EXPIRED'); }
}

export function toHttpActionError(error: unknown): Error {
  if (!(error instanceof ActionDomainError)) return error as Error;
  if (error.code === 'ACTION_NOT_FOUND') return new NotFoundException(error.code);
  if (error.code === 'ACTION_FORBIDDEN') return new ForbiddenException(error.code);
  if (error.code === 'ACTION_VERSION_CONFLICT' || error.code === 'ACTION_INVALID_TRANSITION' || error.code === 'ACTION_CREATION_DUPLICATE') return new ConflictException(error.code);
  return error;
}
