#!/usr/bin/env node
// V14-② — memory-card importer (task book docs/v14-memory-card-design.md,
// Owner-approved 2026-09-26; RULE-10 chain mirrors import-real-exams.mjs).
//
// Usage:
//   node scripts/import-memory-cards.mjs <csv> --dry-run
//   node scripts/import-memory-cards.mjs <csv> --reviewed-by "教研名" --rights-confirmed
//   node scripts/import-memory-cards.mjs <csv> --reviewed-by "教研名" --rights-confirmed --update
//
// --update (D-M-3): an exact (知识节点ID, 正面) match UPDATES 背面/卡片类型 and
// re-stamps the RULE-10 provenance instead of being skipped — for reviewed
// content revisions. Never creates a second active card with the same front.
//
// CSV headers (exact): 知识节点ID,卡片类型,正面,背面
//   卡片类型: CONCLUSION（结论卡） | FORMULA（公式卡）
//   正面 ≤ 500 字符, 背面 ≤ 2000 字符.
//
// Hard rules:
//   • Non-dry-run REQUIRES --reviewed-by AND --rights-confirmed (RULE-10:
//     no unreviewed content enters; the reviewer name is stamped per row).
//   • KnowledgeNode must exist and be isActive — dictionary data is never
//     created or guessed here.
//   • Idempotent: an exact (knowledgeNodeId, front) match is skipped, never
//     duplicated.
//   • Any row-level error aborts the whole import (all-or-nothing batch).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { parseCsv } from './lib/csv.mjs';

const HEADERS = ['知识节点ID', '卡片类型', '正面', '背面'];
const CARD_TYPES = new Set(['CONCLUSION', 'FORMULA']);
const FRONT_MAX = 500;
const BACK_MAX = 2000;

function parseArgs(argv) {
  const args = { file: null, dryRun: false, reviewedBy: null, rightsConfirmed: false, update: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--rights-confirmed') args.rightsConfirmed = true;
    else if (arg === '--update') args.update = true;
    else if (arg === '--reviewed-by') {
      i += 1;
      args.reviewedBy = argv[i] ?? null;
    } else if (!args.file) args.file = arg;
    else throw new Error(`无法识别的参数: ${arg}`);
  }
  return args;
}

