// Question-bank hygiene: report duplicate stems and archive redundant rows.
// The canonical row per stem is the earliest-created row; the rest are
// archived by setting isCurrent=false (QuestionFamily versioning keeps history).
//
// Usage:
//   node scripts/question-bank-dedupe.mjs --dry-run   # report only
//   DATABASE_URL=... node scripts/question-bank-dedupe.mjs

import { PrismaClient } from '@prisma/client';
import { pathToFileURL } from 'node:url';

export function planDedupe(questions) {
  const byStem = new Map();
  for (const question of questions) {
    const stem = (question.stem ?? '').trim();
    if (!stem) continue;
    if (!byStem.has(stem)) byStem.set(stem, []);
    byStem.get(stem).push(question);
  }
  const actions = [];
  for (const [stem, rows] of byStem) {
    if (rows.length <= 1) continue;
    const sorted = [...rows].sort(
      (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
    );
    actions.push({
      stem,
      canonicalId: sorted[0].id,
      archiveIds: sorted.slice(1).map((row) => row.id),
    });
  }
  return actions;
}

export function summarizeBank(questions) {
  const total = questions.length;
  const stems = questions.map((question) => (question.stem ?? '').trim()).filter(Boolean);
  const uniqueStems = new Set(stems).size;
  const actions = planDedupe(questions);
  const duplicateRows = actions.reduce((sum, action) => sum + action.archiveIds.length, 0);
  const noKp = questions.filter((question) => (question._count?.knowledgePoints ?? 0) === 0).length;
  return {
    total,
    uniqueStems,
    duplicateStems: actions.length,
    duplicateRows,
    noKp,
  };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to audit or dedupe the question bank');
  }
  const prisma = new PrismaClient();
  try {
    const questions = await prisma.question.findMany({
      select: {
        id: true,
        stem: true,
        createdAt: true,
        isCurrent: true,
        _count: { select: { knowledgePoints: true } },
      },
    });
    const summary = summarizeBank(questions);
    console.log('[question-bank-dedupe] ' + JSON.stringify(summary));
    const actions = planDedupe(questions);
    if (actions.length === 0) {
      console.log('[question-bank-dedupe] no duplicate stems found.');
      return;
    }
    if (dryRun) {
      for (const action of actions.slice(0, 20)) {
        console.log(`  ${action.stem.slice(0, 50)} -> keep ${action.canonicalId}, archive ${action.archiveIds.length} row(s)`);
      }
      console.log('[question-bank-dedupe] dry-run only, no database writes.');
      return;
    }
    for (const action of actions) {
      await prisma.question.updateMany({
        where: { id: { in: action.archiveIds } },
        data: { isCurrent: false },
      });
    }
    console.log(`[question-bank-dedupe] archived ${summary.duplicateRows} duplicate row(s) across ${actions.length} stem(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  main().catch((error) => {
    console.error(`[question-bank-dedupe] FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
