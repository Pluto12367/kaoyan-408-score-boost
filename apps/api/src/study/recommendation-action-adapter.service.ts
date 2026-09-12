import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { createRecommendationActionKey } from './action-creation-key';

export type RecommendationActionDraft = {
  userId: string;
  scheduledDate: string;
  generationKey?: string;
  actionType: string;
  targetType: 'KNOWLEDGE_NODE' | 'KNOWLEDGE_POINT' | 'QUESTION';
  targetId: string;
  reason: string;
  evidenceRefs: Prisma.InputJsonValue;
};

@Injectable()
export class RecommendationActionAdapterService {
  constructor(private readonly prisma: PrismaService) {}

  static creationKey(input: RecommendationActionDraft) {
    return `${input.userId}:${input.scheduledDate}:${input.actionType}:${input.targetType}:${input.targetId}`;
  }

  private delegate(db: PrismaService | Prisma.TransactionClient) {
    return (db as PrismaService & { recommendationAction: any }).recommendationAction;
  }

  async createOrGetAction(input: RecommendationActionDraft, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    if (!process.env.DATABASE_URL && !tx) return null;
    // S2: TRANSFER_PROBE is a first-class action type (formal design) and must
    // pass through unchanged; the legacy coercion below only normalizes the
    // recommendation engine's own action vocabulary.
    const actionType = input.actionType === 'TRANSFER_PROBE'
      ? 'TRANSFER_PROBE'
      : input.actionType === 'REVIEW' || input.actionType === 'WRONG_QUESTION'
        ? 'REVIEW'
        : 'PRACTICE';
    const creationKey = input.generationKey !== undefined
      ? createRecommendationActionKey(input.generationKey, input.actionType, input.targetType, input.targetId)
      : RecommendationActionAdapterService.creationKey(input);
    try {
      return await this.delegate(db).upsert({
        where: { userId_creationKey: { userId: input.userId, creationKey } },
        create: { userId: input.userId, actionType, targetType: input.targetType, targetId: input.targetId, reason: input.reason || 'recommendation', evidenceRefs: input.evidenceRefs, creationKey, status: 'CREATED', version: 0 },
        update: {},
      });
    } catch (error) {
      // PostgreSQL can surface a unique-race from concurrent upserts. A read
      // retry converts that race into the same idempotent result.
      if ((error as { code?: string })?.code === 'P2002') {
        const retry = await this.delegate(db).findUnique({ where: { userId_creationKey: { userId: input.userId, creationKey } } });
        if (retry) return retry;
      }
      throw error;
    }
  }

  async bindStudyTask(actionId: string, studyTaskId: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    if (!process.env.DATABASE_URL && !tx) return false;
    const result = await this.delegate(db).updateMany({ where: { id: actionId, studyTaskId: null }, data: { studyTaskId } });
    if (result.count === 1) return true;
    const current = await this.delegate(db).findUnique({ where: { id: actionId }, select: { studyTaskId: true } });
    return current?.studyTaskId === studyTaskId;
  }

  /**
   * Returns the already materialized plan when every action in a recommendation
   * batch is bound to the same task plan. This is the read side of the
   * (userId, creationKey) idempotency boundary and avoids creating duplicate
   * StudyTask rows on a retried daily-plan request.
   */
  async findBoundPlan(actionIds: string[], userId: string, tx?: Prisma.TransactionClient) {
    if (actionIds.length === 0) return null;
    const db = tx ?? this.prisma;
    if (!process.env.DATABASE_URL && !tx) return null;
    const actions = await this.delegate(db).findMany({
      where: { id: { in: actionIds }, userId },
      select: {
        id: true,
        studyTaskId: true,
        studyTask: {
          select: {
            planId: true,
            plan: {
              include: {
                tasks: {
                  orderBy: { generatedRank: 'asc' },
                  include: { action: { select: { id: true } } },
                },
              },
            },
          },
        },
      },
    });
    if (actions.length !== actionIds.length || actions.some((action: any) => !action.studyTask?.plan)) return null;
    const planIds = new Set(actions.map((action: any) => action.studyTask.planId));
    if (planIds.size !== 1) return null;
    return actions[0].studyTask.plan;
  }
}
