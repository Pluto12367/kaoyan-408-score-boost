import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  applyMemoryCardReview,
  buildMemoryCardQueue,
  deriveCardRetention,
  isCardSelfRating,
  MEMORY_CARD_NEW_CARD_CAP,
  MEMORY_CARD_SESSION_CAP,
  resolveCardDensity,
  type CardDensity,
  type CardSelfRating,
  type MemoryCardQueueItem,
} from '@kaoyan408/shared';

/**
 * V14-② — memory-card session + review (task book
 * docs/v14-memory-card-design.md, Owner-approved 2026-09-26).
 *
 * CARD-domain only. Per the approved design §3.2 the three-level
 * self-assessment is self_reported (weak) evidence: it schedules the card via
 * the shared stability/density math and NEVER writes UserKnowledgeMastery,
 * ReviewSchedule or the evidence ledger. The E2E pins that fence with a
 * negative assertion.
 *
 * No in-memory mode: card content cannot be fabricated, so without
 * DATABASE_URL every endpoint refuses explicitly (real-exam precedent).
 */

export interface MemoryCardSessionView {
  userId: string;
  storeAvailable: true;
  examContext: {
    basis: string;
    daysToExam: number;
    isFallback: boolean;
    label: string;
  };
  queue: Array<MemoryCardQueueItem & { nodeName: string | null; subject: string | null }>;
  summary: {
    dueCount: number;
    newCount: number;
    returned: number;
    sessionCap: number;
    newCardCap: number;
  };
}

export interface MemoryCardReviewView {
  replayed: boolean;
  applied: {
    rating: CardSelfRating;
    quality: number;
    stabilityBefore: number | null;
    stabilityAfter: number | null;
    densityFactor: number;
    densityBasis: string;
    intervalDays: number;
    nextReviewAt: string | null;
  };
  state: {
    stabilityDays: number | null;
    nextReviewAt: string | null;
    retention: number | null;
    reviewCount: number;
  };
}

const MAX_STATES = 500;

@Injectable()
export class MemoryCardService {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  get enabled(): boolean {
    return Boolean(process.env.DATABASE_URL && this.prisma);
  }

  private requireStore(): PrismaService {
    if (!this.enabled) {
      throw new ServiceUnavailableException('记忆卡功能需要连接数据库（store_unavailable）：卡片内容不可在无库模式下伪造。');
    }
    return this.prisma!;
  }