function validateRows(csvText) {
  // parseCsv (scripts/lib/csv.mjs) returns objects keyed by the header row
  // and drops the header line itself — validate the header from the raw text.
  const text = csvText.replace(/^\uFEFF/, '');
  const firstLineEnd = text.indexOf('\n');
  const headerLine = (firstLineEnd === -1 ? text : text.slice(0, firstLineEnd))
    .split(',')
    .map((name) => name.trim().replace(/^"|"$/g, ''));
  if (headerLine.length === 0) return { rows: [], errors: ['CSV 为空。'] };
  const missing = HEADERS.filter((name) => !headerLine.includes(name));
  if (missing.length > 0) return { rows: [], errors: [`缺少必需列: ${missing.join(' / ')}`] };

  const parsed = parseCsv(text);
  const errors = [];
  const cards = [];
  const seen = new Set();
  parsed.forEach((row, index) => {
    const line = index + 2; // header = line 1
    const cell = (name) => (row[name] ?? '').trim();
    const knowledgeNodeId = cell('知识节点ID');
    const cardType = cell('卡片类型');
    const front = cell('正面');
    const back = cell('背面');
    if (!knowledgeNodeId) errors.push(`第 ${line} 行: 缺少 知识节点ID`);
    if (!CARD_TYPES.has(cardType)) errors.push(`第 ${line} 行: 卡片类型必须是 CONCLUSION 或 FORMULA，实际「${cardType}」`);
    if (!front) errors.push(`第 ${line} 行: 正面为空`);
    else if (front.length > FRONT_MAX) errors.push(`第 ${line} 行: 正面超过 ${FRONT_MAX} 字符（${front.length}）`);
    if (!back) errors.push(`第 ${line} 行: 背面为空`);
    else if (back.length > BACK_MAX) errors.push(`第 ${line} 行: 背面超过 ${BACK_MAX} 字符（${back.length}）`);
    const dedupeKey = `${knowledgeNodeId}::${front}`;
    if (seen.has(dedupeKey)) errors.push(`第 ${line} 行: 同一节点下正面内容重复（${dedupeKey}）`);
    seen.add(dedupeKey);
    cards.push({ line, knowledgeNodeId, cardType, front, back });
  });
  return { rows: cards, errors };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    console.error('用法: node scripts/import-memory-cards.mjs <csv> [--dry-run | --reviewed-by "名" --rights-confirmed]');
    process.exit(2);
  }
  const csvText = readFileSync(resolve(args.file), 'utf8');
  const { rows, errors } = validateRows(csvText);
  if (errors.length > 0) {
    for (const message of errors) console.error(`  ✗ ${message}`);
    console.error(`\n校验失败：${errors.length} 个错误，未导入任何内容。`);
    process.exit(1);
  }
  console.log(`结构校验通过：${rows.length} 行。`);

  if (!args.dryRun && (!args.reviewedBy || !args.rightsConfirmed)) {
    console.error('拒绝导入（RULE-10）：非 dry-run 必须同时提供 --reviewed-by "具名评审人" 与 --rights-confirmed。');
    process.exit(1);
  }

  if (args.dryRun) {
    const byType = rows.reduce((acc, row) => ({ ...acc, [row.cardType]: (acc[row.cardType] ?? 0) + 1 }), {});
    console.log(`DRY-RUN：将导入 ${rows.length} 张卡片（${JSON.stringify(byType)}），涉及 ${new Set(rows.map((row) => row.knowledgeNodeId)).size} 个节点；未连接数据库校验。`);
    return;
  }

  const prisma = new PrismaClient();
  try {
    const nodeIds = [...new Set(rows.map((row) => row.knowledgeNodeId))];
    const nodes = await prisma.knowledgeNode.findMany({
      where: { id: { in: nodeIds } },
      select: { id: true, isActive: true, name: true },
    });
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const nodeErrors = [];
    for (const row of rows) {
      const node = nodeById.get(row.knowledgeNodeId);
      if (!node) nodeErrors.push(`第 ${row.line} 行: 知识节点不存在（${row.knowledgeNodeId}）`);
      else if (!node.isActive) nodeErrors.push(`第 ${row.line} 行: 知识节点已停用（${node.name}）`);
    }
    if (nodeErrors.length > 0) {
      for (const message of nodeErrors.slice(0, 20)) console.error(`  ✗ ${message}`);
      console.error(`\n节点校验失败：${nodeErrors.length} 个错误，未导入任何内容。`);
      process.exit(1);
    }

    let created = 0;
    let skipped = 0;
    let updated = 0;
    for (const row of rows) {
      const existing = await prisma.memoryCard.findFirst({
        where: { knowledgeNodeId: row.knowledgeNodeId, front: row.front },
        select: { id: true, isActive: true },
      });
      if (existing && !args.update) {
        skipped += 1;
        continue;
      }
      if (existing && args.update) {
        await prisma.memoryCard.update({
          where: { id: existing.id },
          data: {
            back: row.back,
            cardType: row.cardType,
            reviewedBy: args.reviewedBy,
            rightsConfirmed: true,
            isActive: true,
          },
        });
        updated += 1;
        continue;
      }
      await prisma.memoryCard.create({
        data: {
          knowledgeNodeId: row.knowledgeNodeId,
          cardType: row.cardType,
          front: row.front,
          back: row.back,
          reviewedBy: args.reviewedBy,
          rightsConfirmed: true,
        },
      });
      created += 1;
    }
    console.log(`导入完成：created=${created} updated=${updated} skipped=${skipped}（幂等跳过）；评审人=${args.reviewedBy}；rightsConfirmed=true。`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`导入失败: ${error?.message ?? error}`);
  process.exit(1);
});
