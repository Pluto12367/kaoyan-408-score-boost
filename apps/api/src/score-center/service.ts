import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  ExamEvidence,
  MasteryState,
  PriorityCandidate,
  PriorityReasonCode,
  RecommendationAction,
  UserKnowledgeState,
} from '@kaoyan408/shared';
import {
  calculatePriority,
  composeDailyPlan,
  estimateRetention,
  updateMasteryAfterAttempt,
  updateStabilityAfterReview,
} from '@kaoyan408/shared';
import { PrismaService } from '../prisma/prisma.service';
import { todayKey } from '../study/study-date';
import {
  archiveScoreCenterPlans,
  createScoreCenterPlan,
  loadActiveKnowledgeNodes,
  loadEvidenceNodes,
  loadKnowledgeDetail,
  loadKnowledgeRelations,
  loadLatestFrequencySnapshots,
  loadMasteries,
  loadMasteryRow,
  loadTodayScoreCenterPlan,
  neutralMastery,
  resolveKnowledgeNodesForQuestion,
  resolveWrongQuestion,
  saveMastery,
  touchWrongQuestion,
  type AttemptFact,
  type DbClient,
} from './repository';

const MODEL_VERSION = 'score-center-v1';
const ACTION_LABELS: Record<RecommendationAction, string> = {
  LEARN: '新学',
  REVIEW: '复习',
  PRACTICE: '练习',
  WRONG_QUESTION: '错题重做',
  MOCK: '模拟测试',
};

function clampDifficulty(value: number): 1 | 2 | 3 | 4 | 5 {
  return Math.min(5, Math.max(1, Math.round(value))) as 1 | 2 | 3 | 4 | 5;
}

function priorityLabel(score: number): string {
  if (score >= 70) return '高';
  if (score >= 45) return '中';
  return '低';
}

function toMasteryState(row: {
  mastery: number;
  accuracy: number;
  recentAccuracy: number;
  attempts: number;
  correctCount: number;
  wrongCount: number;
  confidence: number;
}): MasteryState {
  return {
    mastery: row.mastery,
    accuracy: row.accuracy,
    recentAccuracy: row.recentAccuracy,
    attempts: row.attempts,
    correctCount: row.correctCount,
    wrongCount: row.wrongCount,
    confidence: row.confidence,
  };
}

@Injectable()
export class ScoreCenterService {
  constructor(private readonly prisma: PrismaService) {}

  get enabled() {
    return Boolean(process.env.DATABASE_URL);
  }

  async applyAttempts(userId: string, records: AttemptFact[], tx?: Prisma.TransactionClient) {
    if (!this.enabled) return;
    const db: DbClient = tx ?? this.prisma;
    for (const record of records) {
      await this.applySingleAttempt(db, userId, record);
    }
  }

  private async applySingleAttempt(db: DbClient, userId: string, record: AttemptFact) {
    const submittedAt = new Date(record.submittedAt);
    const tags = await resolveKnowledgeNodesForQuestion(db, record.questionId);
    if (tags.length === 0) return;
    const nodes = await loadActiveKnowledgeNodes(
      db,
      tags.map((tag) => tag.knowledgeNodeId),
    );
    const nodeById = new Map(nodes.map((node) => [node.id, node]));

    for (const tag of tags) {
      const node = nodeById.get(tag.knowledgeNodeId);
      if (!node) continue;
      const row = await loadMasteryRow(db, userId, node.id);
      const current = row ? toMasteryState(row) : neutralMastery();
      const next = updateMasteryAfterAttempt(current, {
        isCorrect: record.correct,
        difficulty: clampDifficulty(node.difficulty),
        role: tag.role,
      });
      await saveMastery(db, userId, node.id, {
        ...next,
        lastLearnedAt: submittedAt,
      });
    }

    if (!record.correct) {
      await touchWrongQuestion(db, userId, record.questionId, submittedAt);
    }
  }

  async applyReview(
    userId: string,
    questionId: string,
    input: { reviewedAt: Date; redoCorrect: boolean },
  ) {
    if (!this.enabled) return;
    await this.prisma.$transaction(async (tx) => {
      const tags = await resolveKnowledgeNodesForQuestion(tx, questionId);
      const nodes = await loadActiveKnowledgeNodes(
        tx,
        tags.map((tag) => tag.knowledgeNodeId),
      );
      const nodeById = new Map(nodes.map((node) => [node.id, node]));
      for (const tag of tags) {
        const node = nodeById.get(tag.knowledgeNodeId);
        if (!node) continue;
        const row = await loadMasteryRow(tx, userId, node.id);
        const current = row ? toMasteryState(row) : neutralMastery();
        const stabilityDays = updateStabilityAfterReview(
          row?.stabilityDays ?? null,
          input.redoCorrect ? 4 : 2,
        );
        const retention = 1;
        const nextReviewAt = new Date(input.reviewedAt.getTime() + stabilityDays * 86_400_000);
        await saveMastery(tx, userId, node.id, {
          ...current,
          retention,
          stabilityDays,
          lastReviewedAt: input.reviewedAt,
          nextReviewAt,
        });
      }
      if (input.redoCorrect) {
        await resolveWrongQuestion(tx, userId, questionId, input.reviewedAt);
      }
    });
  }

