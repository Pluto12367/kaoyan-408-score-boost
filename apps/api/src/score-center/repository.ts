import type { Prisma, PrismaClient } from '@prisma/client';
import type { MasteryState } from '@kaoyan408/shared';

export type DbClient = PrismaClient | Prisma.TransactionClient;

export type AttemptFact = {
  questionId: string;
  correct: boolean;
  timeSpentSec: number;
  submittedAt: Date | string;
};

export type MasteryPersistence = MasteryState & {
  retention?: number | null;
  stabilityDays?: number | null;
  lastLearnedAt?: Date | null;
  lastReviewedAt?: Date | null;
  nextReviewAt?: Date | null;
  pinned?: boolean;
};

type MasteryRow = NonNullable<Awaited<ReturnType<typeof loadMasteryRow>>>;
type MasteryMutation = (row: MasteryRow | null) => MasteryPersistence;

const MAX_MASTERY_CONFLICT_RETRIES = 3;

export class MasteryOptimisticLockConflictError extends Error {
  constructor(userId: string, knowledgeNodeId: string) {
    super(`UserKnowledgeMastery optimistic lock conflict for user=${userId} knowledgeNode=${knowledgeNodeId}`);
    this.name = 'MasteryOptimisticLockConflictError';
  }
}

const NEUTRAL_MASTERY: MasteryState = {
  mastery: 0.5,
  accuracy: 0.55,
  recentAccuracy: 0.55,
  attempts: 0,
  correctCount: 0,
  wrongCount: 0,
  confidence: 0,
};

export const BRIDGE_KNOWLEDGE_TAG_SOURCE = 'bridge:knowledge-point-map';

export type KnowledgeNodeResolution = {
  knowledgeNodeId: string;
  role: 'PRIMARY' | 'SECONDARY';
  confidence: number;
  taggedBy: string | null;
  source: string | null;
  origin: 'direct' | 'bridge' | 'map-fallback';
};

export function neutralMastery(): MasteryState {
  return { ...NEUTRAL_MASTERY };
}

export async function resolveKnowledgeNodesForQuestion(db: DbClient, questionId: string): Promise<KnowledgeNodeResolution[]> {
  const direct = await db.questionKnowledgeNodeTag.findMany({
    where: { questionId },
    select: { knowledgeNodeId: true, role: true, confidence: true, taggedBy: true, source: true },
  });

  const toResolution = (tag: {
    knowledgeNodeId: string;
    role: string;
    confidence?: number | null;
    taggedBy?: string | null;
    source?: string | null;
  }, origin: KnowledgeNodeResolution['origin']): KnowledgeNodeResolution => ({
    knowledgeNodeId: tag.knowledgeNodeId,
    role: tag.role as 'PRIMARY' | 'SECONDARY',
    confidence: tag.confidence ?? 0,
    taggedBy: tag.taggedBy ?? null,
    source: tag.source ?? null,
    origin,
  });

  const trustedDirect = direct.filter((tag) => tag.source !== BRIDGE_KNOWLEDGE_TAG_SOURCE);
  if (trustedDirect.length > 0) {
    return trustedDirect.map((tag) => toResolution(tag, 'direct'));
  }
  if (direct.length > 0) {
    return direct.map((tag) => toResolution(tag, 'bridge'));
  }

  // Fallback chain: Question -> QuestionKnowledgePoint -> KnowledgePoint -> KnowledgePointNodeMap.
  const links = await db.questionKnowledgePoint.findMany({
    where: { questionId },
    select: {
      knowledgePoint: {
        select: {
          nodeMaps: {
            select: { knowledgeNodeId: true, confidence: true, taggedBy: true },
          },
        },
      },
    },
  });
  const nodeById = new Map<string, KnowledgeNodeResolution>();
  for (const map of links.flatMap((link) => link.knowledgePoint.nodeMaps)) {
    if (!nodeById.has(map.knowledgeNodeId)) {
      nodeById.set(map.knowledgeNodeId, {
        knowledgeNodeId: map.knowledgeNodeId,
        role: 'PRIMARY',
        confidence: map.confidence ?? 0,
        taggedBy: map.taggedBy ?? null,
        source: null,
        origin: 'map-fallback',
      });
    }
  }
  return [...nodeById.values()];
}

export async function loadActiveKnowledgeNodes(db: DbClient, ids: string[]) {
  if (ids.length === 0) return [];
  return db.knowledgeNode.findMany({
    where: { id: { in: ids }, isActive: true },
  });
}

