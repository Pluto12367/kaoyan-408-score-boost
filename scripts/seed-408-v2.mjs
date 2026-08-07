import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verify408Data } from './verify-408-data.mjs';

const DATA_DIR = join(process.cwd(), 'data', '408');
const SNAPSHOT_DATE = new Date('2026-08-07T00:00:00.000Z');
const FREQUENCY_MODEL_VERSION = 'frequency-v2-2026-08-07';

function loadJson(relativePath) {
  return JSON.parse(readFileSync(join(DATA_DIR, relativePath), 'utf8'));
}

async function upsertKnowledgeNodes(prisma, nodes) {
  for (const node of nodes) {
    await prisma.knowledgeNode.upsert({
      where: { id: node.id },
      update: {
        parentId: node.parentId,
        subject: node.subject,
        nodeType: node.nodeType,
        name: node.name,
        importance: node.importance,
        difficulty: node.difficulty,
        syllabusVersion: node.syllabusVersion,
        isActive: true,
      },
      create: {
        id: node.id,
        parentId: node.parentId,
        subject: node.subject,
        nodeType: node.nodeType,
        name: node.name,
        importance: node.importance,
        difficulty: node.difficulty,
        syllabusVersion: node.syllabusVersion,
        isActive: true,
      },
    });
  }
}

async function upsertKnowledgeRelations(prisma, nodes) {
  const relations = [];
  for (const node of nodes) {
    for (const prerequisite of node.prerequisites ?? []) {
      relations.push({ fromId: node.id, toId: prerequisite, type: 'PREREQUISITE' });
    }
    for (const related of node.relatedPoints ?? []) {
      relations.push({ fromId: node.id, toId: related, type: 'RELATED' });
    }
  }
  for (const relation of relations) {
    await prisma.knowledgeRelation.upsert({
      where: {
        fromId_toId_type: {
          fromId: relation.fromId,
          toId: relation.toId,
          type: relation.type,
        },
      },
      update: {},
      create: relation,
    });
  }
  return relations.length;
}

async function upsertExamYear(prisma, year) {
  const bundle = loadJson(`exam-mapping/408-${year}-question-knowledge-map.json`);
  const paperId = `paper-408-${year}`;
  await prisma.examPaper.upsert({
    where: { id: paperId },
    update: {
      exam: '408',
      year,
      totalScore: bundle.meta.totalScore,
      source: bundle.meta.sources?.[0]?.name ?? null,
    },
    create: {
      id: paperId,
      exam: '408',
      year,
      totalScore: bundle.meta.totalScore,
      source: bundle.meta.sources?.[0]?.name ?? null,
    },
  });

  let tagCount = 0;
  for (const question of bundle.questions) {
    await prisma.examQuestion.upsert({
      where: { id: question.id },
      update: {
        paperId,
        questionNo: question.questionNo,
        subject: question.subject,
        questionType: question.questionType,
        score: question.score ?? null,
        summary: question.summary ?? null,
        sourceRef: bundle.meta.sources?.[0]?.url ?? null,
      },
      create: {
        id: question.id,
        paperId,
        questionNo: question.questionNo,
        subject: question.subject,
        questionType: question.questionType,
        score: question.score ?? null,
        summary: question.summary ?? null,
        sourceRef: bundle.meta.sources?.[0]?.url ?? null,
      },
    });

    const tagTargets = [
      { role: 'PRIMARY', knowledgeNodeId: question.primaryKnowledgePointId },
      ...(question.secondaryKnowledgePointIds ?? []).map((knowledgeNodeId) => ({
        role: 'SECONDARY',
        knowledgeNodeId,
      })),
    ];
    for (const tag of tagTargets) {
      await prisma.examQuestionKnowledgeTag.upsert({
        where: {
          questionId_knowledgeNodeId_role: {
            questionId: question.id,
            knowledgeNodeId: tag.knowledgeNodeId,
            role: tag.role,
          },
        },
        update: {
          confidence: question.mappingConfidence,
          precision: 'EXACT_ATOMIC',
          taggedBy: 'HYBRID',
        },
        create: {
          questionId: question.id,
          knowledgeNodeId: tag.knowledgeNodeId,
          role: tag.role,
          confidence: question.mappingConfidence,
          precision: 'EXACT_ATOMIC',
          taggedBy: 'HYBRID',
        },
      });
      tagCount += 1;
    }
  }
  return { paperId, questionCount: bundle.questions.length, tagCount };
}