  async getKnowledgeDetail(userId: string, knowledgePointId: string) {
    const node = await loadKnowledgeDetail(this.prisma, knowledgePointId);
    if (!node) return null;
    const mastery = await loadMasteryRow(this.prisma, userId, knowledgePointId);
    return {
      knowledgePoint: {
        id: node.id,
        name: node.name,
        subject: node.subject,
        nodeType: node.nodeType,
        importance: node.importance,
        difficulty: node.difficulty,
        syllabusVersion: node.syllabusVersion,
        isActive: node.isActive,
      },
      frequency: node.frequency[0]
        ? {
            snapshotDate: node.frequency[0].snapshotDate,
            recent3Frequency: node.frequency[0].recent3Frequency,
            recent5Frequency: node.frequency[0].recent5Frequency,
            allTimeEvidence: node.frequency[0].allTimeEvidence,
            primaryScore5y: node.frequency[0].primaryScore5y,
            trendDirection: node.frequency[0].trendDirection,
            trendDelta: node.frequency[0].trendDelta,
            evidenceConfidence: node.frequency[0].evidenceConfidence,
            modelVersion: node.frequency[0].modelVersion,
          }
        : null,
      relations: {
        prerequisites: node.outgoing
          .filter((relation) => relation.type === 'PREREQUISITE')
          .map((relation) => ({ knowledgeNodeId: relation.toId })),
        related: node.outgoing
          .filter((relation) => relation.type === 'RELATED')
          .map((relation) => ({ knowledgeNodeId: relation.toId })),
        prerequisiteOf: node.incoming
          .filter((relation) => relation.type === 'PREREQUISITE')
          .map((relation) => ({ knowledgeNodeId: relation.fromId })),
      },
      userState: mastery
        ? {
            mastery: mastery.mastery,
            accuracy: mastery.accuracy,
            recentAccuracy: mastery.recentAccuracy,
            attempts: mastery.attempts,
            correctCount: mastery.correctCount,
            wrongCount: mastery.wrongCount,
            retention: mastery.retention,
            stabilityDays: mastery.stabilityDays,
            lastLearnedAt: mastery.lastLearnedAt,
            lastReviewedAt: mastery.lastReviewedAt,
            nextReviewAt: mastery.nextReviewAt,
            confidence: mastery.confidence,
            pinned: mastery.pinned,
          }
        : null,
    };
  }

  async generateDailyPlan(
    userId: string,
    input: { targetExamDate: Date; availableMinutes: 30 | 60 | 120 | 180 },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const scheduledDate = todayKey();
    const daysToExam = Math.max(
      0,
      Math.ceil((startOfDay(input.targetExamDate).getTime() - Date.now()) / 86_400_000),
    );

    const [nodes, snapshots, masteries, relations] = await Promise.all([
      loadEvidenceNodes(this.prisma),
      loadLatestFrequencySnapshots(this.prisma),
      loadMasteries(this.prisma, userId),
      loadKnowledgeRelations(this.prisma),
    ]);
    const snapshotByNode = new Map(snapshots.map((snapshot) => [snapshot.knowledgeNodeId, snapshot]));
    const masteryByNode = new Map(masteries.map((mastery) => [mastery.knowledgeNodeId, mastery]));
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const prerequisiteByNode = new Map<string, string[]>();
    const prerequisiteMastery: Record<string, number> = {};
    for (const relation of relations) {
      const list = prerequisiteByNode.get(relation.fromId) ?? [];
      list.push(relation.toId);
      prerequisiteByNode.set(relation.fromId, list);
    }

    const candidates: PriorityCandidate[] = [];
    const breakdownByNode = new Map<string, Record<string, number>>();
    for (const node of nodes) {
      const snapshot = snapshotByNode.get(node.id);
      if (!snapshot) continue;
      const mastery = masteryByNode.get(node.id);
      const userState: UserKnowledgeState | undefined = mastery
        ? {
            ...toMasteryState(mastery),
            retention: mastery.retention,
            pinned: mastery.pinned,
          }
        : undefined;
      const evidence: ExamEvidence = {
        knowledgePointId: node.id,
        importance: node.importance,
        difficulty: node.difficulty,
        recent3Y: { frequency: snapshot.recent3Frequency },
        recent5Y: {
          frequency: snapshot.recent5Frequency,
          primaryScore: snapshot.primaryScore5y,
        },
        allTimeEvidence: { frequency: snapshot.allTimeEvidence },
        trend: { direction: snapshot.trendDirection, delta: snapshot.trendDelta },
        evidenceConfidence: snapshot.evidenceConfidence,
      };
      const priority = calculatePriority(evidence, userState, { daysToExam });
      breakdownByNode.set(node.id, priority.breakdown);
      const prerequisites = prerequisiteByNode.get(node.id) ?? [];
      for (const prerequisiteId of prerequisites) {
        const prerequisiteMasteryValue = masteryByNode.get(prerequisiteId)?.mastery;
        if (prerequisiteMasteryValue != null) {
          prerequisiteMastery[prerequisiteId] = prerequisiteMasteryValue;
        }
      }
      candidates.push({
        knowledgePointId: node.id,
        subject: node.subject,
        difficulty: node.difficulty,
        mastery: userState?.mastery ?? 0.5,
        recentAccuracy: userState?.recentAccuracy ?? 0.55,
        recentWrongCount: userState?.wrongCount ?? 0,
        forgetting: userState?.retention != null ? Math.max(0, 1 - userState.retention) : 0.5,
        retention: mastery?.retention ?? null,
        lastReviewedAt: mastery?.lastReviewedAt ?? null,
        score: priority.score,
        reasonCodes: priority.reasons,
        prerequisites,
        pinned: mastery?.pinned ?? false,
      });
    }

    const drafts = composeDailyPlan({
      candidates,
      availableMinutes: input.availableMinutes,
      daysToExam,
      prerequisiteMastery,
    });

    const plan = await this.prisma.$transaction(async (tx) => {
      await archiveScoreCenterPlans(tx, userId);
      return createScoreCenterPlan(
        tx,
        userId,
        {
          targetScore: user?.targetScore ?? 115,
          remainingDays: user?.remainingDays ?? daysToExam,
          dailyHours: user?.dailyHours ?? 3.5,
          modelVersion: MODEL_VERSION,
          targetExamDate: input.targetExamDate,
          availableMinutes: input.availableMinutes,
          scheduledDate,
        },
        drafts.map((draft, index) => {
          const node = nodeById.get(draft.knowledgePointId);
          return {
            knowledgePointId: draft.knowledgePointId,
            knowledgeNodeId: draft.knowledgePointId,
            subject: node?.subject ?? '',
            chapter: '',
            title: node?.name ?? draft.knowledgePointId,
            mode: ACTION_LABELS[draft.action],
            minutes: draft.estimatedMinutes,
            questionCount: draft.action === 'MOCK' ? 30 : 8,
            scheduledDate,
            priority: priorityLabel(draft.score),
            reason: draft.reasonCodes.join('、'),
            nextAction: ACTION_LABELS[draft.action],
            status: 'pending',
            priorityScore: draft.score,
            recommendationAction: draft.action,
            reasonCodes: draft.reasonCodes as unknown as Prisma.InputJsonValue,
            scoreBreakdown: breakdownByNode.get(draft.knowledgePointId) ?? {},
            generatedRank: index + 1,
          };
        }),
      );
    });

    return this.toPlanDto(plan);
  }

