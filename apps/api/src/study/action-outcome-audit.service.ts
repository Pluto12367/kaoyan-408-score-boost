import { Injectable } from '@nestjs/common';
import { ActionDomainError, RecommendationActionService } from './recommendation-action.service';
import { ActionOutcomeAuditRepository, type ActionOutcomeFacts } from './action-outcome-audit.repository';

export type ActionOutcomeAuditStatus = 'NO_OUTCOME' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
export type ActionOutcomeAuditDTO = {
  actionId: string;
  status: ActionOutcomeAuditStatus;
  practiceCount: number;
  reviewAttemptCount: number;
  firstOutcomeAt?: Date;
  lastOutcomeAt?: Date;
  evidenceRefs: string[];
};

@Injectable()
export class ActionOutcomeAuditService {
  constructor(private readonly actions: RecommendationActionService, private readonly repository: ActionOutcomeAuditRepository) {}

  async buildOutcome(userId: string, actionId: string): Promise<ActionOutcomeAuditDTO> {
    const action = await this.actions.getAction(userId, actionId);
    const facts = await this.repository.aggregate(actionId, userId);
    const outcomes = [...facts.practice.map((x) => ({ id: x.id, at: x.submittedAt, evidence: `practice-record:${x.id}` })), ...facts.reviews.map((x) => ({ id: x.id, at: x.reviewedAt, evidence: `review-attempt:${x.id}` }))].sort((a, b) => a.at.getTime() - b.at.getTime());
    const hasOutcome = outcomes.length > 0;
    const status: ActionOutcomeAuditStatus = action.status === 'CANCELLED' || action.status === 'EXPIRED'
      ? 'FAILED'
      : action.status === 'COMPLETED' && hasOutcome
        ? 'COMPLETED'
        : action.status === 'CREATED' && !hasOutcome
          ? 'NO_OUTCOME'
          : 'IN_PROGRESS';
    return { actionId, status, practiceCount: facts.practice.length, reviewAttemptCount: facts.reviews.length, ...(hasOutcome ? { firstOutcomeAt: outcomes[0].at, lastOutcomeAt: outcomes[outcomes.length - 1].at } : {}), evidenceRefs: outcomes.map((x) => x.evidence) };
  }
}
