/**
 * V12-M3 — Shadow Decision Chain service (read-only assembly).
 *
 * Turns the review-mastery shadow into a decision-grade dataset:
 *
 *   observed/unified mastery → priority → opportunity → recommendation ranking
 *
 * Discipline it inherits and must keep:
 *   • the candidate universe is the STUDENT's own mastered nodes, never an
 *     arbitrary snapshot slice (the defect an earlier end-to-end run exposed);
 *   • both paths run the production primitives on the same universe with the
 *     same evidence, goal and clock, so differences are attributable;
 *   • it writes nothing — no mastery, no schedule, no recommendation, no event;
 *   • everything is `authoritative: false`; switching stays an owner decision.
 */

import { Injectable, Optional } from '@nestjs/common';
import {
  buildShadowDecisionChain,
  classifyAction,
  estimateMinutes,
  type MasteryState,
  type RecommendationExamEvidence,
  type ShadowChainNodeInput,
  type ShadowDecisionChain,
  type MasteryModelId,
} from '@kaoyan408/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewSemanticsShadowService } from './review-semantics-shadow.service';

const MAX_CANDIDATES = 200;
const DEFAULT_MAX_ITEMS = 8;
const DAYS_FALLBACK = 96;


export interface ShadowDecisionChainResult extends ShadowDecisionChain {
  readonly windowDays: number;
  /** Which mastery semantics produced the shadow path. */
  readonly shadowModel: MasteryModelId;
  readonly source: 'derived';
}

@Injectable()
export class ShadowDecisionChainService {
  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly reviewShadow?: ReviewSemanticsShadowService,
  ) {}

  get enabled(): boolean {
    return Boolean(process.env.DATABASE_URL && this.prisma && this.reviewShadow?.enabled);
  }

  /** null = store unavailable (honestly absent, never an empty chain). */
  async getChain(
    userId: string,
    options: { windowDays?: number; maxItems?: number; shadowModel?: MasteryModelId } = {},
  ): Promise<ShadowDecisionChainResult | null> {
    if (!this.enabled) return null;
    const db = this.prisma!;

    const assembly = await this.reviewShadow!.assembleReplayInputs(userId, {
      windowDays: options.windowDays,
      model: options.shadowModel ?? 'production',
    });
    if (assembly == null) return null;

    const replayByNode = new Map(assembly.nodes.map((node) => [node.nodeId, node]));

    // The candidate universe is the student's own mastered nodes.
    const masteryRows = await db.userKnowledgeMastery.findMany({
      where: { userId },
      orderBy: { mastery: 'asc' },
      take: MAX_CANDIDATES,
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
    });
    if (masteryRows.length === 0) return null;

    const nodeIds = masteryRows.map((row) => row.knowledgeNodeId);
    const [nodes, snapshots, relations, user, questionLinks] = await Promise.all([
      db.knowledgeNode.findMany({
        where: { id: { in: nodeIds } },
        select: { id: true, name: true, subject: true, importance: true, difficulty: true },
      }),
      db.knowledgeFrequencySnapshot.findMany({
        where: { knowledgeNodeId: { in: nodeIds } },
        orderBy: [{ snapshotDate: 'desc' }, { modelVersion: 'desc' }],
        take: nodeIds.length,
        select: {
          knowledgeNodeId: true,
          recent3Frequency: true,
          recent5Frequency: true,
          allTimeEvidence: true,
          primaryScore5y: true,
          trendDirection: true,
          trendDelta: true,
          evidenceConfidence: true,
        },
      }),
      db.knowledgeRelation.findMany({
        where: { toId: { in: nodeIds }, type: 'PREREQUISITE' },
        select: { fromId: true, toId: true },
      }),
      db.user.findUnique({ where: { id: userId }, select: { targetScore: true, remainingDays: true } }).catch(() => null),
      db.questionKnowledgeNodeTag.findMany({
        where: { knowledgeNodeId: { in: nodeIds } },
        select: { knowledgeNodeId: true, role: true },
      }),
    ]);

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const snapshotByNode = new Map<string, (typeof snapshots)[number]>();
    for (const snapshot of snapshots) {
      if (!snapshotByNode.has(snapshot.knowledgeNodeId)) snapshotByNode.set(snapshot.knowledgeNodeId, snapshot);
    }
    const masteryByNode = new Map(masteryRows.map((row) => [row.knowledgeNodeId, row]));

    const prerequisitesByNode = new Map<string, string[]>();
    for (const relation of relations) {
      const list = prerequisitesByNode.get(relation.toId) ?? [];
      list.push(relation.fromId);
      prerequisitesByNode.set(relation.toId, list);
    }

    const chainInputs: ShadowChainNodeInput[] = [];
    for (const row of masteryRows) {
      const node = nodeById.get(row.knowledgeNodeId);
      if (!node) continue;
      const snapshot = snapshotByNode.get(row.knowledgeNodeId) ?? null;
      const replay = replayByNode.get(row.knowledgeNodeId) ?? null;

      const prerequisites = prerequisitesByNode.get(row.knowledgeNodeId) ?? [];
      const prerequisiteReadiness = prerequisites.length > 0
        ? Math.round(
            (prerequisites.reduce((sum, id) => sum + (masteryByNode.get(id)?.mastery ?? 0), 0) / prerequisites.length) * 10000,
          ) / 10000
        : null;

      const difficulty = Number(node.difficulty) || 3;
      const action = classifyAction(
        {
          recentWrongCount: row.wrongCount,
          forgetting: 1 - (row.retention ?? 0.5),
          mastery: row.mastery,
          recentAccuracy: row.recentAccuracy,
        } as never,
        resolveDaysToExam(user as { remainingDays?: number | null } | null),
      );

      chainInputs.push({
        knowledgeNodeId: row.knowledgeNodeId,
        title: node.name,
        observed: {
          mastery: row.mastery,
          accuracy: row.accuracy,
          recentAccuracy: row.recentAccuracy,
          attempts: row.attempts,
          correctCount: row.correctCount,
          wrongCount: row.wrongCount,
          confidence: row.confidence,
          retention: row.retention,
          stabilityDays: row.stabilityDays,
          lastReviewedAt: row.lastReviewedAt ? row.lastReviewedAt.toISOString() : null,
          pinned: row.pinned,
        },
        unified: replay?.replay.replayState
          ? toMasteryState(replay.replay.replayState)
          : null,
        evidence: toExamEvidence(node, snapshot),
        prerequisites,
        trainingCostMinutes: estimateMinutes(action, difficulty),
        primaryScore5y: snapshot ? snapshot.primaryScore5y : null,
        evidenceConfidence: snapshot ? (snapshot.evidenceConfidence as 'HIGH' | 'MEDIUM' | 'LOW') : 'LOW',
        everSucceeded: row.correctCount > 0,
        prerequisiteReadiness,
        trigger: replay?.trigger ?? null,
      });
    }

    void questionLinks;

    const chain = buildShadowDecisionChain({
      userId,
      now: assembly.asOf.toISOString(),
      daysToExam: resolveDaysToExam(user as { remainingDays?: number | null } | null),
      availableMinutes: 120,
      goal: {
        stage: null,
        targetScore: (user as { targetScore?: number | null } | null)?.targetScore ?? null,
        currentScore: null,
        remainingDays: null,
        dailyHours: null,
      },
      reviewSummary: { dueCount: 0, overdueCount: 0 },
      nodes: chainInputs,
      maxItems: clampMaxItems(options.maxItems),
    });

    return {
      ...chain,
      windowDays: assembly.windowDays,
      shadowModel: options.shadowModel ?? 'production',
      source: 'derived',
    };
  }
}

