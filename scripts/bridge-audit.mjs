import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  buildBridgeAudit,
  matchAllKnowledgePoints,
} from '../packages/shared/dist/index.js';

const SUBJECT_CODE = {
  DATA_STRUCTURE: 'DS',
  COMPUTER_ORGANIZATION: 'CO',
  OPERATING_SYSTEM: 'OS',
  COMPUTER_NETWORK: 'CN',
};

const AUDIT_OUTPUT = join(process.cwd(), 'data', '408', 'knowledge-catalog', 'question-node-bridge-audit.json');
const ALIAS_PATH = join(process.cwd(), 'data', '408', 'knowledge-catalog', 'bridge-aliases.json');

function loadAliases() {
  const raw = JSON.parse(readFileSync(ALIAS_PATH, 'utf8'));
  return Array.isArray(raw.aliases) ? raw.aliases : [];
}

function enrichAtomicNodes(nodes) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const enriched = [];
  for (const node of nodes) {
    if (node.nodeType !== 'atomicPoint') continue;
    const section = node.parentId ? byId.get(node.parentId) : undefined;
    const chapter = section?.parentId ? byId.get(section.parentId) : undefined;
    enriched.push({
      id: node.id,
      subject: node.subject,
      nodeType: node.nodeType,
      name: node.name,
      chapterName: chapter?.name ?? null,
      sectionName: section?.name ?? null,
    });
  }
  return enriched;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for a read-only bridge audit');
  }
  const prisma = new PrismaClient();
  try {
    const [knowledgePoints, nodes, questionLinks, questionTags] = await Promise.all([
      prisma.knowledgePoint.findMany({ select: { id: true, subject: true, chapter: true, title: true } }),
      prisma.knowledgeNode.findMany({
        select: { id: true, parentId: true, subject: true, nodeType: true, name: true, isActive: true },
      }),
      prisma.questionKnowledgePoint.findMany({
        select: { questionId: true, knowledgePointId: true },
      }),
      prisma.questionKnowledgeNodeTag.findMany({
        select: { questionId: true, knowledgeNodeId: true },
      }),
    ]);
    const questionIds = await prisma.question.findMany({ select: { id: true } });

    const knowledgePointInputs = [];
    const skippedSubjects = new Set();
    for (const kp of knowledgePoints) {
      const subject = SUBJECT_CODE[kp.subject];
      if (!subject) {
        skippedSubjects.add(String(kp.subject));
        continue;
      }
      knowledgePointInputs.push({
        id: kp.id,
        subject,
        chapter: kp.chapter ?? '',
        title: kp.title ?? '',
      });
    }

    const atomicNodes = enrichAtomicNodes(nodes);
    const activeNodeIds = new Set(
      nodes
        .filter((node) => node.nodeType === 'atomicPoint' && node.isActive)
        .map((node) => node.id),
    );

    const aliases = loadAliases();
    const decisions = matchAllKnowledgePoints(
      knowledgePointInputs,
      atomicNodes,
      aliases,
    );

    const knowledgePointIdsByQuestion = new Map();
    for (const link of questionLinks) {
      const ids = knowledgePointIdsByQuestion.get(link.questionId) ?? [];
      ids.push(link.knowledgePointId);
      knowledgePointIdsByQuestion.set(link.questionId, ids);
    }
    const tagNodeIdsByQuestion = new Map();
    for (const tag of questionTags) {
      const ids = tagNodeIdsByQuestion.get(tag.questionId) ?? [];
      ids.push(tag.knowledgeNodeId);
      tagNodeIdsByQuestion.set(tag.questionId, ids);
    }
    const questions = questionIds.map((question) => {
      const live = {
        id: question.id,
        knowledgePointIds: knowledgePointIdsByQuestion.get(question.id) ?? [],
      };
      const tagIds = tagNodeIdsByQuestion.get(question.id);
      if (tagIds?.length) live.directTagNodeIds = tagIds;
      return live;
    });

    const report = buildBridgeAudit(decisions, questions, {
      activeNodeIds,
      generatedAt: new Date().toISOString(),
    });
    writeFileSync(AUDIT_OUTPUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    const { summary } = report;
    console.log(`KnowledgePoint total: ${summary.knowledgePointTotal}`);
    console.log(`ACTIVE: ${summary.activeKnowledgePoints}`);
    console.log(`PENDING_REVIEW: ${summary.pendingKnowledgePoints}`);
    console.log(`UNMATCHED: ${summary.unmatchedKnowledgePoints}`);
    console.log(`ACTIVE coverage: ${(summary.activeCoverage * 100).toFixed(1)}%`);
    console.log(`Live Question total: ${summary.liveQuestionTotal}`);
    console.log(`Resolvable: ${summary.resolvableQuestions}`);
    console.log(`Unresolvable: ${summary.liveQuestionTotal - summary.resolvableQuestions}`);
    console.log(`Question resolvable coverage: ${(summary.questionResolvableCoverage * 100).toFixed(1)}%`);
    if (skippedSubjects.size > 0) {
      console.log(`Skipped knowledge points with unknown subject enum: ${[...skippedSubjects].join(', ')}`);
    }

    const printHotspots = (label, entries, limit) => {
      console.log(`\nTop ${limit} ${label} by affectedQuestionCount`);
      for (const entry of entries.slice(0, limit)) {
        console.log(
          `${entry.knowledgePointId} | ${entry.knowledgePointName} | ${entry.subject} | affected=${entry.affectedQuestionCount} | ${entry.reasons.join(',')} | candidates=${entry.candidateNodes.map((c) => c.knowledgeNodeId).join(',') || '-'}`,
        );
      }
    };
    printHotspots('PENDING_REVIEW', report.pendingReview, 10);
    printHotspots('UNMATCHED', report.unmatched, 10);
    console.log(`\nAudit written to ${AUDIT_OUTPUT}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`[bridge-audit] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
