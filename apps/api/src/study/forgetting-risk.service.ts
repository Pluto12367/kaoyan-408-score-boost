import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildForgettingRisk, type ForgettingRiskResult } from '@kaoyan408/shared';

/**
 * PHASE 7 — Forgetting Risk projection (read-only).
 *
 * "会了但快忘了": reads the canonical mastery rows (the ONLY ability SoT) and
 * classifies decay through the shared projection. It never writes mastery and
 * never schedules reviews — the scheduler keeps its own canonical path
 * (correct answers create wrong-question schedules; the FSRS production
 * wiring stays Owner-Gated, contract §20).
 *
 * Bounded: one list read (take 500) plus a batched node-name lookup.
 */

export interface ForgettingRiskView extends ForgettingRiskResult {
  readonly userId: string;
  readonly generatedAt: string;
  readonly storeAvailable: boolean;
  readonly reason?: string;
}

const MAX_MASTERY_ROWS = 500;

@Injectable()
export class ForgettingRiskService {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  get enabled(): boolean {
    return Boolean(process.env.DATABASE_URL && this.prisma);
  }

  async getForgettingRisk(userId: string, now: Date = new Date()): Promise<ForgettingRiskView> {
    const generatedAt = now.toISOString();
    if (!this.enabled) {
      return {
        userId,
        generatedAt,
        storeAvailable: false,
        reason: 'store_unavailable',
        dataStatus: 'EMPTY',
        summary: { learnedNodes: 0, atRiskCount: 0, overdueCount: 0, dueSoonCount: 0, insufficientDataCount: 0 },
        rows: [],
      };
    }

    const masteries = await this.prisma!.userKnowledgeMastery.findMany({
      where: { userId },
      orderBy: { mastery: 'desc' },
      take: MAX_MASTERY_ROWS,
      select: {
        knowledgeNodeId: true,
        mastery: true,
        attempts: true,
        stabilityDays: true,
        lastReviewedAt: true,
        nextReviewAt: true,
      },
    });

    const nodeIds = masteries.map((row) => row.knowledgeNodeId);
    const nodes = nodeIds.length > 0
      ? await this.prisma!.knowledgeNode.findMany({
        where: { id: { in: nodeIds } },
        select: { id: true, subject: true, name: true },
      })
      : [];
    const nodeById = new Map(nodes.map((node) => [node.id, node]));

    const result = buildForgettingRisk({
      now: generatedAt,
      rows: masteries.map((row) => ({
        nodeId: row.knowledgeNodeId,
        subject: nodeById.get(row.knowledgeNodeId)?.subject ?? null,
        nodeName: nodeById.get(row.knowledgeNodeId)?.name ?? null,
        mastery: row.mastery,
        attempts: row.attempts,
        stabilityDays: row.stabilityDays ?? null,
        lastReviewedAt: row.lastReviewedAt?.toISOString() ?? null,
        nextReviewAt: row.nextReviewAt?.toISOString() ?? null,
      })),
    });
    return { userId, generatedAt, storeAvailable: true, ...result };
  }
}
