import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
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
  // V12-M2a: exposure is a CLIENT observation of the recommendation surface.
  // It stays telemetry (not a reserved canonical event) because only the client
  // can observe that it rendered something for the student.
  'recommendation.exposed',
  'recommendation.viewed',
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
  'EVIDENCE_RECORDED',
  // V12-M3-A: the exactly-once claim that one piece of review evidence has been
  // projected into authoritative mastery. It is a canonical (server-only) event
  // because it must be attributable and replay-safe: the unique eventKey is what
  // makes "applied exactly once" structural rather than hoped for.
  'REVIEW_MASTERY_APPLIED',
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
  /**
   * V12-M3-A — write inside the caller's transaction. Required when the event
   * must be atomic with the business write it describes (the review→mastery
   * application is committed or rolled back with the review attempt itself).
   */
  tx?: Prisma.TransactionClient;
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

    return this.userEvents.recordCanonical(input.userId, input.type, eventKey, input.payload, input.tx);
  }

  /** Read half of an exactly-once claim; accepts the caller's transaction. */
  async findCanonicalEvent(
    userId: string,
    eventKey: string,
    tx?: Prisma.TransactionClient,
  ): Promise<StoredUserEvent | null> {
    return this.userEvents.findCanonical(userId, eventKey, tx);
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
