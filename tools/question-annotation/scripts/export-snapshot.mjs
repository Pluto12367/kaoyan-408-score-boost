import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  SNAPSHOT_SCHEMA_VERSION,
  classifyRoles,
  snapshotContentHash,
  validateSnapshot,
} from '../core/snapshot.js';

const SUBJECT_CODE = {
  DATA_STRUCTURE: 'DS',
  COMPUTER_ORGANIZATION: 'CO',
  OPERATING_SYSTEM: 'OS',
  COMPUTER_NETWORK: 'CN',
};

function mapSubject(value, context) {
  const code = SUBJECT_CODE[value];
  if (!code) throw new Error(`${context} unknown subject enum ${value}`);
  return code;
}

function deriveQuestionSubject(questionId, links, knowledgePointById) {
  const codes = new Set();
  for (const link of links) {
    if (link.questionId !== questionId) continue;
    const point = knowledgePointById.get(link.knowledgePointId);
    if (!point) throw new Error(`question:${questionId} relation to missing knowledgePoint ${link.knowledgePointId}`);
    codes.add(mapSubject(point.subject, `knowledgePoint:${point.id}`));
  }
  if (codes.size === 0) {
    throw new Error(`question:${questionId} cannot derive subject (no knowledge point relation)`);
  }
  if (codes.size > 1) {
    throw new Error(`question:${questionId} cannot derive subject (cross-subject knowledge points: ${[...codes].join(',')})`);
  }
  return [...codes][0];
}

function enrichNodes(nodes) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return nodes.map((node) => {
    let chapterName = null;
    let sectionName = null;
    if (node.nodeType === 'atomicPoint' && node.parentId) {
      const section = byId.get(node.parentId);
      sectionName = section?.name ?? null;
      chapterName = section?.parentId ? (byId.get(section.parentId)?.name ?? null) : null;
    }
    return {
      id: node.id,
      parentId: node.parentId,
      subject: node.subject,
      nodeType: node.nodeType,
      name: node.name,
      isActive: node.isActive,
      chapterName,
      sectionName,
    };
  });
}

function countRoles(roles) {
  const counts = { INDEPENDENT_UNIT: 0, EXACT_DUPLICATE_COPY: 0, HISTORICAL_ONLY: 0 };
  for (const role of Object.values(roles)) counts[role] = (counts[role] ?? 0) + 1;
  return counts;
}

/**
 * Build a validated AnnotationSnapshot from a read-only Prisma-like source.
 * Only findMany reads are performed; any write method is a bug. The snapshot
 * is validated with Task 1 validateSnapshot and never returned if invalid.
 * `sourceCommit` is the production checkout commit, supplied explicitly by the
 * caller (never derived inside the exporter).
 */
export async function exportSnapshot(prisma, sourceCommit, options = {}) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const [questions, knowledgePoints, questionKnowledgePoints, nodes, families] = await Promise.all([
    prisma.question.findMany({
      select: {
        id: true, stem: true, options: true, answer: true, analysis: true,
        difficulty: true, type: true, source: true, year: true, expectedTimeSec: true,
        contentFingerprint: true, familyId: true, versionNumber: true, isCurrent: true,
      },
    }),
    prisma.knowledgePoint.findMany({
      select: { id: true, subject: true, chapter: true, title: true },
    }),
    prisma.questionKnowledgePoint.findMany({
      select: { questionId: true, knowledgePointId: true },
    }),
    prisma.knowledgeNode.findMany({
      select: { id: true, parentId: true, subject: true, nodeType: true, name: true, isActive: true },
    }),
    prisma.questionFamily.findMany({ select: { id: true } }),
  ]);

  const knowledgePointById = new Map(knowledgePoints.map((point) => [point.id, point]));
  const snapshotQuestions = questions.map((question) => ({
    id: question.id,
    subject: deriveQuestionSubject(question.id, questionKnowledgePoints, knowledgePointById),
    stem: question.stem,
    options: question.options ?? [],
    answer: question.answer,
    analysis: question.analysis,
    difficulty: question.difficulty,
    type: question.type,
    source: question.source,
    year: question.year ?? null,
    expectedTimeSec: question.expectedTimeSec,
    contentFingerprint: question.contentFingerprint,
    familyId: question.familyId,
    versionNumber: question.versionNumber,
    isCurrent: question.isCurrent,
  }));
  const snapshotKnowledgePoints = knowledgePoints.map((point) => ({
    id: point.id,
    subject: mapSubject(point.subject, `knowledgePoint:${point.id}`),
    chapter: point.chapter,
    title: point.title,
  }));
  const snapshotRelations = questionKnowledgePoints.map((link) => ({
    questionId: link.questionId,
    knowledgePointId: link.knowledgePointId,
  }));
  const snapshotNodes = enrichNodes(nodes);
  const byId = (left, right) => left.id.localeCompare(right.id);
  snapshotQuestions.sort(byId);
  snapshotKnowledgePoints.sort(byId);
  snapshotRelations.sort(
    (left, right) => left.questionId.localeCompare(right.questionId) || left.knowledgePointId.localeCompare(right.knowledgePointId),
  );
  snapshotNodes.sort(byId);

  const { roles, duplicateRepresentative } = classifyRoles(
    questions.map((question) => ({
      id: question.id,
      isCurrent: question.isCurrent,
      contentFingerprint: question.contentFingerprint,
      familyId: question.familyId,
      versionNumber: question.versionNumber,
    })),
  );

  const contentBase = {
    questions: snapshotQuestions,
    knowledgePoints: snapshotKnowledgePoints,
    questionKnowledgePoints: snapshotRelations,
    nodes: snapshotNodes,
  };
  const contentSha256 = snapshotContentHash(contentBase);
  const roleCounts = countRoles(roles);
  const snapshot = {
    snapshotId: `snap-${contentSha256.slice(0, 12)}`,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt,
    sourceCommit,
    counts: {
      totalRows: questions.length,
      currentRows: questions.filter((question) => question.isCurrent).length,
      nonCurrentRows: questions.filter((question) => !question.isCurrent).length,
      independentUnits: roleCounts.INDEPENDENT_UNIT,
      exactDuplicateCopies: roleCounts.EXACT_DUPLICATE_COPY,
      historicalOnly: roleCounts.HISTORICAL_ONLY,
      knowledgePoints: snapshotKnowledgePoints.length,
      questionKnowledgePoints: snapshotRelations.length,
      knowledgeNodes: snapshotNodes.length,
      activeAtomicNodes: nodes.filter((node) => node.nodeType === 'atomicPoint' && node.isActive).length,
      questionFamilies: families.length,
    },
    contentSha256,
    ...contentBase,
    roles,
    duplicateRepresentative,
  };

  const validation = validateSnapshot(snapshot);
  if (!validation.ok) {
    throw new Error(`snapshot validation failed: ${validation.errors.join('; ')}`);
  }
  return snapshot;
}