export async function loadMasteryRow(db: DbClient, userId: string, knowledgeNodeId: string) {
  return db.userKnowledgeMastery.findUnique({
    where: {
      userId_knowledgeNodeId: { userId, knowledgeNodeId },
    },
  });
}

export async function saveMastery(
  db: DbClient,
  userId: string,
  knowledgeNodeId: string,
  state: MasteryPersistence,
) {
  return saveMasteryWithOptimisticRetry(db, userId, knowledgeNodeId, () => state);
}

export async function saveMasteryWithOptimisticRetry(
  db: DbClient,
  userId: string,
  knowledgeNodeId: string,
  calculate: MasteryMutation,
) {
  let retries = 0;
  for (;;) {
    const row = await loadMasteryRow(db, userId, knowledgeNodeId);
    const data = buildMasteryWriteData(row, calculate(row));
    if (!row) {
      try {
        return await db.userKnowledgeMastery.create({
          data: {
            userId,
            knowledgeNodeId,
            ...data,
            version: 0,
          },
        });
      } catch (error) {
        if (!isPrismaErrorCode(error, 'P2002') || retries >= MAX_MASTERY_CONFLICT_RETRIES) {
          throw error;
        }
        await waitForMasteryRetry(retries);
        retries += 1;
        continue;
      }
    }

    const result = await db.userKnowledgeMastery.updateMany({
      where: { id: row.id, version: row.version },
      data: {
        ...data,
        version: { increment: 1 },
      },
    });
    if (result.count === 1) {
      const saved = await loadMasteryRow(db, userId, knowledgeNodeId);
      if (saved) return saved;
    }

    if (retries >= MAX_MASTERY_CONFLICT_RETRIES) {
      throw new MasteryOptimisticLockConflictError(userId, knowledgeNodeId);
    }
    await waitForMasteryRetry(retries);
    retries += 1;
  }
}

function buildMasteryWriteData(row: MasteryRow | null, state: MasteryPersistence) {
  const data = {
    mastery: state.mastery,
    accuracy: state.accuracy,
    recentAccuracy: state.recentAccuracy,
    attempts: state.attempts,
    correctCount: state.correctCount,
    wrongCount: state.wrongCount,
    confidence: state.confidence,
    retention: state.retention !== undefined ? state.retention : row?.retention ?? null,
    stabilityDays: state.stabilityDays !== undefined ? state.stabilityDays : row?.stabilityDays ?? null,
    lastLearnedAt: state.lastLearnedAt !== undefined ? state.lastLearnedAt : row?.lastLearnedAt ?? null,
    lastReviewedAt: state.lastReviewedAt !== undefined ? state.lastReviewedAt : row?.lastReviewedAt ?? null,
    nextReviewAt: state.nextReviewAt !== undefined ? state.nextReviewAt : row?.nextReviewAt ?? null,
    pinned: state.pinned !== undefined ? state.pinned : row?.pinned ?? false,
  };
  return data;
}

function isPrismaErrorCode(error: unknown, code: string) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

async function waitForMasteryRetry(retryIndex: number) {
  // P2034 transaction-level abort retry is intentionally deferred. This helper
  // only handles row-level OCC conflicts: stale version updates and P2002 on create.
  const baseMs = 10 * 2 ** retryIndex;
  const jitterMs = Math.floor(Math.random() * 5);
  await new Promise((resolve) => setTimeout(resolve, baseMs + jitterMs));
}

export async function saveMasterySnapshot(
  db: DbClient,
  userId: string,
  knowledgeNodeId: string,
  state: { mastery: number; attempts: number; correctCount: number; wrongCount: number },
  snapshotDate: Date,
) {
  await db.userMasterySnapshot.upsert({
    where: {
      userId_knowledgeNodeId_snapshotDate: { userId, knowledgeNodeId, snapshotDate },
    },
    create: {
      userId,
      knowledgeNodeId,
      mastery: state.mastery,
      attempts: state.attempts,
      correctCount: state.correctCount,
      wrongCount: state.wrongCount,
      snapshotDate,
    },
    update: {
      mastery: state.mastery,
      attempts: state.attempts,
      correctCount: state.correctCount,
      wrongCount: state.wrongCount,
    },
  });
}

export async function loadMasterySnapshots(db: DbClient, userId: string) {
  return db.userMasterySnapshot.findMany({
    where: { userId },
    select: { knowledgeNodeId: true, mastery: true, snapshotDate: true },
    orderBy: { snapshotDate: 'asc' },
  });
}