async function upsertFrequencySnapshots(prisma, items) {
  for (const item of items) {
    await prisma.knowledgeFrequencySnapshot.upsert({
      where: {
        knowledgeNodeId_snapshotDate_modelVersion: {
          knowledgeNodeId: item.knowledgePointId,
          snapshotDate: SNAPSHOT_DATE,
          modelVersion: FREQUENCY_MODEL_VERSION,
        },
      },
      update: {
        recent3Frequency: item.recent3Y.frequency,
        recent5Frequency: item.recent5Y.frequency,
        allTimeEvidence: item.allTimeEvidence.frequency,
        primaryScore5y: item.recent5Y.primaryScore,
        trendDirection: item.trend.direction.toUpperCase(),
        trendDelta: item.trend.delta,
        evidenceConfidence: item.evidenceConfidence.toUpperCase(),
      },
      create: {
        knowledgeNodeId: item.knowledgePointId,
        snapshotDate: SNAPSHOT_DATE,
        modelVersion: FREQUENCY_MODEL_VERSION,
        recent3Frequency: item.recent3Y.frequency,
        recent5Frequency: item.recent5Y.frequency,
        allTimeEvidence: item.allTimeEvidence.frequency,
        primaryScore5y: item.recent5Y.primaryScore,
        trendDirection: item.trend.direction.toUpperCase(),
        trendDelta: item.trend.delta,
        evidenceConfidence: item.evidenceConfidence.toUpperCase(),
      },
    });
  }
}

async function countRows(prisma) {
  const [knowledgeNode, knowledgeRelation, examPaper, examQuestion, examTag, frequency, mastery] = await Promise.all([
    prisma.knowledgeNode.count(),
    prisma.knowledgeRelation.count(),
    prisma.examPaper.count(),
    prisma.examQuestion.count(),
    prisma.examQuestionKnowledgeTag.count(),
    prisma.knowledgeFrequencySnapshot.count(),
    prisma.userKnowledgeMastery.count(),
  ]);
  return {
    KnowledgeNode: knowledgeNode,
    KnowledgeRelation: knowledgeRelation,
    ExamPaper: examPaper,
    ExamQuestion: examQuestion,
    ExamQuestionKnowledgeTag: examTag,
    KnowledgeFrequencySnapshot: frequency,
    UserKnowledgeMastery: mastery,
  };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to seed 408 data');
  }
  const summary = verify408Data();
  console.log(
    `[seed-408-v2] data verified: ${summary.nodes} nodes, ${summary.frequencyItems} frequency items.`,
  );

  const prisma = new PrismaClient();
  try {
    const tree = loadJson('knowledge-tree-408-v2.json');
    const frequency = loadJson('frequency-model-v2.json');

    await upsertKnowledgeNodes(prisma, tree.nodes);
    const relationCount = await upsertKnowledgeRelations(prisma, tree.nodes);

    const examSummary = [];
    for (const year of [2022, 2023, 2024, 2025, 2026]) {
      examSummary.push(await upsertExamYear(prisma, year));
    }
    await upsertFrequencySnapshots(prisma, frequency.items);

    const after = await countRows(prisma);
    // Idempotency invariant: every stable seed ID must exist exactly once after seeding.
    // Upserts keyed on stable IDs plus unique constraints prevent duplicate rows on re-runs.
    const seededNodeIds = tree.nodes.map((node) => node.id);
    const seededNodeCount = await prisma.knowledgeNode.count({
      where: { id: { in: seededNodeIds } },
    });
    if (seededNodeCount !== seededNodeIds.length) {
      throw new Error(
        `[seed-408-v2] idempotency violation: expected ${seededNodeIds.length} seeded nodes, found ${seededNodeCount}`,
      );
    }

    console.log('[seed-408-v2] done. Row counts:');
    for (const table of Object.keys(after)) {
      console.log(`  ${table}: ${after[table]}`);
    }
    console.log(`  KnowledgeRelation (imported this run): ${relationCount}`);
    for (const yearSummary of examSummary) {
      console.log(
        `  ${yearSummary.paperId}: ${yearSummary.questionCount} questions, ${yearSummary.tagCount} exact atomic tags`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`[seed-408-v2] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
