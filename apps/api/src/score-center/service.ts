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
  buildMasteryTrend,
  calculatePriority,
  composeDailyPlan,
  deriveNodeQuestStatus,
  deriveNodeMasteryStatus,
  estimateRetention,
  QUEST_PASS_THRESHOLD,
  applyMasterySemantics,
  resolveMasterySemantics,
  updateStabilityAfterReview,
} from '@kaoyan408/shared';
import { PrismaService } from '../prisma/prisma.service';
import { todayKey } from '../study/study-date';
import { RecommendationService } from '../study/recommendation.service';
import { toRecommendationTaskCompat } from '../study/recommendation-task.adapter';
import {
  archiveScoreCenterPlans,
  createScoreCenterPlan,
  loadActiveAtomicNodeCatalog,
  loadActiveKnowledgeNodes,
  loadEvidenceNodes,
  loadExamQuestionsForNode,
  loadExamQuestionsForNodes,
  loadKnowledgeDetail,
  loadKnowledgeRelations,
  loadLatestFrequencyForNodes,
  loadLatestFrequencySnapshots,
  loadMasteries,
  loadNodeQuest,
  loadNodeQuests,
  loadMasteryRow,
  loadMasterySnapshots,
  loadNodesWithParents,
  loadRelatedQuestionsForNode,
  loadTodayScoreCenterPlan,
  neutralMastery,
  resolveKnowledgeNodesForQuestion,
  saveMasteryWithOptimisticRetry,
  saveMasterySnapshot,
  saveNodeQuestAttempt,
  touchWrongQuestion,
  type AttemptFact,
  type DbClient,
} from './repository';

const SCORE_SUBJECT_NAME_BY_CODE: Record<string, string> = {
  DS: '数据结构',
  CO: '计算机组成原理',
  OS: '操作系统',
  CN: '计算机网络',
};

/**
 * V12-M3-C — what one review observation did to one knowledge node.
 * `authoritative: true` is deliberate and rare in this codebase: unlike every
 * shadow artefact, this describes a real write to the ability estimate.
 */
export interface ReviewMasteryNodeApplication {
  readonly nodeId: string;
  readonly role: string;
  readonly masteryBefore: number;
  readonly masteryAfter: number;
  readonly masteryDelta: number;
  readonly attemptsAfter: number;
}