function toMasteryState(state: {
  mastery: number;
  accuracy: number;
  recentAccuracy: number;
  attempts: number;
  correctCount: number;
  wrongCount: number;
  confidence: number;
}): MasteryState {
  return {
    mastery: state.mastery,
    accuracy: state.accuracy,
    recentAccuracy: state.recentAccuracy,
    attempts: state.attempts,
    correctCount: state.correctCount,
    wrongCount: state.wrongCount,
    confidence: state.confidence,
  };
}

/**
 * Content evidence for the priority primitive. A node with no frequency
 * snapshot degrades to neutral evidence with LOW confidence — the same honest
 * degradation the production engine applies, not a zero-importance claim.
 */
function toExamEvidence(
  node: { id: string; subject: string; importance: number; difficulty: number },
  snapshot: {
    recent3Frequency: number;
    recent5Frequency: number;
    allTimeEvidence: number;
    primaryScore5y: number;
    trendDirection: string;
    trendDelta: number;
    evidenceConfidence: string;
  } | null,
): RecommendationExamEvidence {
  if (!snapshot) {
    return {
      subject: node.subject,
      importance: node.importance,
      difficulty: Number(node.difficulty) || 3,
      recent3Y: { frequency: 0 },
      recent5Y: { frequency: 0 },
      allTimeEvidence: { frequency: 0 },
      trend: { direction: 'STABLE', delta: 0 },
      evidenceConfidence: 'LOW',
    };
  }
  return {
    subject: node.subject,
    importance: node.importance,
    difficulty: Number(node.difficulty) || 3,
    recent3Y: { frequency: snapshot.recent3Frequency },
    recent5Y: { frequency: snapshot.recent5Frequency, primaryScore: snapshot.primaryScore5y },
    allTimeEvidence: { frequency: snapshot.allTimeEvidence },
    trend: {
      direction: snapshot.trendDirection as never,
      delta: snapshot.trendDelta,
    },
    evidenceConfidence: snapshot.evidenceConfidence as never,
  };
}

/** Days to the exam, mirroring the production source of truth: User.remainingDays, else 96. */
function resolveDaysToExam(user: { remainingDays?: number | null } | null): number {
  const remaining = user?.remainingDays;
  if (typeof remaining !== 'number' || !Number.isFinite(remaining)) return DAYS_FALLBACK;
  return Math.max(0, Math.round(remaining));
}

function clampMaxItems(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return DEFAULT_MAX_ITEMS;
  return Math.min(Math.floor(value), 30);
}
