#!/usr/bin/env node
// V14-P0 — real-exam question importer (Owner D-1..D-7 approved 2026-09-25).
//
// Design: docs/v14-p0-real-exam-bank-design.md §6/§7. Reuses the shared
// parsers (normalizeQuestionSubtype / normalizeMaxScoreInput / parseRubricInput
// / parseOptionAnalyses) as the single shape sources; the starter-320 importer
// (scripts/import-questions.mjs) is deliberately NOT touched.
//
// What this adds over the starter importer:
//   • real-exam-only hard validations: examNo slot rules (MCQ 1–40, essay
//     41–47), year bound 2009+, source format `<year>-408-真题`, MCQ exactly
//     4 options, maxScore REQUIRED (real exams carry official scores),
//     knowledgeNodeIds REQUIRED (PRIMARY first), trap columns only for MCQ,
//     trap-on-correct-option rejected via parseOptionAnalyses.
//   • per-year structure checks on complete years (40×2 + 7Σ=70 → 150) and
//     per-question score cross-checks against the verified exam-mapping
//     bundles when a year's bundle exists (two-sided evidence, design §7.3).
//   • KnowledgeNodeTag writes (taggedBy=HUMAN, source='real-exam-import') and
//     a QuestionImportBatch audit row recording --reviewed-by (RULE-10
//     traceability; --rights-confirmed required per Owner D-1).
//   • Versioned inheritance: on a version bump, optionAnalyses / examNo /
//     rubric omitted by the new row carry the current version's value forward
//     (never silently dropped — mirrors the API update path).
//
// Usage:
//   node scripts/import-real-exams.mjs <csv> --dry-run
//   node scripts/import-real-exams.mjs <csv> --reviewed-by "教研名" \
//        --uploaded-by <userId> --rights-confirmed [--replace]
//
// Prerequisite (non-dry-run): DATABASE_URL pointing at the target database;
// the knowledge points / nodes referenced by knowledgePointIds /
// knowledgeNodeIds must already exist there (dictionary data — never created
// by this script, never guessed).

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PrismaClient, QuestionType } from '@prisma/client';
import { computeContentFingerprint } from '@kaoyan408/shared/questionImport.server';
import {
  normalizeMaxScoreInput,
  normalizeQuestionSubtype,
  parseOptionAnalyses,
  parseRubricInput,
} from '@kaoyan408/shared';
import { parseCsv } from './lib/csv.mjs';

export const REAL_EXAM_HEADERS = [
  'stem', 'options', 'answer', 'analysis', 'knowledgePointIds', 'difficulty', 'type', 'source',
  'year', 'expectedTimeSec', 'questionSubtype', 'maxScore', '判分标准',
  'examNo', 'knowledgeNodeIds', '陷阱解析A', '陷阱解析B', '陷阱解析C', '陷阱解析D', '录入参考摘要',
];

export const NODE_TAG_SOURCE = 'real-exam-import';
const BATCH_SOURCE = 'real-exam-authoring';
const TRAP_COLUMNS = ['陷阱解析A', '陷阱解析B', '陷阱解析C', '陷阱解析D'];

const difficultyMap = new Map([
  ['基础', 'BASIC'],
  ['中等', 'MEDIUM'],
  ['困难', 'HARD'],
]);

// ---------------------------------------------------------------- row validation

/**
 * Pure row validation. Returns { questions, warnings, errors }; errors carry
 * 1-based CSV line numbers (header = line 1). DB-dependent existence checks
 * (knowledgePointIds / knowledgeNodeIds) are applied in `filterUnknownIds` by
 * the caller — the pure layer only checks format.
 */
export function validateRealExamRows(rows) {
  const questions = [];
  const warnings = [];
  const errors = [];

  rows.forEach((row, index) => {
    const line = index + 2;
    try {
      const question = validateRow(row, line, warnings);
      questions.push(question);
    } catch (error) {
      errors.push({ line, message: error.message });
    }
  });

  return { questions, warnings, errors };
}

