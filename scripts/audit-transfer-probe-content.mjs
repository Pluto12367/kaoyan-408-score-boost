/**
 * Phase B — Transfer Probe content audit (READ-ONLY).
 *
 * Two modes, both read-only. This script never writes to the database and never
 * modifies any file:
 *
 *   node scripts/audit-transfer-probe-content.mjs --candidates [--limit 30]
 *     Emits the B1 candidate node list (nodeId / subject / examImportance /
 *     reason) from the live frequency snapshots and knowledge nodes.
 *
 *   node scripts/audit-transfer-probe-content.mjs --validate [--json]
 *     Reads every `Question` with source = 'transfer_probe_pool', resolves its
 *     knowledge node through the same tiers production uses (direct tag, then
 *     the legacy point→node bridge), loads the human-authored isomorphism
 *     manifest if present, and runs the shared pure validator
 *     (validateProbeContent). Prints the readiness report and the verdict.
 *
 * It cannot mark anything `verified`: that requires a named human review recorded
 * in the manifest AND the structural facts to agree with the database.
 *
 * The candidate ordering is deliberately lexicographic
 * (primaryScore5y, recent3Frequency, importance, nodeId) and is NOT the product's
 * ranking model. It exists only to plan content work and is wired into nothing.
 *
 * Prerequisite: a database with the canonical 408 content seeded
 * (`node scripts/seed-408-v2.mjs`).
 */

import { PrismaClient } from '@prisma/client';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const shared = require('../packages/shared/dist/index.js');

const {
  validateProbeContent,
  PROBE_CONTENT_TARGET_NODES,
  PROBE_CONTENT_MIN_PER_NODE,
  PROBE_POOL_SOURCE,
} = shared;

const DATABASE_URL = process.env.DATABASE_URL
  ?? 'postgresql://postgres:postgres@127.0.0.1:55432/kaoyan408_test?schema=public';
const MANIFEST_PATH = join(process.cwd(), 'data', '408', 'transfer-probe-manifest.json');

const args = process.argv.slice(2);
const wantCandidates = args.includes('--candidates');
const wantValidate = args.includes('--validate');
const wantJson = args.includes('--json');
const limitIndex = args.indexOf('--limit');
const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) || 30 : 30;

if (!wantCandidates && !wantValidate) {
  console.error('usage: --candidates [--limit N] | --validate [--json]');
  process.exit(2);
}

/** Latest snapshot per node, ordered by the declared content-planning rule. */
async function loadCandidateNodes(prisma, take) {
  const snapshots = await prisma.knowledgeFrequencySnapshot.findMany({
    orderBy: [{ knowledgeNodeId: 'asc' }, { snapshotDate: 'desc' }],
    select: {
      knowledgeNodeId: true, primaryScore5y: true, recent3Frequency: true,
      recent5Frequency: true, trendDirection: true, evidenceConfidence: true,
    },
  });
  const latest = new Map();
  for (const row of snapshots) if (!latest.has(row.knowledgeNodeId)) latest.set(row.knowledgeNodeId, row);

  const nodes = await prisma.knowledgeNode.findMany({
    where: { isActive: true, nodeType: 'atomicPoint' },
    select: { id: true, subject: true, name: true, importance: true, difficulty: true },
  });

  const eligible = [];
  for (const node of nodes) {
    const snapshot = latest.get(node.id);
    if (!snapshot) continue;
    if (snapshot.evidenceConfidence === 'LOW') continue;
    if (snapshot.recent3Frequency < 2) continue;
    eligible.push({ node, snapshot });
  }

  eligible.sort((left, right) =>
    right.snapshot.primaryScore5y - left.snapshot.primaryScore5y
    || right.snapshot.recent3Frequency - left.snapshot.recent3Frequency
    || right.node.importance - left.node.importance
    || left.node.id.localeCompare(right.node.id));

  return { eligible, top: eligible.slice(0, take) };
}

