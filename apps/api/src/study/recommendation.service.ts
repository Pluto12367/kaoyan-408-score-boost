import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { RecommendationInput } from '@kaoyan408/shared';
import { calculatePriority, runRecommendation } from '@kaoyan408/shared';
import { PrismaService } from '../prisma/prisma.service';
import { todayKey } from './study-date';
import {
  archiveScoreCenterPlans,
  createScoreCenterPlan,
  loadEvidenceNodes,
  loadKnowledgeRelations,
  loadLatestFrequencySnapshots,
  loadMasteries,
  neutralMastery,
} from '../score-center/repository';

// Sprint 3.2：Daily Plan Integration。
// 职责边界（契约见 docs/sprint3-recommendation-contract.md）：
// - 组装 RecommendationInput（学生事实 ← UserKnowledgeMastery/User/ReviewSchedule；
//   内容事实 ← loadEvidenceNodes/loadLatestFrequencySnapshots/loadKnowledgeRelations）
// - 调用 shared runRecommendation（禁止自行实现 priority/classifyAction/composeDailyPlan）
// - TASK_DRAFT → StudyPlan/StudyTask 持久化（归档+重建事务，与 legacy 逐字段一致）
// 依赖方向：ScoreCenterService / StudyService → 本服务 → shared 引擎；本服务不依赖 StudyService。

const MODEL_VERSION = 'score-center-v1';

// 学生目标事实（来自 User 行，字段名对齐 schema：stage ← studyStage）
interface UserGoalFacts {
  targetScore: number | null;
  currentScore: number | null;
  remainingDays: number | null;
  dailyHours: number | null;
  stage: string | null;
}

const ACTION_LABELS: Record<string, string> = {
  LEARN: '新学',
  REVIEW: '复习',
  PRACTICE: '练习',
  WRONG_QUESTION: '错题重做',
  MOCK: '模拟测试',
};

function priorityLabel(score: number): string {
  if (score >= 70) return '高';
  if (score >= 45) return '中';
  return '低';
}

function clampDifficulty(value: number): 1 | 2 | 3 | 4 | 5 {
  return Math.min(5, Math.max(1, Math.round(value))) as 1 | 2 | 3 | 4 | 5;
}