export async function touchWrongQuestion(db: DbClient, userId: string, questionId: string, now: Date) {
  await db.wrongQuestionReview.upsert({
    where: { userId_questionId: { userId, questionId } },
    create: {
      userId,
      questionId,
      resolved: false,
      resolvedAt: null,
    },
    update: {
      resolved: false,
      resolvedAt: null,
    },
  });
}

export async function resolveWrongQuestion(db: DbClient, userId: string, questionId: string, now: Date) {
  await db.wrongQuestionReview.upsert({
    where: { userId_questionId: { userId, questionId } },
    create: {
      userId,
      questionId,
      resolved: true,
      resolvedAt: now,
    },
    update: {
      resolved: true,
      resolvedAt: now,
    },
  });
}

export async function loadKnowledgeDetail(db: DbClient, knowledgePointId: string) {
  return db.knowledgeNode.findUnique({
    where: { id: knowledgePointId },
    include: {
      frequency: { orderBy: { snapshotDate: 'desc' }, take: 1 },
      outgoing: true,
      incoming: true,
    },
  });
}

export async function loadRelatedQuestionsForNode(db: DbClient, knowledgeNodeId: string) {
  const direct = await db.questionKnowledgeNodeTag.findMany({
    where: { knowledgeNodeId },
    select: { questionId: true },
  });
  let questionIds = direct.map((tag) => tag.questionId);
  if (questionIds.length === 0) {
    const fallback = await db.questionKnowledgePoint.findMany({
      where: { knowledgePoint: { nodeMaps: { some: { knowledgeNodeId } } } },
      select: { questionId: true },
    });
    questionIds = [...new Set(fallback.map((link) => link.questionId))];
  }
  if (questionIds.length === 0) return [];
  return db.question.findMany({
    where: { id: { in: questionIds }, isCurrent: true },
    select: {
      id: true,
      stem: true,
      type: true,
      difficulty: true,
      source: true,
      year: true,
      expectedTimeSec: true,
    },
    orderBy: { createdAt: 'asc' },
    take: 20,
  });
}

export async function loadExamQuestionsForNode(db: DbClient, knowledgeNodeId: string) {
  return db.examQuestionKnowledgeTag.findMany({
    where: { knowledgeNodeId },
    select: {
      role: true,
      question: {
        select: {
          id: true,
          questionNo: true,
          subject: true,
          questionType: true,
          score: true,
          summary: true,
          sourceRef: true,
          paper: { select: { exam: true, year: true, source: true } },
        },
      },
    },
    orderBy: { question: { paper: { year: 'desc' } } },
    take: 10,
  });
}

export async function loadExamQuestionsForNodes(db: DbClient, knowledgeNodeIds: string[]) {
  if (knowledgeNodeIds.length === 0) return [];
  return db.examQuestionKnowledgeTag.findMany({
    where: { knowledgeNodeId: { in: knowledgeNodeIds } },
    select: {
      knowledgeNodeId: true,
      role: true,
      question: {
        select: {
          id: true,
          questionNo: true,
          subject: true,
          questionType: true,
          score: true,
          summary: true,
          sourceRef: true,
          paper: { select: { exam: true, year: true, source: true } },
        },
      },
    },
    orderBy: { question: { paper: { year: 'desc' } } },
  });
}

export async function loadLatestFrequencyForNodes(db: DbClient, knowledgeNodeIds: string[]) {
  if (knowledgeNodeIds.length === 0) return [];
  const latest = await db.knowledgeFrequencySnapshot.findFirst({
    orderBy: { snapshotDate: 'desc' },
    select: { snapshotDate: true, modelVersion: true },
  });
  if (!latest) return [];
  return db.knowledgeFrequencySnapshot.findMany({
    where: {
      knowledgeNodeId: { in: knowledgeNodeIds },
      snapshotDate: latest.snapshotDate,
      modelVersion: latest.modelVersion,
    },
  });
}

export async function loadNodesWithParents(db: DbClient, ids: string[]) {
  if (ids.length === 0) return [];
  return db.knowledgeNode.findMany({
    where: { id: { in: ids }, isActive: true },
    include: { parent: { include: { parent: true } } },
  });
}

export async function loadEvidenceNodes(db: DbClient) {
  return db.knowledgeNode.findMany({
    where: { isActive: true, nodeType: 'atomicPoint' },
    orderBy: { id: 'asc' },
  });
}

