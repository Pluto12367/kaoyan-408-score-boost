import { Injectable } from '@nestjs/common';
import type { ActionLearningSignalDTO } from './action-learning-signal.service';
import type { RecommendationActionRow } from './recommendation-action.repository';

export const USER_ACTION_FEEDBACK_EVENT = 'USER_ACTION_FEEDBACK' as const;

export type StudentStateFeedbackSignalType =
  | 'POSITIVE_FEEDBACK'
  | 'PARTIAL_FEEDBACK'
  | 'NEGATIVE_FEEDBACK'
  | 'NO_FEEDBACK';

export type StudentStateFeedbackEvent = {
  id: string;
  userId: string;
  actionId: string;
  actionType: string;
  targetType: string;
  targetId: string;
  signalType: StudentStateFeedbackSignalType;
  confidence: number;
  evidenceRefs: string[];
  occurredAt: string;
};

export type StudentStateFeedbackAction = Pick<
  RecommendationActionRow,
  'id' | 'userId' | 'actionType' | 'targetType' | 'targetId' | 'createdAt' | 'updatedAt' | 'startedAt' | 'completedAt' | 'cancelledAt'
>;

export class StudentStateFeedbackError extends Error {
  constructor(public readonly code: 'ACTION_FORBIDDEN' | 'ACTION_FEEDBACK_IDENTITY_CONFLICT' | 'ACTION_FEEDBACK_SIGNAL_MISMATCH', message = code) {
    super(message);
    this.name = 'StudentStateFeedbackError';
  }
}

export function mapOutcomeToFeedback(outcomeStatus: ActionLearningSignalDTO['outcomeStatus']): StudentStateFeedbackSignalType {
  if (outcomeStatus === 'SUCCESS') return 'POSITIVE_FEEDBACK';
  if (outcomeStatus === 'PARTIAL') return 'PARTIAL_FEEDBACK';
  if (outcomeStatus === 'FAILED') return 'NEGATIVE_FEEDBACK';
  return 'NO_FEEDBACK';
}

export function feedbackDedupeKey(event: Pick<StudentStateFeedbackEvent, 'userId' | 'actionId' | 'signalType'>): string {
  return `${USER_ACTION_FEEDBACK_EVENT}:${event.userId}:${event.actionId}:${event.signalType}`;
}

@Injectable()
export class StudentStateFeedbackAdapter {
  toEvent(input: {
    userId: string;
    action: StudentStateFeedbackAction;
    signal: ActionLearningSignalDTO;
  }): StudentStateFeedbackEvent {
    const { userId, action, signal } = input;
    if (action.userId !== userId) throw new StudentStateFeedbackError('ACTION_FORBIDDEN');
    if (signal.actionId !== action.id) throw new StudentStateFeedbackError('ACTION_FEEDBACK_SIGNAL_MISMATCH');
    if (action.id === action.targetId) throw new StudentStateFeedbackError('ACTION_FEEDBACK_IDENTITY_CONFLICT');

    const signalType = mapOutcomeToFeedback(signal.outcomeStatus);
    return {
      id: `student-state-feedback:${action.id}:${signalType}`,
      userId,
      actionId: action.id,
      actionType: action.actionType,
      targetType: action.targetType,
      targetId: action.targetId,
      signalType,
      confidence: signal.confidence,
      evidenceRefs: [...signal.evidenceRefs],
      occurredAt: toIso(signal.lastOutcomeAt ?? action.completedAt ?? action.cancelledAt ?? action.updatedAt ?? action.createdAt ?? signal.generatedAt),
    };
  }
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