function startOfDay(date: Date): Date {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function startOfUtcDay(date: Date): Date {
  const value = new Date(date);
  value.setUTCHours(0, 0, 0, 0);
  return value;
}

@Injectable()
export class RecommendationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 组装契约输入并运行引擎（不持久化）。Sprint 3.3/3.4 的复用入口。
   * 候选宇宙与 legacy generateDailyPlan 一致：仅纳入有最新考频快照的活跃原子节点。
   */
  async runRecommendationForUser(
    userId: string,
    options: { availableMinutes: 30 | 60 | 120 | 180; targetExamDate?: Date; now?: Date } = { availableMinutes: 60 },
  ): Promise<{
    result: ReturnType<typeof runRecommendation>;
    nodeById: Map<string, { id: string; name: string; subject: string; importance: number; difficulty: number }>;
    breakdownByNode: Map<string, Record<string, number>>;
    user: UserGoalFacts | null;
    daysToExam: number;
  }> {
    const now = options.now ?? new Date();
    const [user, nodes, snapshots, masteries, relations] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      loadEvidenceNodes(this.prisma),
      loadLatestFrequencySnapshots(this.prisma),
      loadMasteries(this.prisma, userId),
      loadKnowledgeRelations(this.prisma),
    ]);

    const snapshotByNode = new Map(snapshots.map((snapshot) => [snapshot.knowledgeNodeId, snapshot]));
    const masteryByNode = new Map(masteries.map((mastery) => [mastery.knowledgeNodeId, mastery]));
    const nodeById = new Map(nodes.map((node) => [node.id, node]));

    const daysToExam = options.targetExamDate
      ? Math.max(0, Math.ceil((startOfDay(options.targetExamDate).getTime() - now.getTime()) / 86_400_000))
      : Math.max(0, user?.remainingDays ?? 96);

    const prerequisites: Record<string, string[]> = {};
    for (const relation of relations) {
      const list = prerequisites[relation.fromId] ?? [];
      list.push(relation.toId);
      prerequisites[relation.fromId] = list;
    }

    // 候选宇宙：有考频快照的节点（契约 §3 退化规则在此不触发——与 legacy 过滤一致）
    const nodeStates = [];
    const evidence: Record<string, NonNullable<ReturnType<typeof buildEvidence>>> = {};
    const prerequisitesInUniverse: Record<string, string[]> = {};
    const prerequisiteMastery: Record<string, number> = {};

    for (const node of nodes) {
      const snapshot = snapshotByNode.get(node.id);
      if (!snapshot) continue;
      const masteryRow = masteryByNode.get(node.id);
      const base = masteryRow
        ? {
            mastery: masteryRow.mastery,
            accuracy: masteryRow.accuracy,
            recentAccuracy: masteryRow.recentAccuracy,
            attempts: masteryRow.attempts,
            correctCount: masteryRow.correctCount,
            wrongCount: masteryRow.wrongCount,
          }
        : neutralMastery();
      nodeStates.push({
        knowledgeNodeId: node.id,
        ...base,
        retention: masteryRow?.retention ?? null,
        stabilityDays: masteryRow?.stabilityDays ?? null,
        lastReviewedAt: masteryRow?.lastReviewedAt?.toISOString() ?? null,
        pinned: masteryRow?.pinned ?? false,
      });
      evidence[node.id] = buildEvidence(node, snapshot);
      const nodePrerequisites = (prerequisites[node.id] ?? []).filter((id) => nodeById.has(id));
      if (nodePrerequisites.length > 0) prerequisitesInUniverse[node.id] = nodePrerequisites;
    }
    for (const [nodeId, nodePrerequisites] of Object.entries(prerequisitesInUniverse)) {
      for (const prerequisiteId of nodePrerequisites) {
        const masteryValue = masteryByNode.get(prerequisiteId)?.mastery;
        if (masteryValue != null) prerequisiteMastery[prerequisiteId] = masteryValue;
      }
    }

    const input: RecommendationInput = {
      meta: { userId, now: now.toISOString(), generatedAt: now.toISOString() },
      student: {
        goal: {
          stage: user?.studyStage ?? null,
          targetScore: user?.targetScore ?? null,
          currentScore: user?.currentScore ?? null,
          remainingDays: user?.remainingDays ?? null,
          dailyHours: user?.dailyHours ?? null,
        },
        nodeStates,
        reviewSummary: await this.getReviewSummary(userId, now),
      },
      content: { evidence, prerequisites: prerequisitesInUniverse, prerequisiteMastery },
      config: { availableMinutes: options.availableMinutes, daysToExam },
    };

    const result = runRecommendation(input);
    // scoreBreakdown 持久化需要逐节点 breakdown（引擎 items 契约不含 breakdown，
    // 复用 calculatePriority 重算——同输入确定性成立）。
    const breakdownByNode = new Map<string, Record<string, number>>();
    for (const nodeState of nodeStates) {
      const nodeEvidence = evidence[nodeState.knowledgeNodeId];
      breakdownByNode.set(
        nodeState.knowledgeNodeId,
        calculatePriority(
          { ...nodeEvidence, knowledgePointId: nodeState.knowledgeNodeId },
          toUserKnowledgeState(nodeState),
          { daysToExam },
        ).breakdown,
      );
    }

    return { result, nodeById, breakdownByNode, user: user ? {
      targetScore: user.targetScore,
      currentScore: user.currentScore,
      remainingDays: user.remainingDays,
      dailyHours: user.dailyHours,
      stage: user.studyStage,
    } : null, daysToExam };
  }

  /**
   * Sprint 3.2：generateDailyPlan 的新计算路径。
   * 返回持久化后的 StudyPlan（含 tasks），响应 DTO 由调用方 toPlanDto 负责。
   */
  async generateDailyPlanFromState(
    userId: string,
    input: { targetExamDate: Date; availableMinutes: 30 | 60 | 120 | 180 },
  ): Promise<PrismaValidationPlan> {
    const { result, nodeById, breakdownByNode, user, daysToExam } = await this.runRecommendationForUser(userId, {
      availableMinutes: input.availableMinutes,
      targetExamDate: input.targetExamDate,
    });

    const taskDrafts = result.items.filter((item) => item.kind === 'TASK_DRAFT');
    const enrichedTasks = taskDrafts.map((draft, index) => {
      const node = nodeById.get(draft.knowledgeNodeId);
      return {
        knowledgePointId: draft.knowledgeNodeId,
        knowledgeNodeId: draft.knowledgeNodeId,
        subject: node?.subject ?? '',
        chapter: '',
        title: node?.name ?? draft.knowledgeNodeId,
        mode: ACTION_LABELS[draft.action] ?? draft.action,
        minutes: draft.estimatedMinutes,
        questionCount: draft.action === 'MOCK' ? 30 : 8,
        scheduledDate: todayKey(),
        priority: priorityLabel(draft.score),
        reason: draft.reasonCodes.join('、'),
        nextAction: ACTION_LABELS[draft.action] ?? draft.action,
        status: 'pending',
        priorityScore: draft.score,
        recommendationAction: draft.action,
        reasonCodes: draft.reasonCodes as unknown as Prisma.InputJsonValue,
        scoreBreakdown: (breakdownByNode.get(draft.knowledgeNodeId) ?? {}) as Prisma.InputJsonValue,
        generatedRank: index + 1,
      };
    });

    return this.prisma.$transaction(async (tx) => {
      await archiveScoreCenterPlans(tx, userId);
      return createScoreCenterPlan(tx, userId, {
        targetScore: user?.targetScore ?? 115,
        remainingDays: user?.remainingDays ?? daysToExam,
        dailyHours: user?.dailyHours ?? 3.5,
        modelVersion: MODEL_VERSION,
        targetExamDate: input.targetExamDate,
        availableMinutes: input.availableMinutes,
        scheduledDate: todayKey(),
      }, enrichedTasks);
    });
  }

  private async getReviewSummary(userId: string, now: Date): Promise<{ dueCount: number; overdueCount: number }> {
    const [dueCount, overdueCount] = await Promise.all([
      this.prisma.reviewSchedule.count({ where: { userId, nextReviewAt: { lte: now } } }),
      this.prisma.reviewSchedule.count({ where: { userId, nextReviewAt: { lt: startOfUtcDay(now) } } }),
    ]);
    return { dueCount, overdueCount };
  }
}

