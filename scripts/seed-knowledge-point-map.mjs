// Seed KnowledgePointNodeMap: bridges the coarse KnowledgePoint ids used by the
// classic learning loop to PRIMARY atomic KnowledgeNode ids in the 408 catalog.
// Idempotent upserts keyed on (knowledgePointId, knowledgeNodeId).
//
// Usage:
//   node scripts/seed-knowledge-point-map.mjs --dry-run   # validate without DB
//   DATABASE_URL=... node scripts/seed-knowledge-point-map.mjs

import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = join(process.cwd(), 'data', '408');
const dryRun = process.argv.includes('--dry-run');

function loadJson(relativePath) {
  return JSON.parse(readFileSync(join(DATA_DIR, relativePath), 'utf8'));
}

function validateMappings(map, tree) {
  const atomicById = new Map(
    tree.nodes.filter((node) => node.nodeType === 'atomicPoint').map((node) => [node.id, node]),
  );
  const errors = [];
  for (const item of map.mappings) {
    if (item.mappingType !== 'PRIMARY') {
      errors.push(`${item.knowledgePointId}: mappingType must be PRIMARY`);
    }
    if (!atomicById.has(item.knowledgeNodeId)) {
      errors.push(`${item.knowledgePointId}: target ${item.knowledgeNodeId} is not an atomic catalog node`);
    }
    if (!(item.confidence > 0 && item.confidence <= 1)) {
      errors.push(`${item.knowledgePointId}: confidence must be in (0, 1]`);
    }
  }
  const ids = map.mappings.map((item) => item.knowledgePointId);
  if (new Set(ids).size !== ids.length) {
    errors.push('duplicate knowledgePointId in mappings');
  }
  if (errors.length > 0) {
    throw new Error(`invalid mapping:\n  ${errors.join('\n  ')}`);
  }
}

async function main() {
  const map = loadJson('knowledge-point-node-map.json');
  const tree = loadJson('knowledge-tree-408-v2.json');
  validateMappings(map, tree);
  console.log(`[seed-knowledge-point-map] validated ${map.mappings.length} PRIMARY mappings`);

  if (dryRun) {
    for (const item of map.mappings) {
      console.log(`  ${item.knowledgePointId} -> ${item.knowledgeNodeId} (${item.confidence}) ${item.note}`);
    }
    console.log('[seed-knowledge-point-map] dry-run only, no database writes');
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to seed KnowledgePointNodeMap');
  }
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.knowledgePoint.findMany({ select: { id: true } });
    const existingIds = new Set(existing.map((row) => row.id));
    const missingPoints = map.mappings
      .filter((item) => !existingIds.has(item.knowledgePointId))
      .map((item) => item.knowledgePointId);
    if (missingPoints.length > 0) {
      throw new Error(`knowledge points missing in DB: ${missingPoints.join(', ')}`);
    }

    for (const item of map.mappings) {
      await prisma.knowledgePointNodeMap.upsert({
        where: {
          knowledgePointId_knowledgeNodeId: {
            knowledgePointId: item.knowledgePointId,
            knowledgeNodeId: item.knowledgeNodeId,
          },
        },
        update: {
          mappingType: item.mappingType,
          confidence: item.confidence,
        },
        create: {
          knowledgePointId: item.knowledgePointId,
          knowledgeNodeId: item.knowledgeNodeId,
          mappingType: item.mappingType,
          confidence: item.confidence,
        },
      });
    }
    const count = await prisma.knowledgePointNodeMap.count();
    console.log(`[seed-knowledge-point-map] done. KnowledgePointNodeMap rows: ${count}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`[seed-knowledge-point-map] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
