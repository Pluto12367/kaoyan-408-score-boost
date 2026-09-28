import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildScoreRecovery, buildRecoveryClaims, RECOVERY_CLAIM_FOOTNOTE, type ScoreRecoveryResult } from '@kaoyan408/shared';

/**
 * PHASE 9 — Score Recovery projection service (read-only).
 *
 * Composes loss evidence (ScoreLossItem, the ledger's derived projection) with
 * re-attempt evidence (PracticeRecord + ReviewAttempt) to answer "失分有没有
 * 被追回来" per question and per node.
 *
 * Boundaries:
 *   • READ-ONLY: no writes, no scheduler, no mastery.
 *   • OBSERVED / PROXY amounts stay separate (score-loss IL-6); unpriced loss
 *     is counted, never priced (NULL ≠ 0).
 *   • Nothing here is a verified score gain (RULE-11) — the fields are named
 *     for the evidence they carry.
 */

export interface ScoreRecoveryView extends ScoreRecoveryResult {
  readonly userId: string;
  readonly generatedAt: string;
  readonly storeAvailable: boolean;
  readonly reason?: string;
}

const MAX_LOSS_ROWS = 1000;
const MAX_PRACTICE_ROWS = 2000;
const MAX_REVIEW_ROWS = 1000;

@Injectable()
export class ScoreRecoveryService {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  get enabled(): boolean {
    return Boolean(process.env.DATABASE_URL && this.prisma);
  }

  clampDays(days: number | undefined | null): number {
    if (days == null || !Number.isFinite(days)) return 30;
    return Math.min(180, Math.max(1, Math.trunc(days)));
  }

  async getScoreRecovery(userId: string, options: { days?: number } = {}, now: Date = new Date()): Promise<ScoreRecoveryView> {
    const generatedAt = now.toISOString();
    const windowDays = this.clampDays(options.days);
    if (!this.enabled) {
      return {
        userId,
        generatedAt,
        storeAvailable: false,
        reason: 'store_unavailable',
        window: { days: windowDays, from: new Date(now.getTime() - windowDays * 86_400_000).toISOString(), to: generatedAt },
        dataStatus: 'EMPTY',
        summary: {
          questions: 0, recoveredQuestions: 0, notRecoveredQuestions: 0, awaitingQuestions: 0,
          unpricedQuestions: 0, observedLostScore: 0, observedLossWithReattemptSuccess: 0,
          observedLossOutstanding: 0, proxyLostScore: 0, proxyLossWithReattemptSuccess: 0,
        },
        rows: [],
        nodes: [],
      };
    }

    const from = new Date(now.getTime() - windowDays * 86_400_000);
    const [lossRows, practiceRows, reviewRows] = await Promise.all([
      this.prisma!.scoreLossItem.findMany({
        where: { userId, recordedAt: { gte: from } },
        orderBy: { recordedAt: 'desc' },
        take: MAX_LOSS_ROWS,
        select: { questionId: true, nodeId: true, lostScore: true, lossKind: true, recordedAt: true },
      }),
      this.prisma!.practiceRecord.findMany({
        where: { userId, submittedAt: { gte: from } },
        orderBy: { submittedAt: 'desc' },
        take: MAX_PRACTICE_ROWS,
        select: { questionId: true, correct: true, submittedAt: true },
      }),
      this.prisma!.reviewAttempt.findMany({
        where: { schedule: { userId }, reviewedAt: { gte: from } },
        orderBy: { reviewedAt: 'desc' },
        take: MAX_REVIEW_ROWS,
        select: { redoCorrect: true, reviewedAt: true, schedule: { select: { questionId: true } } },
      }),
    ]);

    const result = buildScoreRecovery({
      now: generatedAt,
      windowDays,
      lossFacts: lossRows.map((row) => ({
        questionId: row.questionId,
        nodeId: row.nodeId,
        lostScore: row.lostScore,
        lossKind: row.lossKind === 'PROXY' ? 'PROXY' : 'OBSERVED',
        recordedAt: row.recordedAt.toISOString(),
      })),
      reattempts: [
        ...practiceRows.map((row) => ({
          questionId: row.questionId,
          correct: row.correct,
          occurredAt: row.submittedAt.toISOString(),
          source: 'practice' as const,
        })),
        ...reviewRows.map((row) => ({
          questionId: row.schedule.questionId,
          correct: row.redoCorrect,
          occurredAt: row.reviewedAt.toISOString(),
          source: 'review' as const,
        })),
      ],
    });
    return { userId, generatedAt, storeAvailable: true, ...result };
  }

  /**
   * V14 ①（D-V 批准 2026-09-27）— 提分账本声明（下钻视图）。
   * 在 recovery 配对之上做两层口径声明 + D-V-2 样本门槛 + 节点名解析。
   * 只读；不改任何账本行。RULE-11：输出是"失分被追回的测量"，不是成绩预测。
   */
  async getRecoveryEvidence(userId: string, options: { days?: number; minSamples?: number } = {}, now: Date = new Date()): Promise<RecoveryEvidenceView> {
    const generatedAt = now.toISOString();
    const minSamples = Math.max(1, options.minSamples ?? 3);
    if (!this.enabled) {
      return {
        userId, generatedAt, storeAvailable: false, reason: 'store_unavailable',
        windowDays: this.clampDays(options.days),
        claims: [], proxyClaims: [], summary: {
          observedRecovered: 0, proxyRecovered: 0, unpricedRecovered: 0,
          recoveredCandidates: 0, insufficient: true, minSamples,
        },
        footnote: RECOVERY_CLAIM_FOOTNOTE,
      };
    }
    const recovery = await this.getScoreRecovery(userId, options, now);
    const nodeIds = [...new Set(recovery.rows.map((row) => row.nodeId).filter((id): id is string => id != null))];
    const nodeRows = nodeIds.length > 0
      ? await this.prisma!.knowledgeNode.findMany({ where: { id: { in: nodeIds } }, select: { id: true, name: true } })
      : [];
    const nodeNameById = new Map(nodeRows.map((row) => [row.id, row.name]));
    const claims = buildRecoveryClaims({
      rows: recovery.rows,
      minSamples,
      nodeNameById,
    });
    return {
      userId,
      generatedAt,
      storeAvailable: true,
      windowDays: recovery.window.days,
      claims: claims.claims,
      proxyClaims: claims.proxyClaims,
      summary: claims.summary,
      footnote: RECOVERY_CLAIM_FOOTNOTE,
    };
  }
}

export interface RecoveryEvidenceView {
  readonly userId: string;
  readonly generatedAt: string;
  readonly storeAvailable: boolean;
  readonly reason?: string;
  readonly windowDays: number;
  readonly claims: ReturnType<typeof buildRecoveryClaims>['claims'];
  readonly proxyClaims: ReturnType<typeof buildRecoveryClaims>['proxyClaims'];
  readonly summary: ReturnType<typeof buildRecoveryClaims>['summary'];
  readonly footnote: string;
}
