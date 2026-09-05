import { Injectable } from '@nestjs/common';
import { ActionLearningSignalService } from './action-learning-signal.service';

export type RecommendationFeedbackDTO = {
  actionId: string;
  success: boolean;
  confidence: number;
  outcomeCount: number;
  lastOutcomeAt?: Date;
  feedbackType: 'SUCCESSFUL_ACTION' | 'PARTIAL_ACTION' | 'FAILED_ACTION' | 'NO_SIGNAL';
};

@Injectable()
export class RecommendationFeedbackService {
  constructor(private readonly signals: ActionLearningSignalService) {}

  async getFeedback(userId: string, actionId: string): Promise<RecommendationFeedbackDTO> {
    const signal = await this.signals.buildSignal(userId, actionId);
    const feedbackType: RecommendationFeedbackDTO['feedbackType'] = signal.outcomeStatus === 'SUCCESS'
      ? 'SUCCESSFUL_ACTION' : signal.outcomeStatus === 'PARTIAL' ? 'PARTIAL_ACTION' : signal.outcomeStatus === 'FAILED' ? 'FAILED_ACTION' : 'NO_SIGNAL';
    return {
      actionId,
      success: signal.outcomeStatus === 'SUCCESS',
      confidence: signal.confidence,
      outcomeCount: signal.evidenceRefs.length,
      ...(signal.lastOutcomeAt ? { lastOutcomeAt: signal.lastOutcomeAt } : {}),
      feedbackType,
    };
  }
}