  async getTodayScoreCenterPlan(userId: string) {
    const plan = await loadTodayScoreCenterPlan(this.prisma, userId, todayKey());
    return plan ? this.toPlanDto(plan) : null;
  }

  async completeTask(
    taskId: string,
    userId: string,
    input: { completedQuestionCount?: number; correctCount?: number; minutesSpent?: number },
  ) {
    if (!this.enabled) return null;
    const plan = await this.prisma.studyPlan.findFirst({
      where: { userId, source: 'score-center', status: 'ACTIVE' },
      include: { tasks: { where: { id: taskId } } },
    });
    if (!plan?.tasks[0]) return null;
    const completedAt = new Date();
    await this.prisma.studyTask.update({
      where: { id: taskId },
      data: { status: 'completed', completed: true, completedAt },
    });
    return { taskId, status: 'completed', completedAt: completedAt.toISOString() };
  }

  private toPlanDto(plan: {
    id: string;
    userId: string;
    createdAt: Date;
    modelVersion: string | null;
    targetExamDate: Date | null;
    availableMinutes: number | null;
    stale: boolean;
    tasks: Array<{
      id: string;
      knowledgeNodeId: string | null;
      knowledgePointId: string;
      subject: string;
      title: string;
      minutes: number;
      priorityScore: number | null;
      recommendationAction: string | null;
      reasonCodes: Prisma.JsonValue;
      scoreBreakdown: Prisma.JsonValue;
      generatedRank: number | null;
      status: string;
    }>;
  }) {
    return {
      id: plan.id,
      userId: plan.userId,
      generatedAt: plan.createdAt.toISOString(),
      modelVersion: plan.modelVersion,
      targetExamDate: plan.targetExamDate?.toISOString() ?? null,
      availableMinutes: plan.availableMinutes,
      stale: plan.stale,
      summary: {
        totalTasks: plan.tasks.length,
        totalMinutes: plan.tasks.reduce((sum, task) => sum + task.minutes, 0),
      },
      items: plan.tasks.map((task) => ({
        id: task.id,
        knowledgeNodeId: task.knowledgeNodeId,
        knowledgePointId: task.knowledgePointId,
        subject: task.subject,
        title: task.title,
        score: task.priorityScore,
        action: task.recommendationAction,
        estimatedMinutes: task.minutes,
        reasonCodes: (task.reasonCodes ?? []) as PriorityReasonCode[],
        scoreBreakdown: task.scoreBreakdown ?? {},
        rank: task.generatedRank,
        status: task.status,
      })),
    };
  }
}

function startOfDay(date: Date): Date {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}