function candidateReason(node, snapshot) {
  const parts = [];
  if (snapshot.primaryScore5y > 0) parts.push(`近 5 年真题分值 ${snapshot.primaryScore5y}`);
  parts.push(`近 3 年出现 ${snapshot.recent3Frequency} 次`);
  parts.push(`节点重要度 ${node.importance}`);
  if (snapshot.trendDirection === 'RISING') parts.push('考查趋势上升');
  parts.push(`考频证据置信 ${snapshot.evidenceConfidence}`);
  return parts.join('；');
}

async function runCandidates(prisma) {
  const { eligible, top } = await loadCandidateNodes(prisma, limit);
  const withScore = eligible.filter((row) => row.snapshot.primaryScore5y > 0).length;
  if (wantJson) {
    console.log(JSON.stringify({
      eligibleNodeCount: eligible.length,
      eligibleWithPrimaryScore: withScore,
      rule: 'eligible: isActive && nodeType=atomicPoint && evidenceConfidence in (HIGH,MEDIUM) && recent3Frequency>=2; order: primaryScore5y desc, recent3Frequency desc, importance desc, nodeId asc',
      candidates: top.map((row) => ({
        nodeId: row.node.id,
        subject: row.node.subject,
        name: row.node.name,
        examImportance: row.node.importance,
        difficulty: row.node.difficulty,
        primaryScore5y: row.snapshot.primaryScore5y,
        recent3Frequency: row.snapshot.recent3Frequency,
        recent5Frequency: row.snapshot.recent5Frequency,
        trendDirection: row.snapshot.trendDirection,
        evidenceConfidence: row.snapshot.evidenceConfidence,
        reason: candidateReason(row.node, row.snapshot),
      })),
    }, null, 2));
    return;
  }
  console.log(`eligible nodes: ${eligible.length} (with primaryScore5y>0: ${withScore})`);
  console.log(`showing top ${top.length}`);
  console.log('');
  console.log('| # | nodeId | subject | examImportance | reason |');
  console.log('|---|---|---|---|---|');
  top.forEach((row, index) => {
    console.log(`| ${index + 1} | ${row.node.id} | ${row.node.subject} | ${row.node.importance} | ${candidateReason(row.node, row.snapshot)} |`);
  });
}

/**
 * Question → PRIMARY node, using the same tiers production uses: an explicit
 * `QuestionKnowledgeNodeTag` wins, otherwise the legacy
 * `QuestionKnowledgePoint` → `KnowledgePointNodeMap` bridge. Querying only the
 * tag table would be blind to every bridged question (the V12.1 defect).
 */
async function resolveNodeIds(prisma, questionId) {
  const tags = await prisma.questionKnowledgeNodeTag.findMany({
    where: { questionId },
    select: { knowledgeNodeId: true, role: true },
  });
  if (tags.length > 0) {
    const sorted = [...tags].sort((left, right) => (left.role === 'PRIMARY' ? 0 : 1) - (right.role === 'PRIMARY' ? 0 : 1));
    return [sorted[0].knowledgeNodeId];
  }
  const points = await prisma.questionKnowledgePoint.findMany({
    where: { questionId },
    select: { knowledgePointId: true },
  });
  if (points.length === 0) return [];
  const maps = await prisma.knowledgePointNodeMap.findMany({
    where: { knowledgePointId: { in: points.map((row) => row.knowledgePointId) } },
    select: { knowledgeNodeId: true, mappingType: true },
  });
  if (maps.length === 0) return [];
  const sorted = [...maps].sort((left, right) => (left.mappingType === 'PRIMARY' ? 0 : 1) - (right.mappingType === 'PRIMARY' ? 0 : 1));
  return [sorted[0].knowledgeNodeId];
}

function rubricCriteriaCount(rubric) {
  if (!rubric || typeof rubric !== 'object') return 0;
  const criteria = rubric.criteria;
  return Array.isArray(criteria) ? criteria.length : 0;
}

