import { Injectable } from '@nestjs/common';
import { RecommendationActionService } from './recommendation-action.service';
import { ActionOutcomeAuditService, type ActionOutcomeAuditDTO } from './action-outcome-audit.service';

export type ActionLearningSignalDTO = {
  actionId: string;
  outcomeStatus: 'NO_OUTCOME' | 'SUCCESS' | 'PARTIAL' | 'FAILED';
  signalType: 'PRACTICE_COMPLETED' | 'REVIEW_COMPLETED' | 'ACTION_EXPIRED' | 'ACTION_CANCELLED';
  confidence: number;
  evidenceRefs: string[];
  lastOutcomeAt?: Date;
  generatedAt: Date;
};

@Injectable()
export class ActionLearningSignalService {
  constructor(private readonly actions: RecommendationActionService, private readonly audits: ActionOutcomeAuditService) {}

  async buildSignal(userId: string, actionId: string): Promise<ActionLearningSignalDTO> {
    const action = await this.actions.getAction(userId, actionId);
    const audit = await this.audits.buildOutcome(userId, actionId);
    const hasOutcome = audit.practiceCount > 0 || audit.reviewAttemptCount > 0;
    const outcomeStatus: ActionLearningSignalDTO['outcomeStatus'] = action.status === 'CANCELLED' || action.status === 'EXPIRED'
      ? 'FAILED' : action.status === 'COMPLETED' && hasOutcome ? 'SUCCESS' : hasOutcome ? 'PARTIAL' : 'NO_OUTCOME';
    const signalType: ActionLearningSignalDTO['signalType'] = action.status === 'EXPIRED'
      ? 'ACTION_EXPIRED' : action.status === 'CANCELLED' ? 'ACTION_CANCELLED' : action.actionType === 'PRACTICE' ? 'PRACTICE_COMPLETED' : 'REVIEW_COMPLETED';
    const confidence = outcomeStatus === 'SUCCESS' ? 1 : outcomeStatus === 'PARTIAL' ? 0.5 : outcomeStatus === 'FAILED' ? 0.2 : 0;
    return { actionId, outcomeStatus, signalType, confidence, evidenceRefs: audit.evidenceRefs, lastOutcomeAt: audit.lastOutcomeAt, generatedAt: new Date() };
  }
}
