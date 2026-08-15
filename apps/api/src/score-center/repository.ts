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

const NEUTRAL_MASTERY: MasteryState = {
  mastery: 0.5,
  accuracy: 0.55,
  recentAccuracy: 0.55,
  attempts: 0,
  correctCount: 0,
  wrongCount: 0,
  confidence: 0,
};

export function neutralMastery(): MasteryState {
  return { ...NEUTRAL_MASTERY };
}

export async function resolveKnowledgeNodesForQuestion(db: DbClient, questionId: string) {
  const direct = await db.questionKnowledgeNodeTag.findMany({
    where: { questionId },
    select: { knowledgeNodeId: true, role: true },
  });
  if (direct.length > 0) {
    return direct.map((tag) => ({
      knowledgeNodeId: tag.knowledgeNodeId,
      role: tag.role as 'PRIMARY' | 'SECONDARY',
    }));
  }

  // Fallback chain: Question -> QuestionKnowledgePoint -> KnowledgePoint -> KnowledgePointNodeMap.
  const links = await db.questionKnowledgePoint.findMany({
    where: { questionId },
    select: {
      knowledgePoint: {
        select: {
          nodeMaps: {
            select: { knowledgeNodeId: true },
          },
        },
      },
    },
  });
  const nodeIds = [...new Set(links.flatMap((link) => link.knowledgePoint.nodeMaps.map((map) => map.knowledgeNodeId)))];
  return nodeIds.map((knowledgeNodeId) => ({ knowledgeNodeId, role: 'PRIMARY' as const }));
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
  const data = {
    mastery: state.mastery,
    accuracy: state.accuracy,
    recentAccuracy: state.recentAccuracy,
    attempts: state.attempts,
    correctCount: state.correctCount,
    wrongCount: state.wrongCount,
    confidence: state.confidence,
    retention: state.retention ?? null,
    stabilityDays: state.stabilityDays ?? null,
    lastLearnedAt: state.lastLearnedAt ?? null,
    lastReviewedAt: state.lastReviewedAt ?? null,
    nextReviewAt: state.nextReviewAt ?? null,
    pinned: state.pinned ?? false,
  };
  await db.userKnowledgeMastery.upsert({
    where: {
      userId_knowledgeNodeId: { userId, knowledgeNodeId },
    },
    create: { userId, knowledgeNodeId, ...data },
    update: data,
  });
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
      reviewedAt: now,
      resolved: false,
      resolvedAt: null,
    },
    update: {
      reviewedAt: now,
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
      reviewedAt: now,
      resolved: true,
      resolvedAt: now,
    },
    update: {
      reviewedAt: now,
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
  return db.studyPlan.findFirst({
    where: { userId, source: 'score-center', status: 'ACTIVE' },
    include: {
      tasks: {
        where: { scheduledDate },
        orderBy: { generatedRank: 'asc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}
