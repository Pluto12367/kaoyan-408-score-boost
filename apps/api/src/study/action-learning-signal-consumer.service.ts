import { Injectable } from '@nestjs/common';
import { ActionLearningSignalService, type ActionLearningSignalDTO } from './action-learning-signal.service';
import { RecommendationActionService } from './recommendation-action.service';
import {
  StudentStateFeedbackAdapter,
  feedbackDedupeKey,
  type StudentStateFeedbackAction,
  type StudentStateFeedbackEvent,
} from './student-state-feedback.adapter';
import { StudentStateFeedbackRepository, type StoredStudentStateFeedback } from './student-state-feedback.repository';

export type StudentStateFeedbackInput = {
  userId: string;
  action: StudentStateFeedbackAction;
  signal: ActionLearningSignalDTO;
};

export type StudentStateFeedbackConsumeResult = {
  status: 'created' | 'existing' | 'disabled';
  dedupeKey: string;
  event: StudentStateFeedbackEvent | null;
  record: StoredStudentStateFeedback | null;
};

@Injectable()
export class ActionLearningSignalConsumerService {
  constructor(
    private readonly adapter: StudentStateFeedbackAdapter,
    private readonly repository: StudentStateFeedbackRepository,
    private readonly signals?: ActionLearningSignalService,
    private readonly actions?: RecommendationActionService,
  ) {}

  async consume(input: StudentStateFeedbackInput): Promise<StudentStateFeedbackConsumeResult> {
    const event = this.adapter.toEvent(input);
    const persisted = await this.repository.createIfAbsent(event);
    return {
      status: persisted ? (persisted.created ? 'created' : 'existing') : 'disabled',
      dedupeKey: feedbackDedupeKey(event),
      event: persisted?.record.payload ?? null,
      record: persisted?.record ?? null,
    };
  }

  async consumeAction(userId: string, actionId: string): Promise<StudentStateFeedbackConsumeResult> {
    if (!this.actions || !this.signals) throw new Error('ActionLearningSignalConsumerService is missing signal dependencies');
    const action = await this.actions.getAction(userId, actionId);
    const signal = await this.signals.buildSignal(userId, actionId);
    return this.consume({ userId, action, signal });
  }
}