export function writeSnapshotFile(snapshot, dir, options = {}) {
  const validation = validateSnapshot(snapshot);
  if (!validation.ok) {
    throw new Error(`snapshot validation failed: ${validation.errors.join('; ')}`);
  }
  const snapshotPath = join(dir, `snapshot-${snapshot.snapshotId}.json`);
  const manifestPath = join(dir, 'snapshot-manifest.json');
  if (!options.overwrite && (existsSync(snapshotPath) || existsSync(manifestPath))) {
    throw new Error(`output exists; pass overwrite to replace ${snapshotPath}`);
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  writeFileSync(
    manifestPath,
    `${JSON.stringify({
      snapshotId: snapshot.snapshotId,
      schemaVersion: snapshot.schemaVersion,
      generatedAt: snapshot.generatedAt,
      sourceCommit: snapshot.sourceCommit,
      counts: snapshot.counts,
      roles: countRoles(snapshot.roles ?? {}),
      contentSha256: snapshot.contentSha256,
      snapshotFile: basename(snapshotPath),
    }, null, 2)}\n`,
    'utf8',
  );
  return { snapshotPath, manifestPath };
}

export function readSnapshotFile(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function parseArgs(argv) {
  const args = { sourceCommit: null, output: null, generatedAt: null, overwrite: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--source-commit') args.sourceCommit = argv[++index];
    else if (flag === '--output') args.output = argv[++index];
    else if (flag === '--generated-at') args.generatedAt = argv[++index];
    else if (flag === '--overwrite') args.overwrite = true;
  }
  return args;
}

function printSummary(snapshot, outputPath) {
  const subjectCounts = {};
  for (const question of snapshot.questions) {
    subjectCounts[question.subject] = (subjectCounts[question.subject] ?? 0) + 1;
  }
  const { counts, roles, contentSha256 } = snapshot;
  console.log(`snapshotId: ${snapshot.snapshotId}`);
  console.log(`sourceCommit: ${snapshot.sourceCommit}`);
  console.log(`counts: ${JSON.stringify(counts)}`);
  console.log(`roles: ${JSON.stringify(countRoles(roles))}`);
  console.log(`subjectCounts: ${JSON.stringify(subjectCounts)}`);
  console.log(`contentSha256: ${contentSha256}`);
  console.log(`output: ${outputPath}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.sourceCommit || !args.output) {
    throw new Error(
      'usage: node scripts/export-snapshot.mjs --source-commit <production-checkout-HEAD> --output <dir> [--generated-at <iso>] [--overwrite]',
    );
  }
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const snapshot = await exportSnapshot(prisma, args.sourceCommit, {
      ...(args.generatedAt ? { generatedAt: args.generatedAt } : {}),
    });
    const { snapshotPath } = writeSnapshotFile(snapshot, args.output, { overwrite: args.overwrite });
    printSummary(snapshot, snapshotPath);
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[export-snapshot] FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
