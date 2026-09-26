#!/usr/bin/env node
// V14-P0 — real-exam content audit (READ-ONLY; design §11.4).
//
// Reports per-year readiness of the real-exam bank against the frozen 408
// structure (40 选择 ×2 + 7 综合 = 150) and the verified exam-mapping bundles:
//
//   total / mcq / essay      current-version questions with examNo set
//   priced                   maxScore present (NULL ≠ 0 — unpriced never faked)
//   traps                    MCQs carrying optionAnalyses (trap coverage)
//   rubric                   essays carrying a rubric (F4 scoreable)
//   nodes                    questions with ≥1 HUMAN real-exam-import tag
//   mapping                  per-question score match vs the verified bundle
//
// Verdict per year: READY = all 47 slots present + all priced + mapping clean.
// READY is a CONTENT-READINESS verdict only — it never implies deploy or any
// score claim (RULE-11).
//
// Usage: npm run audit:real-exam-content   (needs DATABASE_URL; no writes)

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const DATA_DIR = join(process.cwd(), 'data', '408');
const ESSAY_SCORES_2026 = { 41: 13, 42: 10, 43: 10, 44: 13, 45: 7, 46: 8, 47: 9 };

function loadMappingBundle(year) {
  const path = join(DATA_DIR, 'exam-mapping', `408-${year}-question-knowledge-map.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function verdictFor(report) {
  const gaps = [];
  if (report.total !== 47) gaps.push(`题量 ${report.total}/47`);
  if (report.mcq !== 40 || report.essay !== 7) gaps.push(`结构 选择${report.mcq}/40+综合${report.essay}/7`);
  if (report.priced !== report.total) gaps.push(`未定价 ${report.total - report.priced}`);
  if (report.sumMcq !== 80) gaps.push(`选择分值合计 ${report.sumMcq}/80`);
  if (report.sumEssay !== 70) gaps.push(`综合分值合计 ${report.sumEssay}/70`);
  if (report.mapping.mismatches > 0) gaps.push(`分值与 verified bundle 不符 ${report.mapping.mismatches} 题`);
  if (gaps.length === 0) return { verdict: 'READY', gaps };
  return { verdict: 'NOT READY', gaps };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required (read-only audit).');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const questions = await prisma.question.findMany({
      where: { isCurrent: true, examNo: { not: null } },
      select: {
        year: true, examNo: true, type: true, questionSubtype: true, maxScore: true,
        optionAnalyses: true, rubric: true,
        knowledgeNodeTags: { where: { source: 'real-exam-import' }, select: { id: true } },
      },
      orderBy: [{ year: 'asc' }, { examNo: 'asc' }],
    });

    if (questions.length === 0) {
      console.log('Real-exam bank: EMPTY — no current questions carry examNo. Run the importer first.');
      console.log('Verdict: NOT READY (0/18 years)');
      return;
    }

    const byYear = new Map();
    for (const question of questions) {
      if (!byYear.has(question.year)) byYear.set(question.year, []);
      byYear.get(question.year).push(question);
    }

    let readyYears = 0;
    const yearReports = [];
    for (const [year, yearQuestions] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
      const mcq = yearQuestions.filter((question) => question.type === 'SINGLE_CHOICE');
      const essay = yearQuestions.filter((question) => question.type === 'COMPREHENSIVE');
      const priced = yearQuestions.filter((question) => question.maxScore != null);
      const trapped = mcq.filter((question) => question.optionAnalyses != null);
      const trapEntries = mcq.reduce((total, question) => {
        const traps = question.optionAnalyses?.traps ?? {};
        return total + Object.keys(traps).length;
      }, 0);
      const rubricEssays = essay.filter((question) => question.rubric != null);
      const tagged = yearQuestions.filter((question) => question.knowledgeNodeTags.length > 0);

      const bundle = loadMappingBundle(year);
      const mismatches = [];
      let mappingChecked = 0;
      if (bundle) {
        const byNo = new Map((bundle.questions ?? []).map((question) => [question.questionNo, question]));
        for (const question of yearQuestions) {
          const upstream = byNo.get(question.examNo);
          if (!upstream || upstream.score == null) continue;
          mappingChecked += 1;
          if (upstream.score !== question.maxScore) {
            mismatches.push(`题${question.examNo}: 库 ${question.maxScore} ≠ verified ${upstream.score}`);
          }
        }
      }

      const report = {
        year,
        total: yearQuestions.length,
        mcq: mcq.length,
        essay: essay.length,
        priced: priced.length,
        sumMcq: mcq.reduce((total, question) => total + (question.maxScore ?? 0), 0),
        sumEssay: essay.reduce((total, question) => total + (question.maxScore ?? 0), 0),
        traps: trapped.length,
        trapEntries,
        rubric: rubricEssays.length,
        nodes: tagged.length,
        mapping: { checked: mappingChecked, mismatches: mismatches.length, details: mismatches },
      };
      const { verdict, gaps } = verdictFor(report);
      if (verdict === 'READY') readyYears += 1;
      yearReports.push({ ...report, verdict, gaps });
    }

    console.log('Real-exam content audit (read-only)\n');
    for (const report of yearReports) {
      console.log(`${report.year}  ${report.verdict}`);
      console.log(`  题量 ${report.total}/47（选择 ${report.mcq}/40 · 综合 ${report.essay}/7）· 定价 ${report.priced}/${report.total}（选择 ${report.sumMcq}/80 + 综合 ${report.sumEssay}/70）`);
      console.log(`  陷阱 ${report.traps}/${report.mcq} 选择题（共 ${report.trapEntries} 条）· 大题 rubric ${report.rubric}/${report.essay} · 节点直标 ${report.nodes}/${report.total}`);
      console.log(`  分值互证 ${report.mapping.checked ? `${report.mapping.checked} 题已核` : '无 verified bundle'}${report.mapping.details.length ? ` · ✖ ${report.mapping.details.join('；')}` : ' · 一致'}`);
      if (report.gaps.length > 0) console.log(`  缺口: ${report.gaps.join(' · ')}`);
      console.log('');
    }
    console.log(`Verdict: ${readyYears === 18 ? 'READY' : 'NOT READY'} (${readyYears}/18 years READY)`);
  } finally {
    await prisma.$disconnect();
  }
}

await main();
void ESSAY_SCORES_2026;
