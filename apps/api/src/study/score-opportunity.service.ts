/**
 * V12-M4 — Score Opportunity shadow (read-only assembly).
 *
 * Answers "with limited time right now, which weak point is most worth
 * training?" by itemising every factor behind the number. It does NOT
 * re-implement the recommendation engine's exam-frequency formula: the engine
 * remains the authoritative ranking, and this shadow adds the dimension the
 * audit found missing — recoverability and benefit per unit time.
 *
 * examImportance reuses the snapshot's own primaryScore5y (a real 5-year score
 * field) normalised within the candidate set, rather than inventing a second
 * frequency blend. Training cost reuses the production estimateMinutes /
 * classifyAction so the cost figure is the same one the planner uses.
 *
 * Read-only. Writes nothing, emits nothing. Every row is NON-AUTHORITATIVE.
 */

import { Injectable, Optional } from '@nestjs/common';
import {
  buildScoreOpportunity,
  classifyAction,
  estimateMinutes,
  type FactorConfidence,
  type OpportunityFactorKey,
  type ScoreOpportunity,
} from '@kaoyan408/shared';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_TOP = 10;
const MAX_TOP = 50;
const MAX_CANDIDATES = 400;
const DAYS_FALLBACK = 120;

export interface ScoreOpportunityShadowResult {
  readonly generatedAt: string;
  readonly authoritative: false;
  readonly opportunities: readonly ScoreOpportunity[];
  readonly summary: {
    readonly candidatesEvaluated: number;
    readonly scored: number;
    readonly blocked: number;
    readonly blockedByFactor: Readonly<Partial<Record<OpportunityFactorKey, number>>>;
    readonly confidenceMix: Readonly<Partial<Record<FactorConfidence, number>>>;
    readonly basis: string;
  };
  readonly source: 'derived';
}

@Injectable()
export class ScoreOpportunityService {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  get enabled(): boolean {
    return Boolean(process.env.DATABASE_URL && this.prisma);
  }

