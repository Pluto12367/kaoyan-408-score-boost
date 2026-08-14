// Backfill UserKnowledgeMastery from historical PracticeRecords so the
// score-center node mastery (and later the unified learning loop) reflects
// all practice history, not just records created after the bridge went live.
//
// Usage:
//   DATABASE_URL=... node scripts/backfill-user-mastery.mjs --dry-run
//   DATABASE_URL=... node scripts/backfill-user-mastery.mjs --user <userId>
//
// Replay is always deterministic: the user's UserKnowledgeMastery rows are
// rebuilt from all practice records (idempotent). Review-only fields
// (retention/stability) are rebuilt on the next review; attempts-derived
// fields come entirely from practice records.

import { PrismaClient } from '@prisma/client';
import { pathToFileURL } from 'node:url';
import { updateMasteryAfterAttempt } from '@kaoyan408/shared';

function neutralMastery() {
  return {
    mastery: 0.5,
    accuracy: 0.55,
    recentAccuracy: 0.55,
    attempts: 0,
    correctCount: 0,
    wrongCount: 0,
    confidence: 0,
  };
}

function toState(row) {
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

export function clampDifficulty(value) {
  return Math.min(5, Math.max(1, Math.round(value))) ;
}

export async function resolveNodesForQuestion(db, questionId) {
  const direct = await db.questionKnowledgeNodeTag.findMany({
    where: { questionId },
    select: { knowledgeNodeId: true, role: true },
  });
  if (direct.length > 0) {
    return direct.map((tag) => ({
      knowledgeNodeId: tag.knowledgeNodeId,
      role: tag.role,
    }));
  }
  const links = await db.questionKnowledgePoint.findMany({
    where: { questionId },
    select: {
      knowledgePoint: {
        select: { nodeMaps: { select: { knowledgeNodeId: true } } },
      },
    },
  });
  const nodeIds = [...new Set(
    links.flatMap((link) => link.knowledgePoint.nodeMaps.map((map) => map.knowledgeNodeId)),
  )];
  return nodeIds.map((knowledgeNodeId) => ({ knowledgeNodeId, role: 'PRIMARY' }));
}

export async function replayUserMastery(db, userId, { dryRun = false } = {}) {
  const records = await db.practiceRecord.findMany({
    where: { userId },
    orderBy: { submittedAt: 'asc' },
    select: { questionId: true, correct: true, submittedAt: true },
  });
  const questionIds = [...new Set(records.map((record) => record.questionId))];
  const tagsByQuestion = new Map();
  for (const questionId of questionIds) {
    const tags = await resolveNodesForQuestion(db, questionId);
    if (tags.length > 0) tagsByQuestion.set(questionId, tags);
  }

  const existing = await db.userKnowledgeMastery.findMany({ where: { userId } });
  const stateByNode = new Map(existing.map((row) => [row.knowledgeNodeId, toState(row)]));
  const snapshotByKey = new Map();
  const nodeIds = [...stateByNode.keys(), ...[...tagsByQuestion.values()].flat().map((tag) => tag.knowledgeNodeId)];
  const nodeMeta = await db.knowledgeNode.findMany({
    where: { id: { in: [...new Set(nodeIds)] } },
    select: { id: true, difficulty: true },
  });
  const difficultyById = new Map(nodeMeta.map((node) => [node.id, node.difficulty]));

  for (const record of records) {
    for (const tag of tagsByQuestion.get(record.questionId) ?? []) {
      const current = stateByNode.get(tag.knowledgeNodeId) ?? neutralMastery();
      const next = updateMasteryAfterAttempt(current, {
        isCorrect: record.correct,
        difficulty: clampDifficulty(difficultyById.get(tag.knowledgeNodeId) ?? 3),
        role: tag.role,
      });
      stateByNode.set(tag.knowledgeNodeId, next);
      const date = new Date(record.submittedAt);
      date.setUTCHours(0, 0, 0, 0);
      snapshotByKey.set(`${tag.knowledgeNodeId}:${date.toISOString()}`, {
        userId,
        knowledgeNodeId: tag.knowledgeNodeId,
        mastery: next.mastery,
        attempts: next.attempts,
        correctCount: next.correctCount,
        wrongCount: next.wrongCount,
        snapshotDate: date,
      });
    }
  }

  const attributableRecords = [...records.values()]
    .filter((record) => tagsByQuestion.has(record.questionId)).length;
  const summary = {
    userId,
    records: records.length,
    attributableRecords,
    nodes: stateByNode.size,
    snapshots: snapshotByKey.size,
  };
  if (dryRun) return summary;

  await db.$transaction([
    db.userKnowledgeMastery.deleteMany({ where: { userId } }),
    ...[...stateByNode.entries()].map(([knowledgeNodeId, state]) =>
      db.userKnowledgeMastery.create({
        data: { userId, knowledgeNodeId, ...state },
      })),
    db.userMasterySnapshot.deleteMany({ where: { userId } }),
    ...[...snapshotByKey.values()].map((snapshot) =>
      db.userMasterySnapshot.create({ data: snapshot })),
  ]);
  return summary;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const userArg = process.argv.find((arg) => arg.startsWith('--user='));
  const userId = userArg ? userArg.slice('--user='.length) : null;
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to backfill mastery');
  }
  const prisma = new PrismaClient();
  try {
    const userIds = userId
      ? [userId]
      : (await prisma.practiceRecord.findMany({ select: { userId: true }, distinct: ['userId'] }))
          .map((row) => row.userId);
    if (userIds.length === 0) {
      console.log('[backfill-user-mastery] no practice records to backfill.');
      return;
    }
    for (const id of userIds) {
      const summary = await replayUserMastery(prisma, id, { dryRun });
      console.log(`[backfill-user-mastery] ${dryRun ? 'dry-run' : 'done'} ${JSON.stringify(summary)}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  main().catch((error) => {
    console.error(`[backfill-user-mastery] FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
