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
import { loadRelatedQuestionsForNode } from '../score-center/repository';

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

/** White-listed candidate shape — answer/analysis/options must never leak (task book §3.2). */
export interface MemoryCardPracticeCandidate {
  nodeId: string;
  candidate: {
    questionId: string;
    stem: string;
    questionType: string;
    difficulty: string;
    maxScore: number | null;
  } | null;
  reason: 'ok' | 'no_related_question' | 'no_single_choice';
}

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

  /**
   * S2 卡片→做题回流 (task book docs/v14-memory-card-slice2-design.md §3.2).
   * Read-only candidate for the card surface's "practice one question" entry:
   * the FIRST SINGLE_CHOICE question tagged to the node (deterministic
   * createdAt order). The picked question is then answered through the
   * EXISTING practice chain — this endpoint itself never writes anything and
   * its response is white-listed (no answer/analysis/options).
   */
  async getPracticeCandidate(userId: string, nodeId: string): Promise<MemoryCardPracticeCandidate> {
    const prisma = this.requireStore();
    const trimmed = nodeId?.trim();
    if (!trimmed) throw new BadRequestException('缺少 nodeId。');
    const node = await prisma.knowledgeNode.findFirst({ where: { id: trimmed, isActive: true }, select: { id: true } });
    if (!node) throw new NotFoundException('知识节点不存在或未启用。');

    const related = await loadRelatedQuestionsForNode(prisma, trimmed);
    const singleChoice = related.find((question) => question.type === 'SINGLE_CHOICE');
    if (!singleChoice) {
      return {
        nodeId: trimmed,
        candidate: null,
        reason: related.length > 0 ? 'no_single_choice' : 'no_related_question',
      };
    }
    const priced = await prisma.question.findUnique({
      where: { id: singleChoice.id },
      select: { maxScore: true },
    });
    return {
      nodeId: trimmed,
      candidate: {
        questionId: singleChoice.id,
        stem: singleChoice.stem,
        questionType: singleChoice.type,
        difficulty: singleChoice.difficulty,
        maxScore: priced?.maxScore ?? null,
      },
      reason: 'ok',
    };
  }

  /**
   * Read-only due-card count for the daily brief (roadmap §2 今日动线).
   * Null when the store is unavailable — the brief omits the line entirely
   * rather than showing a fabricated zero (RULE-06 parity).
   */
  async getDueCount(userId: string, now: Date = new Date()): Promise<number | null> {
    if (!this.enabled) return null;
    return this.prisma!.userMemoryCardState.count({
      where: { userId, nextReviewAt: { lte: now }, card: { isActive: true } },
    });
  }

  // -------------------------------------------------------------------------
  // Admin management surface (task book docs/v14-memory-card-admin-design.md,
  // D-M-1/2/3 approved 2026-09-26). Content mutability comes WITH the RULE-10
  // chain: every create/rewrite stamps reviewedBy + rightsConfirmed.
  // -------------------------------------------------------------------------

  async listCardsAdmin(
    input: { nodeId?: string; includeRetired?: boolean; take?: number } = {},
  ): Promise<{
    storeAvailable: true;
    cards: Array<{
      id: string; knowledgeNodeId: string; nodeName: string | null; cardType: string;
      front: string; back: string; reviewedBy: string | null; rightsConfirmed: boolean | null;
      isActive: boolean; reviewCount: number; createdAt: string;
    }>;
    total: number;
  }> {
    const prisma = this.requireStore();
    const take = Math.min(100, Math.max(1, Math.trunc(input.take ?? 50) || 50));
    const where = {
      ...(input.nodeId ? { knowledgeNodeId: input.nodeId } : {}),
      ...(input.includeRetired ? {} : { isActive: true }),
    };
    const [cards, total] = await Promise.all([
      prisma.memoryCard.findMany({
        where,
        include: { knowledgeNode: { select: { name: true } }, userStates: { select: { reviewCount: true } } },
        orderBy: [{ knowledgeNodeId: 'asc' }, { createdAt: 'asc' }],
        take,
      }),
      prisma.memoryCard.count({ where }),
    ]);
    return {
      storeAvailable: true,
      total,
      cards: cards.map((card) => ({
        id: card.id,
        knowledgeNodeId: card.knowledgeNodeId,
        nodeName: card.knowledgeNode?.name ?? null,
        cardType: card.cardType,
        front: card.front,
        back: card.back,
        reviewedBy: card.reviewedBy,
        rightsConfirmed: card.rightsConfirmed,
        isActive: card.isActive,
        reviewCount: card.userStates.reduce((sum, state) => sum + state.reviewCount, 0),
        createdAt: card.createdAt.toISOString(),
      })),
    };
  }

  private assertContentRule10(args: { reviewedBy?: string | null; rightsConfirmed?: boolean }): void {
    if (!args.reviewedBy || !args.rightsConfirmed) {
      throw new BadRequestException('RULE-10：新建/改写内容必须同时提供 reviewedBy 与 rightsConfirmed=true。');
    }
  }

  private assertCardShape(args: { knowledgeNodeId?: string; cardType?: string; front?: string; back?: string }): void {
    if (args.knowledgeNodeId !== undefined && !args.knowledgeNodeId.trim()) {
      throw new BadRequestException('缺少知识节点ID。');
    }
    if (args.cardType !== undefined && !['CONCLUSION', 'FORMULA'].includes(args.cardType)) {
      throw new BadRequestException('卡片类型必须是 CONCLUSION 或 FORMULA。');
    }
    if (args.front !== undefined && (!args.front.trim() || args.front.length > 500)) {
      throw new BadRequestException('正面须为 1~500 字符。');
    }
    if (args.back !== undefined && (!args.back.trim() || args.back.length > 2000)) {
      throw new BadRequestException('背面须为 1~2000 字符。');
    }
  }

  async createCardAdmin(input: {
    actorId: string;
    knowledgeNodeId: string;
    cardType: string;
    front: string;
    back: string;
    reviewedBy: string;
    rightsConfirmed: boolean;
  }): Promise<{ id: string }> {
    const prisma = this.requireStore();
    this.assertCardShape(input);
    this.assertContentRule10(input);
    const node = await prisma.knowledgeNode.findFirst({
      where: { id: input.knowledgeNodeId, isActive: true },
      select: { id: true },
    });
    if (!node) throw new NotFoundException('知识节点不存在或未启用。');
    const dupe = await prisma.memoryCard.findFirst({
      where: { knowledgeNodeId: input.knowledgeNodeId, front: input.front },
      select: { id: true },
    });
    if (dupe) throw new ConflictException('同一节点下已存在相同正面的卡片。');
    const created = await prisma.memoryCard.create({
      data: {
        knowledgeNodeId: input.knowledgeNodeId,
        cardType: input.cardType,
        front: input.front,
        back: input.back,
        reviewedBy: input.reviewedBy,
        rightsConfirmed: input.rightsConfirmed,
      },
      select: { id: true },
    });
    return { id: created.id };
  }

  /**
   * D-M-1 dual-track edit: `light` fixes the row in place (typo on the back;
   * front is the student's memory anchor and NEVER mutates); `rewrite` retires
   * the old row and creates a fresh reviewed one — student states stay bound
   * to the old (retired) row and never silently re-anchor to new content.
   */
  async editCardAdmin(
    cardId: string,
    input: {
      editKind: 'light' | 'rewrite';
      front?: string;
      back?: string;
      cardType?: string;
      reviewedBy: string;
      rightsConfirmed: boolean;
    },
  ): Promise<{ mode: 'light' | 'rewrite'; retiredId?: string; newId?: string }> {
    const prisma = this.requireStore();
    this.assertContentRule10(input);
    const existing = await prisma.memoryCard.findUnique({ where: { id: cardId } });
    if (!existing) throw new NotFoundException('卡片不存在。');

    if (input.editKind === 'light') {
      if (input.front !== undefined && input.front !== existing.front) {
        throw new BadRequestException('正面是学生的记忆锚点：改正面请用 rewrite（停旧建新）。');
      }
      this.assertCardShape({ back: input.back, cardType: input.cardType });
      await prisma.memoryCard.update({
        where: { id: cardId },
        data: {
          ...(input.back !== undefined ? { back: input.back } : {}),
          ...(input.cardType !== undefined ? { cardType: input.cardType } : {}),
          reviewedBy: input.reviewedBy,
          rightsConfirmed: true,
        },
      });
      return { mode: 'light' };
    }

    // rewrite: retire old, create new (front and/or back substantively change).
    const front = input.front?.trim() || existing.front;
    const back = input.back?.trim() || existing.back;
    this.assertCardShape({ front, back });
    const dupe = await prisma.memoryCard.findFirst({
      where: { knowledgeNodeId: existing.knowledgeNodeId, front, isActive: true, id: { not: existing.id } },
      select: { id: true },
    });
    if (dupe) throw new ConflictException('同节点下已存在相同正面的其他启用卡片。');
    const created = await prisma.$transaction(async (tx) => {
      await tx.memoryCard.update({ where: { id: existing.id }, data: { isActive: false } });
      return tx.memoryCard.create({
        data: {
          knowledgeNodeId: existing.knowledgeNodeId,
          cardType: input.cardType ?? existing.cardType,
          front,
          back,
          reviewedBy: input.reviewedBy,
          rightsConfirmed: true,
        },
        select: { id: true },
      });
    });
    return { mode: 'rewrite', retiredId: existing.id, newId: created.id };
  }

  async retireCardAdmin(cardId: string): Promise<{ id: string; isActive: false }> {
    const prisma = this.requireStore();
    const existing = await prisma.memoryCard.findUnique({ where: { id: cardId }, select: { id: true, isActive: true } });
    if (!existing) throw new NotFoundException('卡片不存在。');
    await prisma.memoryCard.update({ where: { id: cardId }, data: { isActive: false } });
    return { id: cardId, isActive: false };
  }

  async getSession(userId: string, input: { limit?: number; nodeId?: string } = {}, now: Date = new Date()): Promise<MemoryCardSessionView> {
    const prisma = this.requireStore();
    const requested = Math.trunc(input.limit ?? MEMORY_CARD_SESSION_CAP);
    const sessionCap = Number.isFinite(requested) && requested > 0
      ? Math.min(50, requested)
      : MEMORY_CARD_SESSION_CAP;

    // Node-scoped review (roadmap §2 节点详情入口): an unknown node is a caller
    // error → 404; a known node with zero cards is an honest empty session.
    const nodeId = input.nodeId?.trim() || null;
    if (nodeId) {
      const node = await prisma.knowledgeNode.findFirst({ where: { id: nodeId, isActive: true }, select: { id: true } });
      if (!node) throw new NotFoundException('知识节点不存在或未启用。');
    }
    const nodeCardFilter = nodeId ? { knowledgeNodeId: nodeId } : {};

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { examDate: true, remainingDays: true },
    });
    const density = resolveCardDensity({ examDate: user?.examDate ?? null, remainingDays: user?.remainingDays ?? null, now });

    // Bounded reads: due states (schedule-driven), then the first new cards.
    const states = await prisma.userMemoryCardState.findMany({
      where: { userId, nextReviewAt: { lte: now }, card: { isActive: true, ...nodeCardFilter } },
      include: { card: { include: { knowledgeNode: { select: { name: true, subject: true } } } } },
      orderBy: [{ nextReviewAt: 'asc' }],
      take: MAX_STATES,
    });
    const newCards = await prisma.memoryCard.findMany({
      where: { isActive: true, userStates: { none: { userId } }, ...nodeCardFilter },
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