function validateRow(row, line, warnings) {
  const fail = (message) => {
    throw new Error(`Line ${line}: ${message}`);
  };

  if (row['录入参考摘要']?.trim()) {
    warnings.push(`Line ${line}: 录入参考摘要 is scaffold-only and ignored by the importer.`);
  }

  const type = row.type?.trim() ?? '';
  if (type !== '选择题' && type !== '综合题') {
    fail(`unsupported question type "${type}" (real exams are 选择题 or 综合题 only)`);
  }
  const isMcq = type === '选择题';

  // V14: maxScore is required for MCQs (structure-priced 2 分); essays MAY
  // omit it (official 2009-2021 per-question scores pending → NULL=unpriced,
  // warned at row level and reported by the year structure check).
  for (const field of isMcq
    ? ['stem', 'options', 'answer', 'analysis', 'knowledgePointIds', 'difficulty', 'type', 'source', 'year', 'examNo', 'maxScore']
    : ['stem', 'analysis', 'knowledgePointIds', 'difficulty', 'type', 'source', 'year', 'examNo']) {
    if (!row[field]?.toString().trim()) {
      fail(`missing required field "${field}" (real-exam imports must be fully authored)`);
    }
  }

  const year = Number(row.year);
  if (!Number.isInteger(year) || year < 2009 || year > 2100) {
    fail(`year must be an integer ≥ 2009 (408 started in 2009), got "${row.year}"`);
  }

  const examNo = Number(row.examNo);
  if (!Number.isInteger(examNo)) fail(`examNo must be an integer, got "${row.examNo}"`);
  if (isMcq && (examNo < 1 || examNo > 40)) fail(`选择题 examNo must be 1..40, got ${examNo}`);
  if (!isMcq && (examNo < 41 || examNo > 47)) fail(`综合题 examNo must be 41..47, got ${examNo}`);

  const sourceMatch = /^(\d{4})-408-真题$/.exec(row.source.trim());
  if (!sourceMatch) fail(`source must match "<year>-408-真题" (traceable provenance), got "${row.source}"`);
  if (Number(sourceMatch[1]) !== year) fail(`source year ${sourceMatch[1]} must equal row year ${year}`);

  const options = (row.options ?? '').split('|').map((option) => option.trim()).filter(Boolean);
  if (isMcq && options.length !== 4) {
    fail(`选择题 must carry exactly 4 options (408 format), got ${options.length}`);
  }

  let answer = '';
  if (isMcq) {
    answer = row.answer.trim();
    if (!/^[A-Z]$/.test(answer) || answer > 'D') {
      fail(`answer must be a letter A..D for 选择题, got "${row.answer}"`);
    }
  }

  const knowledgePointIds = row.knowledgePointIds.split('|').map((id) => id.trim()).filter(Boolean);
  if (knowledgePointIds.length === 0) fail('at least one knowledge point is required');

  const knowledgeNodeIds = (row.knowledgeNodeIds ?? '').split('|').map((id) => id.trim()).filter(Boolean);
  if (knowledgeNodeIds.length === 0) fail('knowledgeNodeIds is required for real-exam imports (PRIMARY first)');
  if (new Set(knowledgeNodeIds).size !== knowledgeNodeIds.length) fail('knowledgeNodeIds contains duplicates');

  const difficulty = difficultyMap.get(row.difficulty.trim());
  if (!difficulty) fail(`unsupported difficulty "${row.difficulty}" (基础/中等/困难)`);

  const expectedTimeSec = row.expectedTimeSec?.trim() ? Number(row.expectedTimeSec) : 100;
  if (!Number.isInteger(expectedTimeSec) || expectedTimeSec < 30) {
    fail('expectedTimeSec must be an integer >= 30');
  }

  // Subtype: MCQ must be SINGLE_CHOICE; essays may be left NULL (Owner D-3:
  // dictionary gaps stay unknown — never guessed into a sibling code).
  const subtypeInput = row.questionSubtype?.trim();
  const questionSubtype = subtypeInput ? normalizeQuestionSubtype(subtypeInput) : null;
  if (subtypeInput && !questionSubtype) {
    fail(`unsupported question subtype "${subtypeInput}"`);
  }
  if (isMcq && questionSubtype !== 'SINGLE_CHOICE') {
    fail(`选择题 requires questionSubtype SINGLE_CHOICE, got "${subtypeInput}"`);
  }

  const maxScoreParsed = normalizeMaxScoreInput(row.maxScore);
  if ('invalid' in maxScoreParsed && maxScoreParsed.invalid) {
    fail(`maxScore must be a non-negative number, got "${row.maxScore}"`);
  }
  // V14 (2009-2021 track): essays MAY omit maxScore — official per-question
  // scores for those years are not yet entered; NULL stays honestly unpriced
  // (Owner D5/D6: NULL ≠ 0), and the year structure check reports the gap
  // instead of failing. MCQs remain required-priced (2 分 structure fact).
  if (!isMcq && maxScoreParsed.value == null) {
    warnings.push(`Line ${line}: essay maxScore absent → imported UNPRICED (NULL ≠ 0; pending official score table).`);
  }
  if (isMcq && maxScoreParsed.value == null) {
    fail(`maxScore is required for MCQ real-exam imports (408 结构定价 2 分)`);
  }

  // Rubric: essays only — a choice question has nothing for a rubric to score.
  const rubricParsed = parseRubricInput(row['判分标准'] ?? row.rubric);
  if (rubricParsed.invalid) {
    fail(`invalid rubric — ${rubricParsed.errors?.join(' ') ?? 'unparseable'}`);
  }
  if (isMcq && rubricParsed.value) fail('选择题 must not carry a rubric');

  // Traps: dedicated columns, MCQ only; parse through the single shape source.
  const trapInputs = TRAP_COLUMNS.map((column) => ({ letter: column.replace('陷阱解析', ''), text: row[column]?.trim() ?? '' }));
  if (!isMcq && trapInputs.some((trap) => trap.text)) {
    fail('综合题 must not carry 陷阱解析 columns (traps exist for choice questions only)');
  }
  let optionAnalyses = null;
  if (isMcq) {
    const traps = Object.fromEntries(trapInputs.filter((trap) => trap.text).map((trap) => [trap.letter, trap.text]));
    if (Object.keys(traps).length > 0) {
      const parsed = parseOptionAnalyses(
        { version: 1, traps },
        { optionsCount: options.length, answer, questionType: '选择题' },
      );
      if (parsed.invalid) fail(`invalid trap analyses — ${parsed.errors?.join(' ') ?? 'unparseable'}`);
      optionAnalyses = parsed.value;
    }
  }

  return {
    stem: row.stem.trim(),
    options: isMcq ? options : ['作答区'],
    answer,
    analysis: row.analysis.trim(),
    knowledgePointIds,
    knowledgeNodeIds,
    difficulty,
    type,
    source: row.source.trim(),
    year,
    expectedTimeSec,
    questionSubtype: questionSubtype ?? null,
    maxScore: maxScoreParsed.value,
    rubric: rubricParsed.value ?? null,
    optionAnalyses,
    examNo,
  };
}