function buildEvidence(
  node: { id: string; subject: string; importance: number; difficulty: number },
  snapshot: Awaited<ReturnType<typeof loadLatestFrequencySnapshots>>[number],
) {
  return {
    subject: node.subject,
    importance: node.importance,
    difficulty: node.difficulty,
    recent3Y: { frequency: snapshot.recent3Frequency },
    recent5Y: { frequency: snapshot.recent5Frequency, primaryScore: snapshot.primaryScore5y },
    allTimeEvidence: { frequency: snapshot.allTimeEvidence },
    trend: { direction: snapshot.trendDirection, delta: snapshot.trendDelta ?? 0 },
    evidenceConfidence: snapshot.evidenceConfidence,
  };
}

function toUserKnowledgeState(nodeState: {
  mastery: number;
  accuracy: number;
  recentAccuracy: number;
  attempts: number;
  correctCount: number;
  wrongCount: number;
  retention: number | null;
  pinned: boolean;
}) {
  return {
    mastery: nodeState.mastery,
    accuracy: nodeState.accuracy,
    recentAccuracy: nodeState.recentAccuracy,
    attempts: nodeState.attempts,
    correctCount: nodeState.correctCount,
    wrongCount: nodeState.wrongCount,
    confidence: nodeState.attempts > 0 ? Math.min(1, 1 - Math.exp(-nodeState.attempts / 12)) : 0,
    retention: nodeState.retention,
    pinned: nodeState.pinned,
  };
}

// createScoreCenterPlan 的返回类型（Prisma StudyPlan + tasks），以结构别名表达
type PrismaValidationPlan = Awaited<ReturnType<typeof createScoreCenterPlan>>;
