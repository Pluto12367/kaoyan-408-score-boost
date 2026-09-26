#!/usr/bin/env node
// V14-P0 — real-exam content scaffold generator (READ-ONLY derivation).
//
// Emits per-year CSV scaffolds under kaoyan-408-content-starter/imports/ so
// 教研 only fills the authored columns (stem/options/answer/analysis/traps/
// rubric). Everything prefilled below comes from data already human-verified
// in this repository (design §7.5):
//
//   • 2022–2026: data/408/exam-mapping/408-YYYY-question-knowledge-map.json
//     (scoreStatus=verified, atomic PRIMARY/SECONDARY node mappings) → full
//     scaffold incl. maxScore + knowledgeNodeIds.
//   • 2009–2021: data/408/408-2009-2021-historical-question-index.json
//     (broad published tags, 91 essay scores missing, NO atomic node mappings)
//     → partial scaffold: maxScore/node columns stay EMPTY for authoring;
//     historicalTags go into 录入参考摘要 as hints. Never guessed (Owner D6).
//
// Usage:
//   node scripts/gen-real-exam-scaffold.mjs 2026
//   node scripts/gen-real-exam-scaffold.mjs 2021 2022 --out-dir <dir>
//
// The scaffold never contains question stems — the upstream data deliberately
// stores no stems (copyright note in the bundles); stems are authored content.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { stringifyCsv } from './lib/csv.mjs';

export const SCAFFOLD_HEADERS = [
  'stem', 'options', 'answer', 'analysis', 'knowledgePointIds', 'difficulty', 'type', 'source',
  'year', 'expectedTimeSec', 'questionSubtype', 'maxScore', '判分标准',
  'examNo', 'knowledgeNodeIds', '陷阱解析A', '陷阱解析B', '陷阱解析C', '陷阱解析D', '录入参考摘要',
];

const DATA_DIR = join(process.cwd(), 'data', '408');
const DEFAULT_OUT_DIR = join(process.cwd(), 'kaoyan-408-content-starter', 'imports');

export function loadYearBundle(year) {
  const mappingPath = join(DATA_DIR, 'exam-mapping', `408-${year}-question-knowledge-map.json`);
  const indexPath = join(DATA_DIR, `408-${year}-question-knowledge-map.json`);
  const historicalPath = join(DATA_DIR, '408-2009-2021-historical-question-index.json');
  try {
    return { kind: 'mapping', bundle: JSON.parse(readFileSync(mappingPath, 'utf8')) };
  } catch {
    // fall through to the historical index
  }
  void indexPath;
  try {
    const historical = JSON.parse(readFileSync(historicalPath, 'utf8'));
    const rows = (historical.questions ?? []).filter((row) => row.year === year);
    if (rows.length > 0) return { kind: 'historical', bundle: { meta: historical.meta, questions: rows } };
  } catch {
    // fall through to the error below
  }
  throw new Error(`No mapping bundle or historical index rows found for year ${year} under ${DATA_DIR}`);
}

export function buildScaffoldRows(bundleWrapper) {
  const { kind, bundle } = bundleWrapper;
  const rows = [...bundle.questions].sort((a, b) => a.questionNo - b.questionNo);
  return rows.map((question) => {
    const isMcq = question.questionType === '选择题';
    const row = Object.fromEntries(SCAFFOLD_HEADERS.map((header) => [header, '']));
    row.type = question.questionType;
    row.source = `${question.year}-408-真题`;
    row.year = String(question.year);
    row.examNo = String(question.questionNo);
    row.questionSubtype = isMcq ? 'SINGLE_CHOICE' : '';
    row.expectedTimeSec = isMcq ? '100' : '600';
    // Score: prefilled ONLY when the upstream data verified it. 2009–2021
    // essays (and any null score) stay empty — 教研 fills from the official
    // paper; the importer's structure check enforces it per completed year.
    row.maxScore = question.score == null ? '' : String(question.score);
    if (kind === 'mapping') {
      const nodeIds = [question.primaryKnowledgePointId, ...(question.secondaryKnowledgePointIds ?? [])]
        .filter(Boolean);
      row.knowledgeNodeIds = nodeIds.join('|');
      row['录入参考摘要'] = question.summary ?? '';
    } else {
      // historical index: broad tags only, no atomic node ids — never guessed.
      row.knowledgeNodeIds = '';
      const tags = question.historicalTags ?? [];
      row['录入参考摘要'] = [
        tags.length > 0 ? `历史标签：${tags.join('；')}` : '',
        `映射状态：${question.mappingStatus ?? 'unknown'}`,
      ].filter(Boolean).join('；');
    }
    return row;
  });
}

export function scaffoldFileName(year) {
  return `real-exam-scaffold-${year}.csv`;
}

async function main() {
  const args = process.argv.slice(2);
  const outDirIndex = args.indexOf('--out-dir');
  const outDir = outDirIndex >= 0 ? args[outDirIndex + 1] : DEFAULT_OUT_DIR;
  const years = args.filter((arg, index) => /^\d{4}$/.test(arg) && (outDirIndex < 0 || index !== outDirIndex + 1));
  if (years.length === 0) {
    console.error('Usage: node scripts/gen-real-exam-scaffold.mjs <year> [year...] [--out-dir <dir>]');
    process.exit(1);
  }
  mkdirSync(outDir, { recursive: true });
  for (const year of years) {
    const wrapper = loadYearBundle(Number(year));
    const rows = buildScaffoldRows(wrapper);
    const target = join(outDir, scaffoldFileName(year));
    writeFileSync(target, stringifyCsv(rows, SCAFFOLD_HEADERS), 'utf8');
    const priced = rows.filter((row) => row.maxScore !== '').length;
    const mapped = rows.filter((row) => row.knowledgeNodeIds !== '').length;
    console.log(`Scaffold ${year} (${wrapper.kind}): ${rows.length} rows -> ${target}`);
    console.log(`  maxScore prefilled: ${priced}/${rows.length}; knowledgeNodeIds prefilled: ${mapped}/${rows.length}`);
  }
}

if (import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