async function runValidate(prisma) {
  const poolRows = await prisma.question.findMany({
    where: { source: PROBE_POOL_SOURCE },
    select: {
      id: true, source: true, type: true, difficulty: true, contentFingerprint: true,
      familyId: true, answer: true, analysis: true, rubric: true,
    },
  });

  const questions = [];
  for (const row of poolRows) {
    const nodeIds = await resolveNodeIds(prisma, row.id);
    const priorAttempts = await prisma.practiceRecord.count({ where: { questionId: row.id } });
    const priorExposures = await prisma.learningSession.count({ where: { questionIds: { has: row.id } } });
    questions.push({
      questionId: row.id,
      source: row.source,
      type: String(row.type),
      difficulty: String(row.difficulty),
      contentFingerprint: row.contentFingerprint,
      familyId: row.familyId,
      answer: row.answer ?? '',
      analysis: row.analysis ?? '',
      rubricCriteriaCount: rubricCriteriaCount(row.rubric),
      nodeIds,
      priorAttempts,
      priorExposures,
    });
  }

  const manifest = existsSync(MANIFEST_PATH)
    ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
    : null;

  const { top, eligible } = await loadCandidateNodes(prisma, PROBE_CONTENT_TARGET_NODES);
  const candidateNodeIds = (top.length >= PROBE_CONTENT_TARGET_NODES ? top : eligible)
    .map((row) => row.node.id)
    .slice(0, PROBE_CONTENT_TARGET_NODES);

  const report = validateProbeContent({
    questions,
    manifest,
    candidateNodeIds,
    minQuestionsPerNode: PROBE_CONTENT_MIN_PER_NODE,
    targetNodeCount: PROBE_CONTENT_TARGET_NODES,
  });

  if (wantJson) {
    console.log(JSON.stringify({ manifestPresent: manifest != null, report }, null, 2));
    return;
  }

  console.log(`pool source            : ${PROBE_POOL_SOURCE}`);
  console.log(`manifest               : ${manifest != null ? MANIFEST_PATH : 'absent (no human isomorphism evidence recorded)'}`);
  console.log(`candidate nodes        : ${candidateNodeIds.length} (target ${PROBE_CONTENT_TARGET_NODES})`);
  console.log(`pool questions         : ${report.totals.questions}`);
  console.log(`verified               : ${report.totals.verified}`);
  console.log(`unverified             : ${report.totals.unverified}`);
  console.log(`unattributable         : ${report.totals.missing}`);
  console.log(`nodes meeting target   : ${report.totals.nodesMeetingTarget} / ${PROBE_CONTENT_TARGET_NODES} (>=${PROBE_CONTENT_MIN_PER_NODE} verified each)`);
  console.log(`rubric covered         : ${report.totals.rubricCovered} / ${report.totals.rubricRequired} required`);
  console.log(`difficulty coverage    : ${JSON.stringify(report.difficultyCoverage)}`);
  console.log(`type coverage          : ${JSON.stringify(report.typeCoverage)}`);
  console.log(`pool isolation         : ${report.exposure.clean ? 'clean' : `${report.exposure.exposedQuestionCount} question(s) already seen`}`);
  console.log(`coverage gap           : nodes -${report.coverageGap.nodeShortfall}, verified questions -${report.coverageGap.questionShortfall}`);
  if (report.blocking.length > 0) {
    console.log('');
    console.log(`blocking findings (${report.blocking.length}):`);
    for (const finding of report.blocking.slice(0, 40)) {
      console.log(`  - ${finding.code}: ${finding.detail}${finding.questionId ? ` [${finding.questionId}]` : ''}`);
    }
    if (report.blocking.length > 40) console.log(`  ... and ${report.blocking.length - 40} more`);
  }
  console.log('');
  console.log(report.verdict);
}

async function main() {
  const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });
  try {
    if (wantCandidates) await runCandidates(prisma);
    if (wantValidate) await runValidate(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('content audit failed:', error?.message ?? error);
  process.exit(1);
});