  async getSession(userId: string, input: { limit?: number } = {}, now: Date = new Date()): Promise<MemoryCardSessionView> {
    const prisma = this.requireStore();
    const requested = Math.trunc(input.limit ?? MEMORY_CARD_SESSION_CAP);
    const sessionCap = Number.isFinite(requested) && requested > 0
      ? Math.min(50, requested)
      : MEMORY_CARD_SESSION_CAP;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { examDate: true, remainingDays: true },
    });
    const density = resolveCardDensity({ examDate: user?.examDate ?? null, remainingDays: user?.remainingDays ?? null, now });

    // Bounded reads: due states (schedule-driven), then the first new cards.
    const states = await prisma.userMemoryCardState.findMany({
      where: { userId, nextReviewAt: { lte: now }, card: { isActive: true } },
      include: { card: { include: { knowledgeNode: { select: { name: true, subject: true } } } } },
      orderBy: [{ nextReviewAt: 'asc' }],
      take: MAX_STATES,
    });
    const newCards = await prisma.memoryCard.findMany({
      where: { isActive: true, userStates: { none: { userId } } },
      include: { knowledgeNode: { select: { name: true, subject: true } } },
      orderBy: [{ knowledgeNodeId: 'asc' }, { id: 'asc' }],
      take: MEMORY_CARD_NEW_CARD_CAP,
    });

    const nodeMeta = new Map<string, { nodeName: string | null; subject: string | null }>();
    for (const state of states) {
      nodeMeta.set(state.cardId, {
        nodeName: state.card.knowledgeNode?.name ?? null,
        subject: state.card.knowledgeNode?.subject ?? null,
      });
    }
    for (const card of newCards) {
      nodeMeta.set(card.id, {
        nodeName: card.knowledgeNode?.name ?? null,
        subject: card.knowledgeNode?.subject ?? null,
      });
    }

    const result = buildMemoryCardQueue({
      cards: [
        ...states.map((state) => ({
          cardId: state.cardId,
          knowledgeNodeId: state.card.knowledgeNodeId,
          cardType: state.card.cardType,
          front: state.card.front,
          back: state.card.back,
          state: {
            stabilityDays: state.stabilityDays,
            lastReviewedAt: state.lastReviewedAt?.toISOString() ?? null,
            nextReviewAt: state.nextReviewAt?.toISOString() ?? null,
          },
        })),
        ...newCards.map((card) => ({
          cardId: card.id,
          knowledgeNodeId: card.knowledgeNodeId,
          cardType: card.cardType,
          front: card.front,
          back: card.back,
          state: null,
        })),
      ],
      now,
      sessionCap,
      newCardCap: MEMORY_CARD_NEW_CARD_CAP,
    });

    return {
      userId,
      storeAvailable: true,
      examContext: {
        basis: density.basis,
        daysToExam: density.daysToExam,
        isFallback: density.isFallback,
        label: density.contextLabel,
      },
      queue: result.queue.map((item) => ({
        ...item,
        ...(nodeMeta.get(item.cardId) ?? { nodeName: null, subject: null }),
      })),
      summary: { ...result.summary, sessionCap, newCardCap: MEMORY_CARD_NEW_CARD_CAP },
    };
  }

  async reviewCard(
    userId: string,
    cardId: string,
    input: { rating: string; idempotencyKey: string },
    now: Date = new Date(),
  ): Promise<MemoryCardReviewView> {
    const prisma = this.requireStore();
    if (!isCardSelfRating(input.rating)) {
      throw new BadRequestException('rating 必须是 remembered | fuzzy | forgot（记住/模糊/没记住）。');
    }
    if (!input.idempotencyKey || typeof input.idempotencyKey !== 'string') {
      throw new BadRequestException('缺少 idempotencyKey。');
    }
    const rating: CardSelfRating = input.rating;

    // Idempotent replay: the first application's stored log row reconstructs
    // the original response; a key reused on another target is refused.
    const existing = await prisma.memoryCardReviewLog.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      if (existing.userId !== userId || existing.cardId !== cardId) {
        throw new ConflictException('idempotencyKey 已被其他卡片或用户的评审占用。');
      }
      const state = await prisma.userMemoryCardState.findUnique({
        where: { userId_cardId: { userId, cardId } },
      });
      return {
        replayed: true,
        applied: {
          rating,
          quality: existing.rating,
          stabilityBefore: existing.stabilityBefore,
          stabilityAfter: existing.stabilityAfter,
          densityFactor: existing.densityFactor,
          densityBasis: existing.densityBasis,
          intervalDays: state?.nextReviewAt && state?.lastReviewedAt
            ? Math.max(0, (state.nextReviewAt.getTime() - state.lastReviewedAt.getTime()) / 86_400_000)
            : 0,
          nextReviewAt: state?.nextReviewAt?.toISOString() ?? null,
        },
        state: {
          stabilityDays: state?.stabilityDays ?? null,
          nextReviewAt: state?.nextReviewAt?.toISOString() ?? null,
          retention: state?.lastReviewedAt
            ? deriveCardRetention(
              { lastReviewedAt: state.lastReviewedAt.toISOString(), stabilityDays: state.stabilityDays ?? null },
              now,
            )
            : null,
          reviewCount: state?.reviewCount ?? 0,
        },
      };
    }

    const card = await prisma.memoryCard.findFirst({ where: { id: cardId, isActive: true } });
    if (!card) throw new NotFoundException('卡片不存在或未启用。');

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { examDate: true, remainingDays: true } });
    const density = resolveCardDensity({ examDate: user?.examDate ?? null, remainingDays: user?.remainingDays ?? null, now });

    const result = await prisma.$transaction(async (tx) => {
      let state = await tx.userMemoryCardState.findUnique({
        where: { userId_cardId: { userId, cardId } },
      });
      const applied = applyMemoryCardReview(
        { state: { stabilityDays: state?.stabilityDays ?? null }, rating, density, reviewedAt: now },
      );
      if (state) {
        state = await tx.userMemoryCardState.update({
          where: { id: state.id },
          data: {
            stabilityDays: applied.stabilityAfter,
            lastReviewedAt: now,
            nextReviewAt: applied.nextReviewAt,
            lastRating: applied.quality,
            reviewCount: { increment: 1 },
            version: { increment: 1 },
          },
        });
      } else {
        state = await tx.userMemoryCardState.create({
          data: {
            userId,
            cardId,
            stabilityDays: applied.stabilityAfter,
            lastReviewedAt: now,
            nextReviewAt: applied.nextReviewAt,
            lastRating: applied.quality,
            reviewCount: 1,
          },
        });
      }
      await tx.memoryCardReviewLog.create({
        data: {
          userId,
          cardId,
          rating: applied.quality,
          stabilityBefore: applied.stabilityBefore,
          stabilityAfter: applied.stabilityAfter,
          densityFactor: applied.densityFactor,
          densityBasis: applied.densityBasis,
          reviewedAt: now,
          idempotencyKey: input.idempotencyKey,
        },
      });
      return { applied, reviewCount: state.reviewCount };
    });

    return {
      replayed: false,
      applied: {
        rating,
        quality: result.applied.quality,
        stabilityBefore: result.applied.stabilityBefore,
        stabilityAfter: result.applied.stabilityAfter,
        densityFactor: result.applied.densityFactor,
        densityBasis: result.applied.densityBasis,
        intervalDays: result.applied.intervalDays,
        nextReviewAt: result.applied.nextReviewAt.toISOString(),
      },
      state: {
        stabilityDays: result.applied.stabilityAfter,
        nextReviewAt: result.applied.nextReviewAt.toISOString(),
        retention: deriveCardRetention(
          { lastReviewedAt: now.toISOString(), stabilityDays: result.applied.stabilityAfter },
          now,
        ),
        reviewCount: result.reviewCount,
      },
    };
  }
}