export interface ReviewMasteryApplication {
  readonly questionId: string;
  readonly evidenceEventKey: string;
  readonly isCorrect: boolean;
  /** Which audited semantics actually ran ('legacy' unless explicitly opted in). */
  readonly semantics: ReturnType<typeof resolveMasterySemantics>;
  readonly nodes: readonly ReviewMasteryNodeApplication[];
  readonly authoritative: true;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
function clampDifficulty(value: number): 1 | 2 | 3 | 4 | 5 {
  return Math.min(5, Math.max(1, Math.round(value))) as 1 | 2 | 3 | 4 | 5;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly recommendation: RecommendationService,
  ) {}

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
      const saved = await saveMasteryWithOptimisticRetry(db, userId, node.id, (row) => {
        const current = row ? toMasteryState(row) : neutralMastery();
        // M3 Phase-C: the mastery transition is selected by the audited switch.
        // The default is `legacy`, which is bit-identical to the previous
        // direct call, so deploying the switch changes no behaviour until an
        // operator explicitly opts into the approved candidate.
        const next = applyMasterySemantics(resolveMasterySemantics(), current, {
          isCorrect: record.correct,
          difficulty: clampDifficulty(node.difficulty),
          role: tag.role,
        });
        return {
          ...next,
          lastLearnedAt: submittedAt,
        };
      });
      const next = toMasteryState(saved);
      await saveMasterySnapshot(db, userId, node.id, next, startOfUtcDay(submittedAt));
    }

    if (!record.correct) {
      await touchWrongQuestion(db, userId, record.questionId, submittedAt);
    }
  }

  async applyReview(
    userId: string,
    questionId: string,
    input: { reviewedAt: Date; redoCorrect: boolean },
    transaction?: Prisma.TransactionClient,
  ) {
    if (!this.enabled) return;
    const apply = async (tx: Prisma.TransactionClient) => {
      const tags = await resolveKnowledgeNodesForQuestion(tx, questionId);
      const nodes = await loadActiveKnowledgeNodes(
        tx,
        tags.map((tag) => tag.knowledgeNodeId),
      );
      const nodeById = new Map(nodes.map((node) => [node.id, node]));
      for (const tag of tags) {
        const node = nodeById.get(tag.knowledgeNodeId);
        if (!node) continue;
        const saved = await saveMasteryWithOptimisticRetry(tx, userId, node.id, (row) => {
          const current = row ? toMasteryState(row) : neutralMastery();
          const stabilityDays = updateStabilityAfterReview(
            row?.stabilityDays ?? null,
            input.redoCorrect ? 4 : 2,
          );
          const retention = 1;
          const nextReviewAt = new Date(input.reviewedAt.getTime() + stabilityDays * 86_400_000);
          return {
            ...current,
            retention,
            stabilityDays,
            lastReviewedAt: input.reviewedAt,
            nextReviewAt,
          };
        });
        const current = toMasteryState(saved);
        await saveMasterySnapshot(tx, userId, node.id, current, startOfUtcDay(input.reviewedAt));
      }
    };
    if (transaction) await apply(transaction);
    else await this.prisma.$transaction(apply);
  }

  /**
   * V12-M3-C — the authoritative Review → Mastery projection.
   *
   * This is the ONLY path by which a review observation reaches the ability
   * estimate, and it is deliberately NOT reachable from `applyReview` on its own:
   * the caller must already hold a durable evidence receipt for the observation,
   * so the production chain is literally
   *
   *   Review Observation → Evidence Receipt → Evidence Projection → Mastery
   *
   * `applyReview` keeps its existing responsibility (stability / retention /
   * schedule fields) and still never assigns mastery.
   *
   * The transition is the SAME one practice uses — `applyMasterySemantics` with
   * whatever the audited switch resolves — so review and practice share one 口径.
   * With `MASTERY_SEMANTICS` unset that is the legacy production EMA, bit for
   * bit. The C1 direction guard is NOT enabled here and this method does not
   * depend on it: review evidence and the semantics switch are two independent
   * variables by construction.
   */
  async applyReviewObservation(
    userId: string,
    input: {
      questionId: string;
      isCorrect: boolean;
      occurredAt: Date;
      /** The receipt this projection is conditioned on; carried for attribution. */
      evidenceEventKey: string;
    },
    transaction?: Prisma.TransactionClient,
  ): Promise<ReviewMasteryApplication | null> {
    if (!this.enabled) return null;
    const db: DbClient = transaction ?? this.prisma;
    const tags = await resolveKnowledgeNodesForQuestion(db, input.questionId);
    if (tags.length === 0) return null;
    const nodes = await loadActiveKnowledgeNodes(
      db,
      tags.map((tag) => tag.knowledgeNodeId),
    );
    const nodeById = new Map(nodes.map((node) => [node.id, node]));

    const semantics = resolveMasterySemantics();
    const applied: ReviewMasteryNodeApplication[] = [];

    for (const tag of tags) {
      const node = nodeById.get(tag.knowledgeNodeId);
      if (!node) continue;
      // Captured from inside the mutation so it reflects the row the retry loop
      // actually used, not a stale pre-read.
      let before: MasteryState | null = null;
      const saved = await saveMasteryWithOptimisticRetry(db, userId, node.id, (row) => {
        const current = row ? toMasteryState(row) : neutralMastery();
        before = current;
        const next = applyMasterySemantics(semantics, current, {
          isCorrect: input.isCorrect,
          difficulty: clampDifficulty(node.difficulty),
          role: tag.role,
        });
        return {
          ...next,
          lastLearnedAt: input.occurredAt,
        };
      });
      const next = toMasteryState(saved);
      await saveMasterySnapshot(db, userId, node.id, next, startOfUtcDay(input.occurredAt));
      applied.push({
        nodeId: node.id,
        role: tag.role,
        masteryBefore: round6(before ? (before as MasteryState).mastery : next.mastery),
        masteryAfter: round6(next.mastery),
        masteryDelta: round6(next.mastery - (before ? (before as MasteryState).mastery : next.mastery)),
        attemptsAfter: next.attempts,
      });
    }

    return {
      questionId: input.questionId,
      evidenceEventKey: input.evidenceEventKey,
      isCorrect: input.isCorrect,
      semantics,
      nodes: applied,
      authoritative: true,
    };
  }

  async getKnowledgeDetail(userId: string, knowledgePointId: string) {
    const node = await loadKnowledgeDetail(this.prisma, knowledgePointId);
    if (!node) return null;
    const [mastery, relatedQuestions, examQuestions] = await Promise.all([
      loadMasteryRow(this.prisma, userId, knowledgePointId),
      loadRelatedQuestionsForNode(this.prisma, knowledgePointId),
      loadExamQuestionsForNode(this.prisma, knowledgePointId),
    ]);
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
      relatedQuestions: relatedQuestions.map((question) => ({
        id: question.id,
        stem: question.stem,
        type: question.type,
        difficulty: question.difficulty,
        source: question.source,
        year: question.year ?? null,
        expectedTimeSec: question.expectedTimeSec,
      })),
      examQuestions: examQuestions.map((tag) => ({
        id: tag.question.id,
        exam: tag.question.paper.exam,
        year: tag.question.paper.year,
        questionNo: tag.question.questionNo,
        subject: tag.question.subject,
        questionType: tag.question.questionType,
        score: tag.question.score ?? null,
        summary: tag.question.summary ?? null,
        sourceUrl: tag.question.sourceRef ?? tag.question.paper.source ?? null,
      })),
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

  async getWrongQuestionExamLinks(questionId: string) {
    const empty = {
      questionId,
      knowledgeNodes: [],
      frequency: [],
      examHits: [],
      summary: {
        nodeCount: 0,
        totalScore: 0,
        recent3Hits: 0,
        recent5Hits: 0,
        allTimeHits: 0,
        maxImportance: 0,
        maxDifficulty: 0,
      },
    };
    if (!this.enabled) return empty;
    const tags = await resolveKnowledgeNodesForQuestion(this.prisma, questionId);
    if (tags.length === 0) return empty;
    const nodeIds = [...new Set(tags.map((tag) => tag.knowledgeNodeId))];
    const [nodes, snapshots, examTags] = await Promise.all([
      loadNodesWithParents(this.prisma, nodeIds),
      loadLatestFrequencyForNodes(this.prisma, nodeIds),
      loadExamQuestionsForNodes(this.prisma, nodeIds),
    ]);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));

    const examHits = examTags
      .filter((tag) => nodeById.has(tag.knowledgeNodeId))
      .map((tag) => ({
        knowledgeNodeId: tag.knowledgeNodeId,
        knowledgeNodeName: nodeById.get(tag.knowledgeNodeId)!.name,
        id: tag.question.id,
        exam: tag.question.paper.exam,
        year: tag.question.paper.year,
        questionNo: tag.question.questionNo,
        subject: tag.question.subject,
        questionType: tag.question.questionType,
        score: tag.question.score ?? null,
        summary: tag.question.summary ?? null,
        sourceUrl: tag.question.sourceRef ?? tag.question.paper.source ?? null,
      }));

    // A comprehensive exam question can be tagged by several nodes; count it once.
    const uniqueHits = [...new Map(examTags.map((tag) => [tag.question.id, tag])).values()];
    const currentYear = new Date().getFullYear();
    return {
      questionId,
      knowledgeNodes: nodes.map((node) => ({
        id: node.id,
        name: node.name,
        subject: node.subject,
        importance: node.importance,
        difficulty: node.difficulty,
        chapter: node.parent?.parent?.name ?? node.parent?.name ?? '',
      })),
      frequency: snapshots.map((snapshot) => ({
        knowledgeNodeId: snapshot.knowledgeNodeId,
        recent3Frequency: snapshot.recent3Frequency,
        recent5Frequency: snapshot.recent5Frequency,
        allTimeEvidence: snapshot.allTimeEvidence,
        primaryScore5y: snapshot.primaryScore5y,
        trendDirection: snapshot.trendDirection,
        evidenceConfidence: snapshot.evidenceConfidence,
      })),
      examHits,
      summary: {
        nodeCount: nodes.length,
        recent3Hits: uniqueHits.filter((tag) => tag.question.paper.year >= currentYear - 2).length,
        recent5Hits: uniqueHits.filter((tag) => tag.question.paper.year >= currentYear - 4).length,
        allTimeHits: uniqueHits.length,
        totalScore: uniqueHits.reduce((sum, tag) => sum + (tag.question.score ?? 0), 0),
        maxImportance: nodes.reduce((max, node) => Math.max(max, node.importance), 0),
        maxDifficulty: nodes.reduce((max, node) => Math.max(max, node.difficulty), 0),
      },
    };
  }

  async getMyMastery(userId: string) {
    const rows = await loadMasteries(this.prisma, userId);
    const quests = await loadNodeQuests(
      this.prisma,
      userId,
      rows.map((row) => row.knowledgeNodeId),
    );
    const questByNode = new Map(quests.map((quest) => [quest.knowledgeNodeId, quest]));
    return {
      generatedAt: new Date().toISOString(),
      items: rows.map((row) => ({
        knowledgeNodeId: row.knowledgeNodeId,
        mastery: row.mastery,
        accuracy: row.accuracy,
        recentAccuracy: row.recentAccuracy,
        attempts: row.attempts,
        correctCount: row.correctCount,
        wrongCount: row.wrongCount,
        status: deriveNodeMasteryStatus({
          mastery: row.mastery,
          attempts: row.attempts,
        }),
        questStatus: deriveNodeQuestStatus({
          masteryAttempts: row.attempts,
          questAttempts: questByNode.get(row.knowledgeNodeId)?.attempts ?? 0,
          questPassed: questByNode.get(row.knowledgeNodeId)?.passed ?? false,
        }),
        lastLearnedAt: row.lastLearnedAt?.toISOString() ?? null,
        lastReviewedAt: row.lastReviewedAt?.toISOString() ?? null,
        nextReviewAt: row.nextReviewAt?.toISOString() ?? null,
      })),
    };
  }

  async getNodeQuest(userId: string, knowledgeNodeId: string) {
    if (!this.enabled) {
      return {
        knowledgeNodeId,
        status: deriveNodeQuestStatus({ masteryAttempts: 0, questAttempts: 0, questPassed: false }),
        attempts: 0,
        bestAccuracy: 0,
        passedAt: null,
      };
    }
    const [mastery, quest] = await Promise.all([
      loadMasteryRow(this.prisma, userId, knowledgeNodeId),
      loadNodeQuest(this.prisma, userId, knowledgeNodeId),
    ]);
    return {
      knowledgeNodeId,
      status: deriveNodeQuestStatus({
        masteryAttempts: mastery?.attempts ?? 0,
        questAttempts: quest?.attempts ?? 0,
        questPassed: quest?.passed ?? false,
      }),
      attempts: quest?.attempts ?? 0,
      bestAccuracy: quest?.bestAccuracy ?? 0,
      passedAt: quest?.passedAt?.toISOString() ?? null,
    };
  }

  async completeNodeQuest(userId: string, knowledgeNodeId: string, accuracy: number) {
    if (!this.enabled) {
      return this.getNodeQuest(userId, knowledgeNodeId);
    }
    const node = await this.prisma.knowledgeNode.findUnique({ where: { id: knowledgeNodeId } });
    if (!node) return null;
    const clamped = Math.min(100, Math.max(0, accuracy));
    const quest = await saveNodeQuestAttempt(this.prisma, userId, knowledgeNodeId, {
      accuracy: clamped,
      passed: clamped >= QUEST_PASS_THRESHOLD,
    });
    return {
      knowledgeNodeId,
      status: deriveNodeQuestStatus({
        masteryAttempts: (await loadMasteryRow(this.prisma, userId, knowledgeNodeId))?.attempts ?? 0,
        questAttempts: quest.attempts,
        questPassed: quest.passed,
      }),
      attempts: quest.attempts,
      bestAccuracy: quest.bestAccuracy,
      passedAt: quest.passedAt?.toISOString() ?? null,
    };
  }

  async getMasteryTrend(userId: string, days = 14) {
    const windowDays = Math.max(1, Math.min(90, days));
    if (!this.enabled) {
      return buildMasteryTrend({
        userId,
        snapshots: [],
        nodeCatalog: [],
        subjects: ['数据结构', '计算机组成原理', '操作系统', '计算机网络'],
        days: windowDays,
        generatedAt: new Date().toISOString(),
      });
    }
    const [snapshots, nodes] = await Promise.all([
      loadMasterySnapshots(this.prisma, userId),
      loadActiveAtomicNodeCatalog(this.prisma),
    ]);
    return buildMasteryTrend({
      userId,
      snapshots: snapshots.map((snapshot) => ({
        knowledgeNodeId: snapshot.knowledgeNodeId,
        mastery: snapshot.mastery,
        snapshotDate: snapshot.snapshotDate.toISOString(),
      })),
      nodeCatalog: nodes.map((node) => ({
        knowledgeNodeId: node.id,
        subject: SCORE_SUBJECT_NAME_BY_CODE[node.subject] ?? '未分类',
        title: node.name,
        chapter: node.parent?.parent?.name ?? node.parent?.name ?? '',
      })),
      subjects: ['数据结构', '计算机组成原理', '操作系统', '计算机网络'],
      days: windowDays,
      generatedAt: new Date().toISOString(),
    });
  }

  async generateDailyPlan(
    userId: string,
    input: { targetExamDate: Date; availableMinutes: 30 | 60 | 120 | 180 },
  ) {
    // Sprint 3.2：推荐计算迁移至 RecommendationService（shared 引擎唯一入口），
    // 本方法仅保留响应 DTO 组装（toPlanDto），端点 URL 与返回结构不变。
    const plan = await this.recommendation.generateDailyPlanFromState(userId, input);
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
      action?: { id: string } | null;
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
      items: plan.tasks.map((task) => {
        const compatibility = toRecommendationTaskCompat(task);
        const item = {
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
        };
        return compatibility.actionId ? { ...item, actionId: compatibility.actionId } : item;
      }),
    };
  }
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
