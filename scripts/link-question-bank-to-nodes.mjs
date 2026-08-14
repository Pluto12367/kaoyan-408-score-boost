#!/usr/bin/env node
// Link every live question to its atomic KnowledgeNodes via the documented
// deterministic chain: existing QuestionKnowledgeNodeTag -> fallback
// QuestionKnowledgePoint -> KnowledgePointNodeMap (PRIMARY). Idempotent.
//
// Usage:
//   node scripts/link-question-bank-to-nodes.mjs --dry-run
//   node scripts/link-question-bank-to-nodes.mjs
import { PrismaClient } from '@prisma/client';
import { pathToFileURL } from 'node:url';

export const BRIDGE_TAG_SOURCE = 'bridge:knowledge-point-map';

export function planQuestionNodeLinks({
  questions,
  nodeMapByPoint,
  taggedQuestionIds,
}) {
  const toCreate = [];
  const unresolvable = [];
  let linked = 0;
  for (const question of questions) {
    if (taggedQuestionIds.has(question.id)) {
      linked += 1;
      continue;
    }
    const pointIds = question.knowledgePointIds?.length
      ? question.knowledgePointIds
      : [question.knowledgePointId];
    const nodeIds = [];
    for (const pointId of pointIds) {
      const nodeId = nodeMapByPoint.get(pointId);
      if (nodeId && !nodeIds.includes(nodeId)) nodeIds.push(nodeId);
    }
    if (nodeIds.length === 0) {
      unresolvable.push({ questionId: question.id, reason: 'no PRIMARY knowledge-point node map' });
      continue;
    }
    for (const knowledgeNodeId of nodeIds) {
      toCreate.push({
        questionId: question.id,
        knowledgeNodeId,
        role: 'PRIMARY',
        confidence: 1.0,
        taggedBy: 'HYBRID',
        source: BRIDGE_TAG_SOURCE,
      });
    }
    linked += 1;
  }
  const total = questions.length;
  return {
    total,
    linked,
    coverage: total ? linked / total : 0,
    toCreate,
    unresolvable,
  };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const prisma = new PrismaClient();
  try {
    const [questions, maps, tags] = await Promise.all([
      prisma.question.findMany({
        where: { isCurrent: true },
        select: {
          id: true,
          knowledgePoints: { select: { knowledgePointId: true } },
        },
        orderBy: { id: 'asc' },
      }),
      prisma.knowledgePointNodeMap.findMany({
        where: { mappingType: 'PRIMARY' },
        select: { knowledgePointId: true, knowledgeNodeId: true },
      }),
      prisma.questionKnowledgeNodeTag.findMany({
        select: { questionId: true },
      }),
    ]);
    const nodeMapByPoint = new Map();
    for (const map of maps) {
      if (!nodeMapByPoint.has(map.knowledgePointId)) {
        nodeMapByPoint.set(map.knowledgePointId, map.knowledgeNodeId);
      }
    }
    const taggedQuestionIds = new Set(tags.map((tag) => tag.questionId));
    const plan = planQuestionNodeLinks({
      questions: questions.map((question) => ({
        id: question.id,
        knowledgePointIds: question.knowledgePoints.map((link) => link.knowledgePointId),
      })),
      nodeMapByPoint,
      taggedQuestionIds,
    });
    const gate = 0.7;
    console.log(JSON.stringify({
      dryRun,
      total: plan.total,
      linked: plan.linked,
      coverage: plan.coverage,
      gate,
      toCreate: plan.toCreate.length,
      unresolvable: plan.unresolvable,
    }, null, 2));
    if (plan.coverage < gate) {
      console.error(`BRIDGE ROLLOUT BLOCKED: question resolvable coverage ${plan.coverage} < ${gate}`);
      process.exitCode = 2;
      return;
    }
    if (dryRun) return;
    let created = 0;
    for (const link of plan.toCreate) {
      await prisma.questionKnowledgeNodeTag.create({ data: link });
      created += 1;
    }
    console.log(`[link-question-bank-to-nodes] created ${created} question->node tags.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
