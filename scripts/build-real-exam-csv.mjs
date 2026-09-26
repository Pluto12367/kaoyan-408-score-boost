#!/usr/bin/env node
// V14-P0 — real-exam pilot CSV assembler（generic，按年工作）。
// 把三个来源合成待互审 CSV（R2 试点 established 的流程，R3 起按年复用）：
//
//   1. kaoyan-408-content-starter/imports/real-exam-<year>-source.json
//      题面原文+官方答案字母（fetch-real-exam-source.mjs 抽取的公开考试材料）
//   2. data/408/exam-mapping/408-<year>-question-knowledge-map.json
//      已核验的分值/考点映射（scoreStatus=verified）
//   3. kaoyan-408-content-starter/imports/real-exam-<year>-drafts.mjs
//      解析/陷阱/rubric —— AI 草稿（D-5），必须经具名教研互审后方可导入
//
// 输出：kaoyan-408-content-starter/imports/real-exam-<year>-pilot.csv
//   状态 = 待互审（DRAFT FOR REVIEW）。
//
// 组装规则（R2 试点确立，不变）：
//   • 题干仅做去水印清理，不改写内容；图片依赖题保留扁平化文字并在解析中标注待核对。
//   • 选项统一为 starter-320 的「A.<文本>」存储形态。
//   • 大题 subtype 留空（Owner D-3）；分值/映射取 verified bundle。
//   • difficulty 为草稿默认值（选择题=中等，综合题=困难），评审时可调整。
//
// Usage: node scripts/build-real-exam-csv.mjs --year <YYYY>

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stringifyCsv } from './lib/csv.mjs';
import { REAL_EXAM_HEADERS } from './import-real-exams.mjs';

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const year = argValue('--year');
if (!year || !/^\d{4}$/.test(year)) {
  console.error('Usage: node scripts/build-real-exam-csv.mjs --year <YYYY>');
  process.exit(1);
}

const IMPORTS_DIR = join(process.cwd(), 'kaoyan-408-content-starter', 'imports');
const source = JSON.parse(readFileSync(join(IMPORTS_DIR, `real-exam-${year}-source.json`), 'utf8'));
const bundle = JSON.parse(readFileSync(join(process.cwd(), 'data', '408', 'exam-mapping', `408-${year}-question-knowledge-map.json`), 'utf8'));
const draftsModule = await import(pathToFileURL(join(IMPORTS_DIR, `real-exam-${year}-drafts.mjs`)).href);
const drafts = draftsModule.drafts ?? draftsModule.default;

if (!drafts || typeof drafts !== 'object') {
  console.error(`drafts module real-exam-${year}-drafts.mjs must export { drafts } keyed by questionNo`);
  process.exit(1);
}

const bundleByNo = new Map(bundle.questions.map((question) => [question.questionNo, question]));
const WATERMARK = /计算机考研杂货铺/g;

// 粗粒度考点映射（确定性推导，评审可改）：
//   主表依据 data/408/knowledge-point-node-map.json 的 PRIMARY 锚点章节；
//   16 点词汇未覆盖的章节用就近归属兜底并显式 WARN（评审须知）。
const COARSE_BY_SECTION = [
  { prefix: 'OS-C02-S04', point: 'os-sync' },
];
const COARSE_BY_CHAPTER = {
  'DS-C02': 'ds-list', 'DS-C03': 'ds-list', 'DS-C04': 'ds-tree', 'DS-C05': 'ds-graph',
  'DS-C06': 'ds-sort', 'DS-C07': 'ds-sort',
  'CO-C01': 'co-data', 'CO-C02': 'co-data', 'CO-C03': 'co-cache', 'CO-C04': 'co-instruction', 'CO-C05': 'co-cpu',
  'OS-C01': 'os-process', 'OS-C02': 'os-process', 'OS-C03': 'os-memory', 'OS-C04': 'os-file', 'OS-C05': 'os-file',
  'CN-C01': 'net-link', 'CN-C02': 'net-link', 'CN-C03': 'net-link', 'CN-C04': 'net-ip', 'CN-C05': 'net-tcp', 'CN-C06': 'net-app',
};