export async function loadActiveAtomicNodeCatalog(db: DbClient) {
  return db.knowledgeNode.findMany({
    where: { isActive: true, nodeType: 'atomicPoint' },
    include: { parent: { include: { parent: true } } },
    orderBy: { id: 'asc' },
  });
}

export async function loadLatestFrequencySnapshots(db: DbClient) {
  const latest = await db.knowledgeFrequencySnapshot.findFirst({
    orderBy: { snapshotDate: 'desc' },
    select: { snapshotDate: true, modelVersion: true },
  });
  if (!latest) return [];
  return db.knowledgeFrequencySnapshot.findMany({
    where: { snapshotDate: latest.snapshotDate, modelVersion: latest.modelVersion },
  });
}

export async function loadMasteries(db: DbClient, userId: string) {
  return db.userKnowledgeMastery.findMany({ where: { userId } });
}

export async function loadNodeQuest(db: DbClient, userId: string, knowledgeNodeId: string) {
  return db.userNodeQuest.findUnique({
    where: {
      userId_knowledgeNodeId: { userId, knowledgeNodeId },
    },
  });
}

export async function loadNodeQuests(db: DbClient, userId: string, knowledgeNodeIds: string[]) {
  if (knowledgeNodeIds.length === 0) return [];
  return db.userNodeQuest.findMany({
    where: { userId, knowledgeNodeId: { in: knowledgeNodeIds } },
  });
}

export async function saveNodeQuestAttempt(
  db: DbClient,
  userId: string,
  knowledgeNodeId: string,
  input: { accuracy: number; passed: boolean },
) {
  const previous = await loadNodeQuest(db, userId, knowledgeNodeId);
  const attempts = (previous?.attempts ?? 0) + 1;
  const bestAccuracy = Math.max(previous?.bestAccuracy ?? 0, input.accuracy);
  return db.userNodeQuest.upsert({
    where: {
      userId_knowledgeNodeId: { userId, knowledgeNodeId },
    },
    create: {
      userId,
      knowledgeNodeId,
      attempts,
      bestAccuracy,
      passed: input.passed,
      passedAt: input.passed ? new Date() : null,
    },
    update: {
      attempts,
      bestAccuracy,
      passed: input.passed ? true : previous?.passed ?? false,
      passedAt: input.passed ? previous?.passedAt ?? new Date() : previous?.passedAt ?? null,
    },
  });
}

export async function loadKnowledgeRelations(db: DbClient) {
  return db.knowledgeRelation.findMany({
    where: { type: 'PREREQUISITE' },
    select: { fromId: true, toId: true, type: true },
  });
}

export async function archiveScoreCenterPlans(db: DbClient, userId: string) {
  await db.studyPlan.updateMany({
    where: { userId, source: 'score-center', status: 'ACTIVE' },
    data: { status: 'ARCHIVED' },
  });
}

export async function createScoreCenterPlan(
  db: DbClient,
  userId: string,
  input: {
    targetScore: number;
    remainingDays: number;
    dailyHours: number;
    modelVersion: string;
    targetExamDate: Date;
    availableMinutes: number;
    scheduledDate: string;
  },
  tasks: Array<Record<string, unknown>>,
) {
  return db.studyPlan.create({
    data: {
      userId,
      phase: 'score-center',
      targetScore: input.targetScore,
      remainingDays: input.remainingDays,
      dailyHours: input.dailyHours,
      checkpoint: 'score-center',
      source: 'score-center',
      modelVersion: input.modelVersion,
      targetExamDate: input.targetExamDate,
      availableMinutes: input.availableMinutes,
      stale: false,
      status: 'ACTIVE',
      tasks: { create: tasks as Prisma.StudyTaskCreateManyInput[] },
    },
    include: {
      tasks: { orderBy: { generatedRank: 'asc' } },
    },
  });
}

export async function loadTodayScoreCenterPlan(db: DbClient, userId: string, scheduledDate: string) {
  // The reverse RecommendationAction relation is present in the current
  // schema. Keep this narrow cast until the generated Prisma client is
  // regenerated in the deployment environment (the checked-in client may be
  // older than the schema during offline verification).
  const studyPlan = (db as DbClient & { studyPlan: any }).studyPlan;
  return studyPlan.findFirst({
    where: {
      userId,
      source: 'score-center',
      tasks: { some: { scheduledDate } },
    },
    include: {
      tasks: {
        where: { scheduledDate },
        orderBy: { generatedRank: 'asc' },
        include: { action: { select: { id: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}