// ---------------------------------------------------------------- structure validation

/**
 * Pure per-year structure validation. `mappingBundles`: Map<year, bundle> for
 * the two-sided score cross-check against verified exam-mapping data; absent
 * bundle → no cross-check for that year (reported, not failed).
 */
export function validateYearStructure(questions, mappingBundles = new Map(), warnings = []) {
  const reports = [];
  const errors = [];

  const byYear = new Map();
  for (const question of questions) {
    if (!byYear.has(question.year)) byYear.set(question.year, []);
    byYear.get(question.year).push(question);
  }

  for (const year of [...byYear.keys()].sort()) {
    const yearQuestions = byYear.get(year);
    const mcq = yearQuestions.filter((question) => question.type === '选择题');
    const essay = yearQuestions.filter((question) => question.type === '综合题');
    const duplicateExamNos = yearQuestions.length - new Set(yearQuestions.map((question) => question.examNo)).size;
    if (duplicateExamNos > 0) {
      errors.push(`Year ${year}: ${duplicateExamNos} duplicate examNo value(s)`);
    }

    const sumMcq = mcq.reduce((total, question) => total + question.maxScore, 0);
    // V14: essays may be unpriced (maxScore null for 2009-2021 pending official
    // scores) — maxScore is a number on every validated row by the time it gets
    // here EXCEPT essays, which carry null. Reduce treating null as 0 for the
    // sum but track the unpriced count for the report and mixed-state check.
    const pricedEssay = essay.filter((question) => question.maxScore != null);
    const unpricedEssayCount = essay.length - pricedEssay.length;
    const sumEssay = pricedEssay.reduce((total, question) => total + question.maxScore, 0);
    const complete = yearQuestions.length === 47 && mcq.length === 40 && essay.length === 7;

    const report = {
      year, total: yearQuestions.length, mcq: mcq.length, essay: essay.length,
      complete, sumMcq, sumEssay, unpricedEssayCount, mappingMatch: null, mappingChecked: false,
    };

    if (complete) {
      const numeric = (a, b) => a - b;
      const expectedMcq = Array.from({ length: 40 }, (_, index) => index + 1).sort(numeric).join(',');
      const actualMcq = mcq.map((question) => question.examNo).sort(numeric).join(',');
      if (actualMcq !== expectedMcq) errors.push(`Year ${year}: 选择题 examNo slots incomplete (${actualMcq})`);
      const expectedEssay = Array.from({ length: 7 }, (_, index) => index + 41).sort(numeric).join(',');
      const actualEssay = essay.map((question) => question.examNo).sort(numeric).join(',');
      if (actualEssay !== expectedEssay) errors.push(`Year ${year}: 综合题 examNo slots incomplete (${actualEssay})`);
      if (sumMcq !== 80) errors.push(`Year ${year}: 选择题分值合计 ${sumMcq} ≠ 80`);
      // Essay sums: all-priced → must equal 70; all-unpriced → allowed with a
      // report note (2009-2021 pending official scores); MIXED → suspicious,
      // reject (partial score entry looks like an authoring accident).
      if (unpricedEssayCount === essay.length && essay.length > 0) {
        report.essaysUnpriced = true;
        warnings.push(`Year ${year}: 综合题全部未定价（NULL=未定价≠0，待官方分值表补录）`);
      } else if (unpricedEssayCount === 0) {
        if (sumEssay !== 70) errors.push(`Year ${year}: 综合题分值合计 ${sumEssay} ≠ 70`);
      } else {
        errors.push(`Year ${year}: 综合题定价状态混合（${pricedEssay.length} 已定价 / ${unpricedEssayCount} 未定价）——请整年统一`);
      }
    }

    const bundle = mappingBundles.get(year);
    if (bundle) {
      report.mappingChecked = true;
      const byNo = new Map((bundle.questions ?? []).map((question) => [question.questionNo, question]));
      let matchCount = 0;
      let checked = 0;
      for (const question of yearQuestions) {
        const upstream = byNo.get(question.examNo);
        if (!upstream || upstream.score == null) continue;
        checked += 1;
        if (upstream.score === question.maxScore) {
          matchCount += 1;
        } else {
          errors.push(
            `Year ${year} 题 ${question.examNo}: maxScore ${question.maxScore} ≠ verified exam-mapping score ${upstream.score}`,
          );
        }
      }
      report.mappingMatch = `${matchCount}/${checked}`;
    }

    reports.push(report);
  }

  return { reports, errors };
}

