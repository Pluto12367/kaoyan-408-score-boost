/**
 * V8 #56 — WrongQuestionReview drift AUDIT (read-only).
 *
 * Classifies every unresolved WrongQuestionReview row so a human can decide
 * whether any row is a true stale candidate:
 *   RECOVERY_ACTIVE  — a ReviewSchedule exists and is not mastered yet
 *   RECENT_WRONG     — no schedule, but the latest practice attempt on the
 *                      question was wrong (wrong-book should keep it)
 *   STALE_CANDIDATE  — no schedule and no wrong attempt anywhere (row only
 *                      exists in the review table; backfill candidate)
 *
 * READ-ONLY by design: run with no flags. Nothing here writes.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/audit-wrong-question-drift.mjs
 */

import { PrismaClient } from '@prisma/client';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const prisma = new PrismaClient({ datasourceUrl: databaseUrl });

async function main() {
  const unresolved = await prisma.wrongQuestionReview.findMany({
    where: { resolved: false },
    select: { userId: true, questionId: true, reviewedAt: true },
    orderBy: [{ userId: 'asc' }, { reviewedAt: 'asc' }],
  });
  console.log(`unresolved rows: ${unresolved.length}`);

  const scheduleKeys = new Set(
    (await prisma.reviewSchedule.findMany({ select: { userId: true, questionId: true, stability: true } }))
      .filter((row) => row.stability !== 'mastered')
      .map((row) => `${row.userId}::${row.questionId}`),
  );

  const classification = { RECOVERY_ACTIVE: [], RECENT_WRONG: [], STALE_CANDIDATE: [] };
  for (const row of unresolved) {
    const key = `${row.userId}::${row.questionId}`;
    if (scheduleKeys.has(key)) {
      classification.RECOVERY_ACTIVE.push(row);
      continue;
    }
    const latest = await prisma.practiceRecord.findFirst({
      where: { userId: row.userId, questionId: row.questionId },
      orderBy: { submittedAt: 'desc' },
      select: { correct: true, submittedAt: true },
    });
    if (latest && !latest.correct) classification.RECENT_WRONG.push(row);
    else classification.STALE_CANDIDATE.push(row);
  }

  for (const [bucket, rows] of Object.entries(classification)) {
    console.log(`\n${bucket}: ${rows.length}`);
    for (const row of rows.slice(0, 30)) {
      console.log(`  user=${row.userId} question=${row.questionId} reviewedAt=${row.reviewedAt.toISOString().slice(0, 10)}`);
    }
    if (rows.length > 30) console.log(`  ...and ${rows.length - 30} more`);
  }

  console.log('\nREAD-ONLY AUDIT COMPLETE — nothing was written.');
  console.log('Backfill (if any) is a separate, owner-approved, backup-first step.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