  /** null = store unavailable (honestly absent, never an empty ranking). */
  async getOpportunities(
    userId: string,
    options: { top?: number } = {},
  ): Promise<ScoreOpportunityShadowResult | null> {
    if (!this.enabled) return null;
    const db = this.prisma!;
    const top = clampTop(options.top);
    const asOf = new Date();

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { targetScore: true, examDate: true } as never,
    }).catch(() => null);
    const daysToExam = resolveDaysToExam(user as { examDate?: Date | null } | null);

    const snapshots = await this.loadLatestSnapshots(db);
    if (snapshots.size === 0) {
      return emptyResult();
    }

    const [masteries, nodes, relations] = await Promise.all([
      db.userKnowledgeMastery.findMany({
        where: { userId, knowledgeNodeId: { in: [...snapshots.keys()] } },
        select: {
          knowledgeNodeId: true,
          mastery: true,
          recentAccuracy: true,
          correctCount: true,
          retention: true,
        },
      }),
      db.knowledgeNode.findMany({
        where: { id: { in: [...snapshots.keys()] } },
        select: { id: true, name: true, difficulty: true },
      }),
      db.knowledgeRelation.findMany({
        where: { toId: { in: [...snapshots.keys()] }, type: 'PREREQUISITE' },
        select: { fromId: true, toId: true },
      }),
    ]);

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const masteryByNode = new Map(masteries.map((row) => [row.knowledgeNodeId, row]));
    const maxPrimaryScore = Math.max(1, ...[...snapshots.values()].map((row) => row.primaryScore5y));

    const prerequisiteOf = new Map<string, string[]>();
    for (const relation of relations) {
      const list = prerequisiteOf.get(relation.toId) ?? [];
      list.push(relation.fromId);
      prerequisiteOf.set(relation.toId, list);
    }

    const opportunities: ScoreOpportunity[] = [];
    for (const [nodeId, snapshot] of snapshots) {
      if (opportunities.length >= MAX_CANDIDATES) break;
      const node = nodeById.get(nodeId);
      if (!node) continue;
      const masteryRow = masteryByNode.get(nodeId) ?? null;

      const weakness = masteryRow ? 1 - masteryRow.mastery : null;
      const examImportance = snapshot.primaryScore5y > 0
        ? snapshot.primaryScore5y / maxPrimaryScore
        : null;
      const prerequisiteReadiness = readinessOf(nodeId, prerequisiteOf, masteryByNode);
      const difficulty = Number(node.difficulty) || 3;
      const action = classifyAction(
        {
          recentWrongCount: 0,
          forgetting: masteryRow ? 1 - (masteryRow.retention ?? 0.5) : 0,
          mastery: masteryRow?.mastery ?? 0.5,
          recentAccuracy: masteryRow?.recentAccuracy ?? 0.55,
        } as never,
        daysToExam,
      );

      opportunities.push(
        buildScoreOpportunity({
          nodeId,
          title: node.name,
          weakness,
          examImportance,
          evidenceConfidence: snapshot.evidenceConfidence,
          daysToExam,
          retentionNow: masteryRow?.retention ?? null,
          everSucceeded: masteryRow ? masteryRow.correctCount > 0 : null,
          prerequisiteReadiness,
          trainingCostMinutes: estimateMinutes(action, difficulty),
        }),
      );
    }

    const scored = opportunities.filter((row) => row.score != null);
    scored.sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
    const blocked = opportunities.length - scored.length;

    const blockedByFactor: Partial<Record<OpportunityFactorKey, number>> = {};
    for (const row of opportunities) {
      for (const key of row.blockedBy) blockedByFactor[key] = (blockedByFactor[key] ?? 0) + 1;
    }
    const confidenceMix: Partial<Record<FactorConfidence, number>> = {};
    for (const row of scored) {
      confidenceMix[row.confidence] = (confidenceMix[row.confidence] ?? 0) + 1;
    }

    return {
      generatedAt: asOf.toISOString(),
      authoritative: false,
      opportunities: scored.slice(0, top),
      summary: {
        candidatesEvaluated: opportunities.length,
        scored: scored.length,
        blocked,
        blockedByFactor,
        confidenceMix,
        basis: opportunities.length === 0
          ? '没有可评估的知识节点（缺少考频快照或无掌握度数据）。'
          : `评估 ${opportunities.length} 个节点：${scored.length} 个出分、${blocked} 个因缺必需因子拒绝出分。机会分为影子模型，未与真实成绩对照。`,
      },
      source: 'derived',
    };
  }

  /** Latest snapshot per node, mirroring the recommendation engine's selection. */
  private async loadLatestSnapshots(db: PrismaService): Promise<Map<string, {
    primaryScore5y: number;
    evidenceConfidence: 'HIGH' | 'MEDIUM' | 'LOW';
  }>> {
    const rows = await db.knowledgeFrequencySnapshot.findMany({
      orderBy: [{ snapshotDate: 'desc' }, { modelVersion: 'desc' }],
      take: MAX_CANDIDATES,
      select: { knowledgeNodeId: true, primaryScore5y: true, evidenceConfidence: true },
    });
    const map = new Map<string, { primaryScore5y: number; evidenceConfidence: 'HIGH' | 'MEDIUM' | 'LOW' }>();
    for (const row of rows) {
      if (map.has(row.knowledgeNodeId)) continue;
      map.set(row.knowledgeNodeId, {
        primaryScore5y: row.primaryScore5y,
        evidenceConfidence: row.evidenceConfidence as 'HIGH' | 'MEDIUM' | 'LOW',
      });
    }
    return map;
  }
}

/** null when no prerequisite edge is recorded — sparse data must not read as "ready". */
function readinessOf(
  nodeId: string,
  prerequisiteOf: Map<string, string[]>,
  masteryByNode: Map<string, { mastery: number }>,
): number | null {
  const prerequisites = prerequisiteOf.get(nodeId) ?? [];
  if (prerequisites.length === 0) return null;
  const values = prerequisites.map((id) => masteryByNode.get(id)?.mastery ?? 0);
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1000) / 1000;
}

function resolveDaysToExam(user: { examDate?: Date | null } | null): number {
  const examDate = user?.examDate ? new Date(user.examDate) : null;
  if (!examDate || Number.isNaN(examDate.getTime())) return DAYS_FALLBACK;
  return Math.max(0, Math.round((examDate.getTime() - Date.now()) / 86_400_000));
}

function emptyResult(): ScoreOpportunityShadowResult {
  return {
    generatedAt: new Date().toISOString(),
    authoritative: false,
    opportunities: [],
    summary: {
      candidatesEvaluated: 0,
      scored: 0,
      blocked: 0,
      blockedByFactor: {},
      confidenceMix: {},
      basis: '没有考频快照，无法评估任何节点的提分机会——不给出空排名。',
    },
    source: 'derived',
  };
}

function clampTop(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return DEFAULT_TOP;
  return Math.min(Math.floor(value), MAX_TOP);
}
