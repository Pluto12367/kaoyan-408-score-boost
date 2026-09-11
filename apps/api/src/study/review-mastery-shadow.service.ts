/**
 * V12-M3 — Review → Unified Mastery SHADOW (read-only assembly).
 *
 * Assembles, for ONE student, everything the pure pipeline needs:
 *
 *   ReviewAttempt (per-attempt facts, the complete review history)
 *     + EVIDENCE_RECORDED receipts (the evidence boundary)
 *     → ReviewEvidenceProjection
 *     → per-event mastery shadow
 *     → joined to the existing decision-chain shadow (priority / opportunity /
 *       recommendation ranking)
 *
 * ## Boundaries (enforced by test/review-mastery-pipeline.test.js)
 *
 *   • Read-only. No `update` / `upsert` / `create` / `delete` on any table, no
 *     `$transaction`, no call into `applyReview` or `applyAttempts`.
 *   • `UserKnowledgeMastery` is read as the authoritative comparison value and
 *     never written.
 *   • Every artefact is marked `authoritative: false`.
 *   • The downstream node-level numbers are taken from the shadow decision chain
 *     when it is available, so the two shadows cannot drift apart; when it is
 *     unavailable the dataset reports the absence instead of inventing ranks.
 *
 * The authoritative write path in `ScoreCenterService.applyReview` is untouched
 * by this file, and mastery semantics are not switched.
 */

import { Injectable, Optional } from '@nestjs/common';
import {
  aggregateReviewIntegrationCohort,
  auditReviewMasteryIntegration,
  buildReviewMasteryShadow,
  joinReviewIntegrationDataset,
  projectReviewEvidence,
  reviewEventIdOf,
  type MasteryModelId,
  type ReviewEvidenceProjection,
  type ReviewIntegrationAudit,
  type ReviewIntegrationDataset,
  type ReviewMasteryShadow,
  type ReviewEventFact,
  type ReviewEvidenceReceiptFact,
} from '@kaoyan408/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewScheduleRepository } from './review-schedule.repository';
import { LearningEvidenceService } from './learning-evidence.service';
import { ShadowDecisionChainService } from './shadow-decision-chain.service';

const DEFAULT_WINDOW_DAYS = 60;
const MAX_WINDOW_DAYS = 365;
const MAX_EVENTS = 200;

export interface ReviewMasteryShadowResult {
  readonly generatedAt: string;
  readonly windowDays: number;
  readonly model: MasteryModelId;
  readonly authoritative: false;
  readonly source: 'derived';
  readonly projection: ReviewEvidenceProjection;
  readonly mastery: ReviewMasteryShadow;
  readonly dataset: ReviewIntegrationDataset;
  readonly audit: ReviewIntegrationAudit;
  readonly downstream: {
    /** False when the decision-chain shadow has no universe for this student. */
    readonly available: boolean;
    readonly nodes: number;
    readonly basis: string;
  };
}

export interface ReviewMasteryCohortResult {
  readonly generatedAt: string;
  readonly model: MasteryModelId;
  readonly authoritative: false;
  readonly aggregate: ReturnType<typeof aggregateReviewIntegrationCohort>;
  readonly perStudent: readonly {
    readonly userId: string;
    readonly events: number;
    readonly nodes: number;
    readonly affectedNodes: number;
    readonly auditPassed: boolean;
  }[];
}

