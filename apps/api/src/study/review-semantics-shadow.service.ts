/**
 * V12-M3 Phase B — Review semantics unification SHADOW (read-only assembly).
 *
 * Assembles the inputs the pure shadow needs from facts that already exist, and
 * nothing else:
 *
 *   ReviewAttempt → question → knowledge node (PRIMARY preferred), with the
 *   node's numeric difficulty (the same input production's applyAttempts uses);
 *   UserMasterySnapshot for a baseline before the first observation;
 *   UserKnowledgeMastery for the currently stored values.
 *
 * Writes nothing. Emits no events. Every output is marked NON-AUTHORITATIVE and
 * switching semantics stays an owner-approved decision (see
 * docs/v12-m3-review-semantics-audit.md §4.3).
 */

import { Injectable, Optional } from '@nestjs/common';
import {
  replayUnifiedReviewMastery,
  reviewRetentionShadow,
  REVIEW_SEMANTICS_MATRIX,
  type ReviewMasteryBaseline,
  type ReviewMasteryReplay,
  type ReviewMasteryReplayRow,
  type ReviewObservation,
  type RetentionShadowInputRow,
  type RetentionShadow,
  type StoredNodeMastery,
} from '@kaoyan408/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewScheduleRepository } from './review-schedule.repository';

const DEFAULT_WINDOW_DAYS = 60;
const MAX_WINDOW_DAYS = 365;
const MAX_ATTEMPTS = 200;

export interface ReviewSemanticsShadowResult {
  readonly generatedAt: string;
  readonly windowDays: number;
  readonly authoritative: false;
  readonly semantics: typeof REVIEW_SEMANTICS_MATRIX;
  readonly masteryReplay: ReviewMasteryReplay;
  readonly retention: RetentionShadow;
  readonly source: 'derived';
}

export interface ReplayAssemblyNode {
  readonly nodeId: string;
  readonly replay: ReviewMasteryReplayRow;
  readonly trigger: { eventId: string; eventType: string; at: string } | null;
  readonly observed: {
    mastery: number;
    accuracy: number;
    recentAccuracy: number;
    attempts: number;
    correctCount: number;
    wrongCount: number;
    confidence: number;
    retention: number | null;
    stabilityDays: number | null;
    lastReviewedAt: Date | null;
    pinned: boolean;
  } | null;
}

/** Read-only assembly result shared by the review shadow and the decision chain. */
export interface ReplayAssembly {
  readonly windowDays: number;
  readonly asOf: Date;
  readonly nodes: readonly ReplayAssemblyNode[];
}

