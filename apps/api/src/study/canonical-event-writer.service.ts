import { BadRequestException, Injectable } from '@nestjs/common';
import { UserEventRepository, type StoredUserEvent } from './user-event.repository';

export const TELEMETRY_EVENT_TYPES = [
  'page.view',
  'button.click',
  'ui.interaction',
  'client.error',
  'practice.set_start',
  'practice.set_restart',
  'practice.bank_restart',
  'practice.learning_mode_start',
  'task.start',
  'task.manual_complete',
  'task.postpone',
  'task.reschedule',
  'task.rebalance',
  'wrong.open_review',
  'quest.start',
  'quest.complete',
  'assessment.generate',
  'tutor.ask',
  'sprite.interact',
] as const;

export const RESERVED_CANONICAL_EVENT_TYPES = [
  'USER_ACTION_FEEDBACK',
  'plan.generated',
  'practice.submit',
  'task.complete',
  'session.submit',
  'wrong.review',
  'assessment.import',
  'ACTION_COMPLETED',
  'PRACTICE_ATTRIBUTED',
  'REVIEW_ATTRIBUTED',
  'recommendation.created',
  'recommendation.accepted',
  'recommendation.completed',
  'recommendation.failed',
  'learning.insight.created',
  'knowledge.gap.detected',
  'study.strategy.updated',
] as const;

export type CanonicalEventType = (typeof RESERVED_CANONICAL_EVENT_TYPES)[number];

export function isTelemetryEventType(type: string): boolean {
  return (TELEMETRY_EVENT_TYPES as readonly string[]).includes(type);
}

export function isReservedCanonicalEventType(type: string): boolean {
  return (RESERVED_CANONICAL_EVENT_TYPES as readonly string[]).includes(type);
}

export type CanonicalEventInput = {
  userId: string;
  type: CanonicalEventType;
  eventKey?: string;
  payload?: Record<string, unknown>;
};

@Injectable()
export class CanonicalEventWriterService {
  constructor(private readonly userEvents: UserEventRepository) {}

  async recordCanonicalEvent(input: CanonicalEventInput): Promise<StoredUserEvent | null> {
    if (!isReservedCanonicalEventType(input.type)) {
      throw new BadRequestException(`Unsupported canonical event type: ${input.type}`);
    }

    const eventKey = input.eventKey?.trim() || deriveEventKey(input);
    if (!eventKey) {
      throw new BadRequestException(`Canonical event ${input.type} requires an eventKey`);
    }

    return this.userEvents.recordCanonical(input.userId, input.type, eventKey, input.payload);
  }
}

function deriveEventKey(input: CanonicalEventInput): string | undefined {
  if (!input.payload) return undefined;
  if (input.type === 'USER_ACTION_FEEDBACK') {
    const actionId = input.payload.actionId;
    const signalType = input.payload.signalType;
    if (typeof actionId === 'string' && typeof signalType === 'string') {
      return `USER_ACTION_FEEDBACK:${input.userId}:${actionId}:${signalType}`;
    }
  }
  if (input.type === 'plan.generated') {
    const generationKey = input.payload.generationKey;
    if (typeof generationKey === 'string') return `PLAN_GENERATED:${generationKey}`;
    const triggerKey = input.payload.triggerKey;
    if (typeof triggerKey === 'string') return `PLAN_GENERATED:${input.userId}:${triggerKey}`;
  }
  return undefined;
}