@Injectable()
export class ReviewMasteryShadowService {
  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly reviewSchedules?: ReviewScheduleRepository,
    @Optional() private readonly evidence?: LearningEvidenceService,
    @Optional() private readonly chain?: ShadowDecisionChainService,
  ) {}

  get enabled(): boolean {
    return Boolean(this.prisma && this.reviewSchedules?.enabled);
  }

  /**
   * One student. Returns null when the store is unavailable — an absent shadow
   * is never rendered as an empty successful one.
   */
  async getShadow(
    userId: string,
    options: { windowDays?: number; shadowModel?: MasteryModelId } = {},
  ): Promise<ReviewMasteryShadowResult | null> {
    if (!this.enabled) return null;
    const db = this.prisma!;
    const windowDays = clampWindow(options.windowDays);
    const model = options.shadowModel ?? 'production';
    const since = new Date(Date.now() - windowDays * 86_400_000);
    const asOf = new Date();

    const attempts = (await this.reviewSchedules!.listAttemptsByUser(userId, MAX_EVENTS))
      .filter((row) => new Date(row.reviewedAt).getTime() >= since.getTime());

    const questionIds = [...new Set(attempts.map((row) => row.questionId))];
    const tags = questionIds.length > 0
      ? await db.questionKnowledgeNodeTag.findMany({
          where: { questionId: { in: questionIds } },
          select: { questionId: true, knowledgeNodeId: true, role: true },
        })
      : [];

    const nodeIds = [...new Set(tags.map((tag) => tag.knowledgeNodeId))];
    const nodes = nodeIds.length > 0
      ? await db.knowledgeNode.findMany({
          where: { id: { in: nodeIds } },
          select: { id: true, difficulty: true },
        })
      : [];
    const difficultyByNode = new Map(nodes.map((node) => [node.id, Number(node.difficulty) || 3]));

    // PRIMARY tag wins, matching the review-semantics shadow's resolution.
    const nodeByQuestion = new Map<string, string>();
    for (const tag of [...tags].sort((left, right) => rankRole(left.role) - rankRole(right.role))) {
      if (!nodeByQuestion.has(tag.questionId)) nodeByQuestion.set(tag.questionId, tag.knowledgeNodeId);
    }

    const events: ReviewEventFact[] = attempts.map((attempt) => {
      const nodeId = nodeByQuestion.get(attempt.questionId) ?? null;
      return {
        reviewEventId: reviewEventIdOf({
          attemptId: attempt.attemptId,
          scheduleId: attempt.scheduleId,
          questionId: attempt.questionId,
          reviewedAt: attempt.reviewedAt,
          idempotencyKey: attempt.idempotencyKey,
        }),
        scheduleId: attempt.scheduleId,
        questionId: attempt.questionId,
        nodeId,
        reviewedAt: attempt.reviewedAt,
        redoCorrect: attempt.redoCorrect,
        difficulty: nodeId ? difficultyByNode.get(nodeId) ?? 3 : 3,
        // The attempt row does not record whether the caller passed `isReview`,
        // so whether the authoritative writer ran is genuinely unknown here and
        // is reported as unknown rather than assumed.
        scheduledReview: null,
      };
    });

    const receipts = await this.loadReviewReceipts(userId);
    const projection = projectReviewEvidence({ events, receipts });

    const [masteryRows, snapshotRows] = nodeIds.length > 0
      ? await Promise.all([
          db.userKnowledgeMastery.findMany({
            where: { userId, knowledgeNodeId: { in: nodeIds } },
            select: { knowledgeNodeId: true, mastery: true, stabilityDays: true, confidence: true },
          }),
          db.userMasterySnapshot.findMany({
            where: { userId, knowledgeNodeId: { in: nodeIds } },
            orderBy: { snapshotDate: 'asc' },
            select: {
              knowledgeNodeId: true,
              mastery: true,
              attempts: true,
              correctCount: true,
              wrongCount: true,
              snapshotDate: true,
            },
          }),
        ])
      : [[], []];

    const firstObservationByNode = new Map<string, string>();
    for (const observation of projection.observations) {
      const current = firstObservationByNode.get(observation.nodeId);
      if (!current || observation.reviewedAt < current) {
        firstObservationByNode.set(observation.nodeId, observation.reviewedAt);
      }
    }

    // Baseline = the nearest daily snapshot at or before the node's first review.
    // A snapshot stores mastery/attempts/correctCount but not accuracy, so
    // recentAccuracy is approximated by the recoverable accuracy and the row
    // basis says so (the same disclosure the review-semantics shadow makes).
    const baselines = [];
    for (const [nodeId, firstAt] of firstObservationByNode) {
      const candidate = [...snapshotRows]
        .filter((row) => row.knowledgeNodeId === nodeId && row.snapshotDate.toISOString().slice(0, 10) <= firstAt.slice(0, 10))
        .at(-1);
      if (!candidate) continue;
      const derivedAccuracy = candidate.attempts > 0
        ? Math.round((candidate.correctCount / candidate.attempts) * 10000) / 10000
        : 0.55;
      baselines.push({
        nodeId,
        mastery: candidate.mastery,
        accuracy: derivedAccuracy,
        recentAccuracy: derivedAccuracy,
        attempts: candidate.attempts,
        correctCount: candidate.correctCount,
        wrongCount: candidate.wrongCount,
        confidence: 0,
        at: candidate.snapshotDate.toISOString(),
      });
    }

    const mastery = buildReviewMasteryShadow({
      observations: projection.observations,
      baselines,
      authoritative: masteryRows.map((row) => ({
        nodeId: row.knowledgeNodeId,
        mastery: row.mastery,
        stabilityDays: row.stabilityDays,
      })),
      baselineApproximated: baselines.length > 0,
      model,
    });

    const confidenceByNode: Record<string, number> = {};
    for (const row of masteryRows) confidenceByNode[row.knowledgeNodeId] = row.confidence;

    const downstream = await this.loadDownstream(userId, nodeIds, model, windowDays);
    const dataset = joinReviewIntegrationDataset({
      studentId: userId,
      shadow: mastery,
      downstream: downstream.facts,
      generatedAt: asOf.toISOString(),
      confidenceByNode,
    });

    const audit = auditReviewMasteryIntegration({
      observations: projection.observations,
      shadow: mastery,
      dataset,
      // Structural: this file performs no write, and the assertion test scans
      // the source to keep it that way. There is nothing to count.
      authoritativeWrites: 0,
    });

    return {
      generatedAt: asOf.toISOString(),
      windowDays,
      model,
      authoritative: false,
      source: 'derived',
      projection,
      mastery,
      dataset,
      audit,
      downstream: { available: downstream.available, nodes: downstream.facts.length, basis: downstream.basis },
    };
  }

  /**
   * Cohort view: the same pipeline over several students, aggregated. Used by
   * the cohort script so the owner sees the affected-student ratio rather than
   * one student's anecdote.
   */
  async getCohort(
    userIds: readonly string[],
    options: { windowDays?: number; shadowModel?: MasteryModelId } = {},
  ): Promise<ReviewMasteryCohortResult | null> {
    if (!this.enabled) return null;
    const model = options.shadowModel ?? 'production';
    const datasets: ReviewIntegrationDataset[] = [];
    const perStudent: Array<{ userId: string; events: number; nodes: number; affectedNodes: number; auditPassed: boolean }> = [];
    for (const userId of userIds) {
      const shadow = await this.getShadow(userId, { windowDays: options.windowDays, shadowModel: model });
      if (!shadow) continue;
      datasets.push(shadow.dataset);
      perStudent.push({
        userId,
        events: shadow.dataset.summary.events,
        nodes: shadow.dataset.summary.nodes,
        affectedNodes: shadow.dataset.summary.affectedNodes,
        auditPassed: shadow.audit.passed,
      });
    }
    return {
      generatedAt: new Date().toISOString(),
      model,
      authoritative: false,
      aggregate: aggregateReviewIntegrationCohort(datasets),
      perStudent,
    };
  }

  /** The review evidence ledger for one student, decoded defensively. */
  private async loadReviewReceipts(userId: string): Promise<ReviewEvidenceReceiptFact[]> {
    const list = await this.evidence?.list(userId, { limit: MAX_EVENTS });
    if (!list) return [];
    const receipts: ReviewEvidenceReceiptFact[] = [];
    for (const record of list.records) {
      if (record.action !== 'review.recalled' && record.action !== 'review.marked') continue;
      if (!record.sourceId) continue;
      receipts.push({
        receiptId: record.id,
        action: record.action,
        questionId: record.sourceId,
        recordedAt: record.recordedAt,
        scope: record.recordedAt.slice(0, 10),
        kind: record.kind,
        strength: record.strength,
        canInfluenceMastery: record.canInfluenceMastery,
      });
    }
    return receipts;
  }

  /**
   * Node-level downstream numbers, taken from the decision-chain shadow so the
   * two shadows consume the SAME mastery input and cannot drift. When the chain
   * has no universe, the absence is reported.
   */
  private async loadDownstream(
    userId: string,
    nodeIds: readonly string[],
    model: MasteryModelId,
    windowDays: number,
  ): Promise<{
    available: boolean;
    basis: string;
    facts: Array<{
      nodeId: string;
      observedPriority: number | null;
      shadowPriority: number | null;
      observedOpportunity: number | null;
      shadowOpportunity: number | null;
      observedRank: number | null;
      shadowRank: number | null;
      attributionBasis: string | null;
    }>;
  }> {
    const chain = await this.chain?.getChain(userId, { windowDays, maxItems: MAX_EVENTS, shadowModel: model });
    if (!chain) {
      return {
        available: false,
        basis: '决策链影子不可用（无节点候选或存储不可用），下游优先级/机会/排名缺失，数据集如实标记归因不完整。',
        facts: [],
      };
    }
    const nodeSet = new Set(nodeIds);
    const facts = chain.rows
      .filter((row) => nodeSet.has(row.knowledgeNodeId))
      .map((row) => ({
        nodeId: row.knowledgeNodeId,
        observedPriority: row.observedPriority,
        shadowPriority: row.shadowPriority,
        observedOpportunity: row.observedOpportunity,
        shadowOpportunity: row.shadowOpportunity,
        observedRank: row.observedRank,
        shadowRank: row.shadowRank,
        attributionBasis: row.attribution,
      }));
    return {
      available: facts.length > 0,
      basis: facts.length > 0
        ? `复用决策链影子（模型 ${model}）的 ${facts.length} 个节点下游结果，保证两个影子用同一份掌握度输入。`
        : '决策链影子没有覆盖本次复习涉及的节点，下游差值缺失。',
      facts,
    };
  }
}

/** PRIMARY tags outrank SECONDARY when several nodes describe one question. */
function rankRole(role: string): number {
  return role === 'PRIMARY' ? 0 : 1;
}

function clampWindow(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return DEFAULT_WINDOW_DAYS;
  return Math.min(Math.floor(value), MAX_WINDOW_DAYS);
}