function resolveCoarsePoint(primaryNodeId, warnings, questionNo) {
  for (const section of COARSE_BY_SECTION) {
    if (primaryNodeId.startsWith(section.prefix)) return section.point;
  }
  const chapter = /^([A-Z]+-C\d+)/.exec(primaryNodeId)?.[1];
  const point = chapter ? COARSE_BY_CHAPTER[chapter] : undefined;
  if (!point) {
    warnings.push(`题 ${questionNo}: 章节 ${chapter ?? primaryNodeId} 无粗粒度考点映射，回退 ds-list`);
    return 'ds-list';
  }
  if (['CO-C01', 'OS-C01', 'OS-C05', 'CN-C01', 'CN-C02', 'DS-C03'].includes(chapter)) {
    warnings.push(`题 ${questionNo}: 章节 ${chapter} 就近归属 ${point}（16 点词汇无该章，评审可改）`);
  }
  return point;
}

const warnings = [];
const rows = [];
for (const question of source.questions) {
  const draft = drafts[question.questionNo];
  const mapping = bundleByNo.get(question.questionNo);
  if (!draft) { warnings.push(`题 ${question.questionNo}: 缺解析/陷阱草稿`); continue; }
  if (!mapping) { warnings.push(`题 ${question.questionNo}: 缺 verified 映射`); continue; }

  const isMcq = question.kind === 'mcq';
  const stem = question.stem.replace(WATERMARK, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!isMcq && !/（1）|（2）|\(\d\)/.test(stem)) {
    warnings.push(`题 ${question.questionNo}: 综合题题干未见子问编号，请核对完整性`);
  }

  const row = Object.fromEntries(REAL_EXAM_HEADERS.map((header) => [header, '']));
  row.stem = stem;
  // 选项分隔符是「|」：选项文本中的数学绝对值符 |V| 会破坏 split('|')，
  // 统一替换为 Unicode 数学竖线 ∣（U+2223，显示等价，内容语义不变）。
  row.options = isMcq
    ? ['A', 'B', 'C', 'D'].map((letter) => `${letter}.${(question.options[letter] ?? '').replace(/\|/g, '∣')}`).join('|')
    : '';
  row.answer = isMcq ? question.answer : '';
  row.analysis = draft.analysis;
  row.knowledgePointIds = resolveCoarsePoint(mapping.primaryKnowledgePointId, warnings, question.questionNo);
  row.difficulty = isMcq ? '中等' : '困难';
  row.type = isMcq ? '选择题' : '综合题';
  row.source = `${year}-408-真题`;
  row.year = year;
  row.expectedTimeSec = isMcq ? '100' : '600';
  row.questionSubtype = isMcq ? 'SINGLE_CHOICE' : '';
  // 2009-2021 大题分值待官方分值表（bundle score=null）→ 空串=导入器侧诚实未定价
  // （NULL ≠ 0）。选择题恒为 2 分结构事实，不受影响。
  row.maxScore = mapping.score == null ? '' : String(mapping.score);
  row.判分标准 = !isMcq && draft.rubric ? JSON.stringify(draft.rubric) : '';
  row.examNo = String(question.questionNo);
  // 个别 bundle 存在 secondary 与 primary 相同的行（导入器拒绝重复 nodeId）——
  // 按序去重（PRIMARY 在前），不改 bundle 生成物本身。
  const nodeIds = [mapping.primaryKnowledgePointId, ...(mapping.secondaryKnowledgePointIds ?? [])]
    .filter(Boolean);
  row.knowledgeNodeIds = [...new Set(nodeIds)].join('|');
  for (const letter of ['A', 'B', 'C', 'D']) {
    row[`陷阱解析${letter}`] = isMcq && draft.traps?.[letter] ? draft.traps[letter] : '';
  }
  row['录入参考摘要'] = mapping.summary ?? '';
  rows.push(row);
}

if (warnings.length > 0) {
  console.warn('组装警告（评审须知）:');
  for (const warning of warnings) console.warn(`  ⚠ ${warning}`);
}
const outPath = join(IMPORTS_DIR, `real-exam-${year}-pilot.csv`);
writeFileSync(outPath, stringifyCsv(rows, REAL_EXAM_HEADERS), 'utf8');
console.log(`Assembled ${rows.length} rows (${year}, 待互审) -> ${outPath}`);