@Injectable()
export class ReviewSemanticsShadowService {
  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly reviewSchedules?: ReviewScheduleRepository,
  ) {}

  get enabled(): boolean {
    return Boolean(this.prisma && this.reviewSchedules?.enabled);
  }

  /**
   * Read-only assembly shared with the downstream shadow chain.
   *
   * Exposed so the decision-chain shadow can consume the SAME observations,
   * baselines and replay instead of assembling them a second time (which is how
   * two divergent 口径 get created). Writes nothing.
   */
  async assembleReplayInputs(
    userId: string,
    options: { windowDays?: number } = {},
  ): Promise<ReplayAssembly | null> {
    if (!this.enabled) return null;
    const db = this.prisma!;
    const windowDays = clampWindow(options.windowDays);
    const since = new Date(Date.now() - windowDays * 86_400_000);
    const asOf = new Date();

    const attempts = (await this.reviewSchedules!.listAttemptsByUser(userId, MAX_ATTEMPTS))
      .filter((row) => new Date(row.reviewedAt).getTime() >= since.getTime());
    if (attempts.length === 0) return { windowDays, asOf, nodes: [] };

    const questionIds = [...new Set(attempts.map((row) => row.questionId))];
    const tags = await db.questionKnowledgeNodeTag.findMany({
      where: { questionId: { in: questionIds } },
      select: { questionId: true, knowledgeNodeId: true, role: true },
    });
    const nodeIds = [...new Set(tags.map((tag) => tag.knowledgeNodeId))];
    if (nodeIds.length === 0) return { windowDays, asOf, nodes: [] };

    const [nodes, masteryRows, snapshotRows] = await Promise.all([
      db.knowledgeNode.findMany({
        where: { id: { in: nodeIds } },
        select: { id: true, difficulty: true },
      }),
      db.userKnowledgeMastery.findMany({
        where: { userId, knowledgeNodeId: { in: nodeIds } },
        select: {
          knowledgeNodeId: true,
          mastery: true,
          accuracy: true,
          recentAccuracy: true,
          attempts: true,
          correctCount: true,
          wrongCount: true,
          confidence: true,
          retention: true,
          stabilityDays: true,
          lastReviewedAt: true,
          pinned: true,
        },
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
    ]);

    const nodeDifficulty = new Map(nodes.map((node) => [node.id, Number(node.difficulty) || 3]));
    const nodeByQuestion = new Map<string, string>();
    for (const tag of [...tags].sort((left, right) => rankRole(left.role) - rankRole(right.role))) {
      if (!nodeByQuestion.has(tag.questionId)) nodeByQuestion.set(tag.questionId, tag.knowledgeNodeId);
    }

    const observations: ReviewObservation[] = [];
    // Newest attempt per node, for attribution of the divergence.
    const triggerByNode = new Map<string, { eventId: string; eventType: string; at: string }>();
    const attemptById = new Map<string, { questionId: string; reviewedAt: string; redoCorrect: boolean }>();
    for (const attempt of attempts) {
      const nodeId = nodeByQuestion.get(attempt.questionId);
      if (!nodeId) continue;
      observations.push({
        nodeId,
        questionId: attempt.questionId,
        reviewedAt: attempt.reviewedAt,
        redoCorrect: attempt.redoCorrect,
        difficulty: nodeDifficulty.get(nodeId) ?? 3,
      });
    }

    const masteryByNode = new Map(masteryRows.map((row) => [row.knowledgeNodeId, row]));
    const firstObservationByNode = new Map<string, string>();
    for (const observation of observations) {
      const current = firstObservationByNode.get(observation.nodeId);
      if (!current || observation.reviewedAt < current) {
        firstObservationByNode.set(observation.nodeId, observation.reviewedAt);
      }
    }

    const baselines: ReviewMasteryBaseline[] = [];
    for (const [nodeId, firstAt] of firstObservationByNode) {
      const candidate = [...snapshotRows]
        .filter((row) => row.knowledgeNodeId === nodeId && row.snapshotDate.toISOString().slice(0, 10) <= firstAt.slice(0, 10))
        .at(-1);
      if (!candidate) continue;
      const attemptsCount = candidate.attempts;
      const derivedAccuracy = attemptsCount > 0
        ? Math.round((candidate.correctCount / attemptsCount) * 10000) / 10000
        : 0.55;
      baselines.push({
        nodeId,
        mastery: candidate.mastery,
        accuracy: derivedAccuracy,
        recentAccuracy: derivedAccuracy,
        attempts: attemptsCount,
        correctCount: candidate.correctCount,
        wrongCount: candidate.wrongCount,
        confidence: 0,
        at: candidate.snapshotDate.toISOString(),
      });
    }

    const stored: StoredNodeMastery[] = masteryRows.map((row) => ({
      nodeId: row.knowledgeNodeId,
      mastery: row.mastery,
      stabilityDays: row.stabilityDays,
    }));

    // Newest observation per node becomes the attribution trigger.
    for (const observation of [...observations].sort((left, right) => right.reviewedAt.localeCompare(left.reviewedAt))) {
      if (triggerByNode.has(observation.nodeId)) continue;
      triggerByNode.set(observation.nodeId, {
        eventId: `review-attempt:${observation.nodeId}:${observation.reviewedAt}`,
        eventType: 'review.recalled',
        at: observation.reviewedAt,
      });
    }

    void attemptById;

    const replay = replayUnifiedReviewMastery({
      observations,
      baselines,
      stored,
      baselineApproximated: baselines.length > 0,
    });

    return {
      windowDays,
      asOf,
      nodes: replay.rows.map((row) => ({
        nodeId: row.nodeId,
        replay: row,
        trigger: triggerByNode.get(row.nodeId) ?? null,
        observed: masteryByNode.get(row.nodeId) ?? null,
      })),
    };
  }

  /** null = store unavailable (honestly absent, never an empty shadow). */
  async getShadow(
    userId: string,
    options: { windowDays?: number } = {},
  ): Promise<ReviewSemanticsShadowResult | null> {
    if (!this.enabled) return null;
    const db = this.prisma!;
    const windowDays = clampWindow(options.windowDays);
    const since = new Date(Date.now() - windowDays * 86_400_000);
    const asOf = new Date();

    const attempts = (await this.reviewSchedules!.listAttemptsByUser(userId, MAX_ATTEMPTS))
      .filter((row) => new Date(row.reviewedAt).getTime() >= since.getTime());
    if (attempts.length === 0) {
      return emptyResult(windowDays, asOf);
    }

    const questionIds = [...new Set(attempts.map((row) => row.questionId))];
    const [tags, questions] = await Promise.all([
      db.questionKnowledgeNodeTag.findMany({
        where: { questionId: { in: questionIds } },
        select: { questionId: true, knowledgeNodeId: true, role: true },
      }),
      db.question.findMany({
        where: { id: { in: questionIds } },
        select: { id: true, difficulty: true },
      }),
    ]);

    const nodeIds = [...new Set(tags.map((tag) => tag.knowledgeNodeId))];
    if (nodeIds.length === 0) return emptyResult(windowDays, asOf);

    const [nodes, masteryRows, snapshotRows] = await Promise.all([
      db.knowledgeNode.findMany({
        where: { id: { in: nodeIds } },
        select: { id: true, difficulty: true },
      }),
      db.userKnowledgeMastery.findMany({
        where: { userId, knowledgeNodeId: { in: nodeIds } },
        select: { knowledgeNodeId: true, mastery: true, retention: true, stabilityDays: true, lastReviewedAt: true },
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
    ]);

    const nodeDifficulty = new Map(nodes.map((node) => [node.id, Number(node.difficulty) || 3]));
    // PRIMARY tag wins; otherwise the first tag we saw for that question.
    const nodeByQuestion = new Map<string, string>();
    for (const tag of [...tags].sort((left, right) => rankRole(left.role) - rankRole(right.role))) {
      if (!nodeByQuestion.has(tag.questionId)) nodeByQuestion.set(tag.questionId, tag.knowledgeNodeId);
    }

    const observations: ReviewObservation[] = [];
    for (const attempt of attempts) {
      const nodeId = nodeByQuestion.get(attempt.questionId);
      if (!nodeId) continue;
      observations.push({
        nodeId,
        questionId: attempt.questionId,
        reviewedAt: attempt.reviewedAt,
        redoCorrect: attempt.redoCorrect,
        difficulty: nodeDifficulty.get(nodeId) ?? 3,
      });
    }

    const masteryByNode = new Map(masteryRows.map((row) => [row.knowledgeNodeId, row]));
    const firstObservationByNode = new Map<string, string>();
    for (const observation of observations) {
      const current = firstObservationByNode.get(observation.nodeId);
      if (!current || observation.reviewedAt < current) {
        firstObservationByNode.set(observation.nodeId, observation.reviewedAt);
      }
    }

    // Baseline = the nearest daily snapshot at or before the first observation.
    const baselines: ReviewMasteryBaseline[] = [];
    for (const [nodeId, firstAt] of firstObservationByNode) {
      const candidate = [...snapshotRows]
        .filter((row) => row.knowledgeNodeId === nodeId && row.snapshotDate.toISOString().slice(0, 10) <= firstAt.slice(0, 10))
        .at(-1);
      if (!candidate) continue;
      // A daily snapshot stores mastery/attempts/correctCount but NOT
      // accuracy/recentAccuracy/confidence. accuracy is recoverable from the
      // counts; recentAccuracy is not, so it is approximated by accuracy and the
      // row says so. confidence is recomputed by the EMA from attempts, so its
      // seed value is inert.
      const attempts = candidate.attempts;
      const derivedAccuracy = attempts > 0
        ? Math.round((candidate.correctCount / attempts) * 10000) / 10000
        : 0.55;
      baselines.push({
        nodeId,
        mastery: candidate.mastery,
        accuracy: derivedAccuracy,
        recentAccuracy: derivedAccuracy,
        attempts,
        correctCount: candidate.correctCount,
        wrongCount: candidate.wrongCount,
        confidence: 0,
        at: candidate.snapshotDate.toISOString(),
      });
    }

    const stored: StoredNodeMastery[] = masteryRows.map((row) => ({
      nodeId: row.knowledgeNodeId,
      mastery: row.mastery,
      stabilityDays: row.stabilityDays,
    }));

    const retentionRows: RetentionShadowInputRow[] = masteryRows.map((row) => ({
      nodeId: row.knowledgeNodeId,
      stabilityDays: row.stabilityDays,
      storedRetention: row.retention,
      lastReviewedAt: row.lastReviewedAt ? row.lastReviewedAt.toISOString() : null,
      asOf: asOf.toISOString(),
    }));

    void questions;

    return {
      generatedAt: asOf.toISOString(),
      windowDays,
      authoritative: false,
      semantics: REVIEW_SEMANTICS_MATRIX,
      masteryReplay: replayUnifiedReviewMastery({
        observations,
        baselines,
        stored,
        baselineApproximated: baselines.length > 0,
      }),
      retention: reviewRetentionShadow({ rows: retentionRows }),
      source: 'derived',
    };
  }
}

function emptyResult(windowDays: number, asOf: Date): ReviewSemanticsShadowResult {
  return {
    generatedAt: asOf.toISOString(),
    windowDays,
    authoritative: false,
    semantics: REVIEW_SEMANTICS_MATRIX,
    masteryReplay: replayUnifiedReviewMastery({ observations: [], baselines: [], stored: [] }),
    retention: reviewRetentionShadow({ rows: [] }),
    source: 'derived',
  };
}

/** PRIMARY tags outrank SECONDARY when several nodes describe one question. */
function rankRole(role: string): number {
  return role === 'PRIMARY' ? 0 : 1;
}

function clampWindow(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return DEFAULT_WINDOW_DAYS;
  return Math.min(Math.floor(value), MAX_WINDOW_DAYS);
}
