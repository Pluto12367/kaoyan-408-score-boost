/**
 * PHASE 8 (content toolchain) — large-question content audit (READ-ONLY).
 *
 * Measures the REAL state of large-question content so the content track is
 * measurable instead of assumed. It never writes and never fabricates: counts
 * come straight from the current question bank.
 *
 * Reports, per question subtype and in total:
 *   • questions        (current rows)
 *   • priced           (maxScore NOT NULL — NULL ≠ 0)
 *   • withRubric       (rubric authored and non-null)
 *   • readyForTraining (priced AND rubric AND subtype in the four 408 large
 *                       categories) — the only set a student could actually
 *                       train and be scored on
 *
 * Exit code is 0 (audit tool); the printed verdict states CONTENT NOT READY
 * whenever any of the four large categories has zero ready questions.
 *
 * Usage:
 *   node scripts/audit-large-question-content.mjs [--json]
 * Environment: DATABASE_URL (falls back to DATABASE_TEST_URL like peer tools).
 */

import { PrismaClient } from '@prisma/client';

const LARGE_QUESTION_SUBTYPES = ['ALGORITHM', 'CO_COMPUTATION', 'OS_PV', 'CN_ROUTING'];

const args = new Set(process.argv.slice(2));
const asJson = args.has('--json');

const databaseUrl = process.env.DATABASE_URL ?? process.env.DATABASE_TEST_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required for the content audit (read-only).');
  process.exit(2);
}
process.env.DATABASE_URL = databaseUrl;

const prisma = new PrismaClient({ datasourceUrl: databaseUrl });

function emptyBucket() {
  return { questions: 0, priced: 0, withRubric: 0, readyForTraining: 0 };
}

try {
  const questions = await prisma.question.findMany({
    where: { isCurrent: true },
    select: { id: true, questionSubtype: true, maxScore: true, rubric: true },
  });

  const bySubtype = {};
  const totals = emptyBucket();
  for (const question of questions) {
    const key = question.questionSubtype ?? 'UNKNOWN';
    const bucket = bySubtype[key] ?? emptyBucket();
    const priced = question.maxScore != null && question.maxScore > 0;
    const withRubric = question.rubric != null;
    bucket.questions += 1;
    bucket.priced += priced ? 1 : 0;
    bucket.withRubric += withRubric ? 1 : 0;
    bucket.readyForTraining += priced && withRubric ? 1 : 0;

    totals.questions += 1;
    totals.priced += priced ? 1 : 0;
    totals.withRubric += withRubric ? 1 : 0;
    totals.readyForTraining += priced && withRubric ? 1 : 0;
    bySubtype[key] = bucket;
  }

  const largeQuestion = {
    subtypes: LARGE_QUESTION_SUBTYPES,
    ...emptyBucket(),
    missing: [],
  };
  for (const subtype of LARGE_QUESTION_SUBTYPES) {
    const bucket = bySubtype[subtype] ?? emptyBucket();
    largeQuestion.questions += bucket.questions;
    largeQuestion.priced += bucket.priced;
    largeQuestion.withRubric += bucket.withRubric;
    largeQuestion.readyForTraining += bucket.readyForTraining;
    if (bucket.readyForTraining === 0) largeQuestion.missing.push(subtype);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    source: 'database (read-only)',
    totals,
    bySubtype,
    largeQuestion,
    verdict: largeQuestion.missing.length === 0 ? 'LARGE QUESTION CONTENT READY' : 'LARGE QUESTION CONTENT NOT READY',
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Large-question content audit — ${report.generatedAt}`);
    console.log(`  totals: ${totals.questions} questions, ${totals.priced} priced, ${totals.withRubric} with rubric, ${totals.readyForTraining} trainable`);
    console.log('  by subtype:');
    for (const [subtype, bucket] of Object.entries(bySubtype).sort()) {
      console.log(`    ${subtype.padEnd(16)} questions=${bucket.questions} priced=${bucket.priced} rubric=${bucket.withRubric} trainable=${bucket.readyForTraining}`);
    }
    console.log(`  large-question categories (${LARGE_QUESTION_SUBTYPES.join(', ')}):`);
    if (largeQuestion.missing.length === 0) {
      console.log(`    all four categories have trainable content (${largeQuestion.readyForTraining} questions)`);
    } else {
      console.log(`    MISSING trainable content for: ${largeQuestion.missing.join(', ')}`);
    }
    console.log(`  verdict: ${report.verdict}`);
  }
  process.exit(0);
} catch (error) {
  console.error('Large-question content audit failed:', error?.message ?? error);
  process.exit(1);
} finally {
  await prisma.$disconnect().catch(() => {});
}