// ---------------------------------------------------------------- main

function parseArgs(argv) {
  const args = new Set(argv);
  const valueOf = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  return {
    dryRun: args.has('--dry-run'),
    replace: args.has('--replace'),
    reviewedBy: valueOf('--reviewed-by'),
    uploadedBy: valueOf('--uploaded-by'),
    rightsConfirmed: args.has('--rights-confirmed'),
    file: argv.find((arg, index) => !arg.startsWith('--') && argv[index - 1] !== '--reviewed-by' && argv[index - 1] !== '--uploaded-by' && /^\S+$/.test(arg)),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.error('Usage: node scripts/import-real-exams.mjs <csv> [--dry-run] [--replace] --reviewed-by "名字" --uploaded-by <userId> --rights-confirmed');
    process.exit(1);
  }
  const filePath = resolve(process.cwd(), args.file);
  const fileSha256 = createHash('sha256').update(readFileSync(filePath)).digest('hex');

  const rows = parseCsv(readFileSync(filePath, 'utf8'));
  const { questions, warnings, errors } = validateRealExamRows(rows);
  for (const warning of warnings) console.warn(`  ⚠ ${warning}`);
  if (errors.length > 0) {
    console.error(`\n${errors.length} row error(s) — nothing imported:`);
    for (const error of errors) console.error(`  ✖ ${error.message}`);
    process.exit(1);
  }

  // Two-sided score evidence: verified exam-mapping bundles, when present.
  const mappingBundles = new Map();
  for (const year of new Set(questions.map((question) => question.year))) {
    try {
      const { loadYearBundle } = await import('./gen-real-exam-scaffold.mjs');
      const wrapper = loadYearBundle(year);
      if (wrapper.kind === 'mapping') mappingBundles.set(year, wrapper.bundle);
    } catch {
      // No verified bundle for this year — cross-check reported as skipped.
    }
  }
  const structure = validateYearStructure(questions, mappingBundles);
  for (const report of structure.reports) {
    console.log(
      `  ${report.year}: ${report.total} rows (mcq ${report.mcq}/essay ${report.essay})` +
      `${report.complete ? ` COMPLETE sum=${report.sumMcq}+${report.sumEssay}=150` : ' partial'}` +
      `${report.mappingChecked ? ` mapping ${report.mappingMatch}` : ''}`,
    );
  }
  if (structure.errors.length > 0) {
    console.error(`\n${structure.errors.length} structure error(s) — nothing imported:`);
    for (const message of structure.errors) console.error(`  ✖ ${message}`);
    process.exit(1);
  }

  if (args.dryRun) {
    console.log(`\nDry run only. ${questions.length} questions validated; no database writes.`);
    process.exit(0);
  }

  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for a real import.');
  if (!args.reviewedBy?.trim()) throw new Error('--reviewed-by "教研名" is required (RULE-10 traceability).');
  if (!args.uploadedBy?.trim()) throw new Error('--uploaded-by <userId> is required (QuestionImportBatch.uploadedById).');
  if (!args.rightsConfirmed) {
    throw new Error('--rights-confirmed is required: 真题题干全文入库口径须 Owner D-1 批准（docs/v14-p0-real-exam-bank-design.md §13）。');
  }

  const prisma = new PrismaClient();
  try {
    const uploader = await prisma.user.findUnique({ where: { id: args.uploadedBy }, select: { id: true, role: true } });
    if (!uploader) throw new Error(`uploaded-by user ${args.uploadedBy} does not exist.`);
    if (uploader.role !== 'ADMIN' && uploader.role !== 'TEACHER') {
      throw new Error(`uploaded-by user must be TEACHER or ADMIN, got ${uploader.role}.`);
    }

    const pointIds = new Set((await prisma.knowledgePoint.findMany({ select: { id: true } })).map((row) => row.id));
    const nodes = await prisma.knowledgeNode.findMany({ where: { isActive: true }, select: { id: true } });
    const nodeIds = new Set(nodes.map((row) => row.id));
    const unknownPoints = questions.flatMap((question) => question.knowledgePointIds).filter((id) => !pointIds.has(id));
    const unknownNodes = questions.flatMap((question) => question.knowledgeNodeIds).filter((id) => !nodeIds.has(id));
    if (unknownPoints.length > 0) {
      throw new Error(`unknown knowledge point(s): ${[...new Set(unknownPoints)].join(', ')} (dictionary data must exist first)`);
    }
    if (unknownNodes.length > 0) {
      throw new Error(`unknown/inactive knowledge node(s): ${[...new Set(unknownNodes)].join(', ')} (dictionary data must exist first)`);
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let batchId = null;

    await prisma.$transaction(async (tx) => {
      const writes = [];
      for (const question of questions) {
        const existing = await tx.question.findFirst({
          where: { isCurrent: true, stem: question.stem, source: question.source, year: question.year },
          select: { id: true, familyId: true, versionNumber: true, rubric: true, optionAnalyses: true, examNo: true },
        });
        writes.push({ question, existing });
      }

      const plannedWrites = writes.filter((write) => args.replace || !write.existing);
      if (plannedWrites.length > 0) {
        const years = [...new Set(questions.map((question) => question.year))];
        const batch = await tx.questionImportBatch.create({
          data: {
            uploadedById: args.uploadedBy,
            originalFileName: basename(filePath),
            originalStorageKey: `${BATCH_SOURCE}/${basename(filePath)}`,
            fileSha256,
            fileType: 'csv',
            source: BATCH_SOURCE,
            title: `真题库导入 ${years.join('/')} · reviewedBy=${args.reviewedBy}`,
            year: years.length === 1 ? years[0] : null,
            rightsConfirmed: true,
            rightsConfirmedAt: new Date(),
            status: 'completed',
            statusCounts: { planned: plannedWrites.length },
            expiresAt: new Date(Date.now() + 365 * 86_400_000),
          },
        });
        batchId = batch.id;
      }

      for (const { question, existing } of writes) {
        if (existing && !args.replace) {
          skipped += 1;
          continue;
        }
        // Versioned inheritance: omitted authored fields carry the current
        // version's value forward — never silently dropped (design §7.2).
        const inheritedRubric = question.rubric ?? existing?.rubric ?? null;
        const inheritedTraps = question.optionAnalyses ?? existing?.optionAnalyses ?? null;
        const inheritedExamNo = question.examNo ?? existing?.examNo ?? null;

        const fingerprintInput = {
          stem: question.stem,
          options: question.options,
          answer: question.answer,
          analysis: question.analysis,
          knowledgePointIds: question.knowledgePointIds,
          difficulty: question.difficulty,
          type: question.type,
          source: question.source,
          year: question.year,
          expectedTimeSec: question.expectedTimeSec,
        };
        // NOTE (V14-P0): optionAnalyses / examNo / rubric / maxScore are
        // metadata OUTSIDE the content fingerprint — same boundary the rubric
        // established in PHASE 8 (dedup identity = the authored content).

        let questionId;
        if (existing) {
          await tx.question.update({ where: { id: existing.id }, data: { isCurrent: false } });
        const version = await tx.question.create({
          data: {
            familyId: existing.familyId,
            versionNumber: existing.versionNumber + 1,
            isCurrent: true,
            contentFingerprint: computeContentFingerprint(fingerprintInput),
            importBatchId: batchId,
              stem: question.stem,
              options: question.options,
              answer: question.answer,
              analysis: question.analysis,
              difficulty: question.difficulty,
              type: question.type === '选择题' ? QuestionType.SINGLE_CHOICE : QuestionType.COMPREHENSIVE,
              source: question.source,
              year: question.year,
              expectedTimeSec: question.expectedTimeSec,
              questionSubtype: question.questionSubtype,
              maxScore: question.maxScore,
              rubric: inheritedRubric,
              optionAnalyses: inheritedTraps ?? undefined,
              examNo: inheritedExamNo,
              knowledgePoints: { create: question.knowledgePointIds.map((knowledgePointId) => ({ knowledgePointId })) },
            },
          });
          questionId = version.id;
          updated += 1;
        } else {
          const createdRow = await tx.question.create({
            data: {
              family: { create: {} },
              versionNumber: 1,
              isCurrent: true,
              contentFingerprint: computeContentFingerprint(fingerprintInput),
              importBatch: batchId ? { connect: { id: batchId } } : undefined,
              stem: question.stem,
              options: question.options,
              answer: question.answer,
              analysis: question.analysis,
              difficulty: question.difficulty,
              type: question.type === '选择题' ? QuestionType.SINGLE_CHOICE : QuestionType.COMPREHENSIVE,
              source: question.source,
              year: question.year,
              expectedTimeSec: question.expectedTimeSec,
              questionSubtype: question.questionSubtype,
              maxScore: question.maxScore,
              rubric: inheritedRubric,
              optionAnalyses: inheritedTraps ?? undefined,
              examNo: inheritedExamNo,
              knowledgePoints: { create: question.knowledgePointIds.map((knowledgePointId) => ({ knowledgePointId })) },
            },
          });
          questionId = createdRow.id;
          created += 1;
        }

        // Rewrite this question's import-sourced node tags (idempotent;
        // never touches bridge rows or other tag sources).
        await tx.questionKnowledgeNodeTag.deleteMany({ where: { questionId, source: NODE_TAG_SOURCE } });
        const roles = question.knowledgeNodeIds.map((knowledgeNodeId, index) => ({
          questionId,
          knowledgeNodeId,
          role: index === 0 ? 'PRIMARY' : 'SECONDARY',
          confidence: 1.0,
          taggedBy: 'HUMAN',
          source: NODE_TAG_SOURCE,
        }));
        await tx.questionKnowledgeNodeTag.createMany({ data: roles });
      }

      if (batchId) {
        await tx.questionImportBatch.update({
          where: { id: batchId },
          data: { statusCounts: { created, updated, skipped } },
        });
      }
    });

    console.log(`\nImport complete. created=${created} updated=${updated} skipped=${skipped} batch=${batchId ?? 'none (all skipped)'}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
