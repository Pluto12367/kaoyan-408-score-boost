import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  matchKnowledgePointToNodes,
  normalizeKnowledgeName,
} from '../packages/shared/dist/index.js';

const SUBJECT_CODE = {
  DATA_STRUCTURE: 'DS',
  COMPUTER_ORGANIZATION: 'CO',
  OPERATING_SYSTEM: 'OS',
  COMPUTER_NETWORK: 'CN',
};

const OUTPUT = join(process.cwd(), 'data', '408', 'knowledge-catalog', 'question-tagging-feasibility-audit.json');
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

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function isCoreComplete(question) {
  const hasStem = typeof question.stem === 'string' && question.stem.trim().length > 0;
  const hasAnswer = typeof question.answer === 'string' && question.answer.trim().length > 0;
  if (!hasStem || !hasAnswer) return false;
  if (question.type === 'SINGLE_CHOICE') {
    return Array.isArray(question.options) && question.options.length >= 2;
  }
  return true;
}

function feasibilityClass(candidateCount, complete) {
  if (!complete || candidateCount === 0) return 'INSUFFICIENT';
  if (candidateCount <= 8) return 'READY';
  if (candidateCount <= 15) return 'REVIEWABLE';
  return 'BROAD';
}

function truncate(text, length = 100) {
  const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
  return normalized.length > length ? `${normalized.slice(0, length)}…` : normalized;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for a read-only feasibility audit');
  }
  const prisma = new PrismaClient();
  try {
    const [questions, knowledgePoints, nodes, questionLinks, questionTags] = await Promise.all([
      prisma.question.findMany({
        select: {
          id: true,
          stem: true,
          options: true,
          answer: true,
          analysis: true,
          difficulty: true,
          type: true,
          source: true,
          year: true,
          isCurrent: true,
        },
      }),
      prisma.knowledgePoint.findMany({
        select: { id: true, subject: true, chapter: true, title: true },
      }),
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

    const aliases = loadAliases();
    const atomicNodes = enrichAtomicNodes(nodes).filter((node) => node.subject in SUBJECT_CODE);
    const kpById = new Map(knowledgePoints.map((kp) => [kp.id, kp]));
    const nodeById = new Map(atomicNodes.map((node) => [node.id, node]));

    const kpIdsByQuestion = new Map();
    for (const link of questionLinks) {
      const ids = kpIdsByQuestion.get(link.questionId) ?? [];
      ids.push(link.knowledgePointId);
      kpIdsByQuestion.set(link.questionId, ids);
    }
    const tagIdsByQuestion = new Map();
    for (const tag of questionTags) {
      const ids = tagIdsByQuestion.get(tag.questionId) ?? [];
      ids.push(tag.knowledgeNodeId);
      tagIdsByQuestion.set(tag.questionId, ids);
    }

    const questionRows = [];
    for (const question of questions) {
      const kpIds = [...new Set(kpIdsByQuestion.get(question.id) ?? [])];
      const kps = kpIds
        .map((kpId) => kpById.get(kpId))
        .filter((kp) => kp && kp.subject in SUBJECT_CODE);
      const subjectCodes = [...new Set(kps.map((kp) => SUBJECT_CODE[kp.subject]))];
      const subject = subjectCodes.length === 1 ? subjectCodes[0] : subjectCodes.length > 1 ? 'MIXED' : 'UNKNOWN';

      const candidateIds = new Set(tagIdsByQuestion.get(question.id) ?? []);
      for (const kp of kps) {
        const decision = matchKnowledgePointToNodes(
          { id: kp.id, subject: SUBJECT_CODE[kp.subject], chapter: kp.chapter ?? '', title: kp.title ?? '' },
          atomicNodes,
          aliases,
        );
        for (const candidate of decision.candidateNodes) candidateIds.add(candidate.knowledgeNodeId);
      }
      const candidateCount = candidateIds.size;
      const complete = isCoreComplete(question);
      questionRows.push({
        id: question.id,
        subject,
        questionType: question.type,
        difficulty: question.difficulty,
        source: question.source,
        year: question.year,
        isCurrent: question.isCurrent,
        stem: question.stem,
        options: question.options ?? [],
        answer: question.answer,
        analysis: question.analysis,
        hasStem: typeof question.stem === 'string' && question.stem.trim().length > 0,
        hasOptions: Array.isArray(question.options) && question.options.length >= 2,
        hasAnswer: typeof question.answer === 'string' && question.answer.trim().length > 0,
        hasExplanation: typeof question.analysis === 'string' && question.analysis.trim().length > 0,
        knowledgePointIds: kpIds,
        directTagNodeIds: tagIdsByQuestion.get(question.id) ?? [],
        candidateCount,
        candidateIds: [...candidateIds],
        feasibility: feasibilityClass(candidateCount, complete),
      });
    }

    const total = questionRows.length;
    const bySubject = {};
    const feasibilityCounts = { READY: 0, REVIEWABLE: 0, BROAD: 0, INSUFFICIENT: 0 };
    for (const row of questionRows) {
      bySubject[row.subject] = bySubject[row.subject] ?? { total: 0, READY: 0, REVIEWABLE: 0, BROAD: 0, INSUFFICIENT: 0 };
      bySubject[row.subject].total += 1;
      bySubject[row.subject][row.feasibility] += 1;
      feasibilityCounts[row.feasibility] += 1;
    }

    const bucket = (count) => (count === 0 ? '0' : count <= 3 ? '1-3' : count <= 8 ? '4-8' : count <= 15 ? '9-15' : '>15');
    const buckets = { '0': 0, '1-3': 0, '4-8': 0, '9-15': 0, '>15': 0 };
    const bucketsBySubject = {};
    for (const row of questionRows) {
      const key = bucket(row.candidateCount);
      buckets[key] += 1;
      bucketsBySubject[row.subject] = bucketsBySubject[row.subject] ?? { '0': 0, '1-3': 0, '4-8': 0, '9-15': 0, '>15': 0 };
      bucketsBySubject[row.subject][key] += 1;
    }

    const questionCountByKp = new Map();
    for (const row of questionRows) {
      for (const kpId of row.knowledgePointIds) {
        const set = questionCountByKp.get(kpId) ?? new Set();
        set.add(row.id);
        questionCountByKp.set(kpId, set);
      }
    }
    const kpDistribution = [...questionCountByKp.entries()]
      .map(([kpId, set]) => {
        const kp = kpById.get(kpId);
        const distinctQuestionCount = set.size;
        return {
          knowledgePointId: kpId,
          name: kp?.title ?? kpId,
          subject: kp && kp.subject in SUBJECT_CODE ? SUBJECT_CODE[kp.subject] : 'UNKNOWN',
          chapter: kp?.chapter ?? '',
          distinctQuestionCount,
          percentageOfQuestions: total === 0 ? 0 : Number(((distinctQuestionCount / total) * 100).toFixed(1)),
        };
      })
      .sort((a, b) => b.distinctQuestionCount - a.distinctQuestionCount || a.knowledgePointId.localeCompare(b.knowledgePointId));

    const broadByKp = new Map();
    for (const row of questionRows) {
      if (row.feasibility !== 'BROAD') continue;
      for (const kpId of row.knowledgePointIds) {
        const entry = broadByKp.get(kpId) ?? { counts: [], questions: new Set() };
        entry.counts.push(row.candidateCount);
        entry.questions.add(row.id);
        broadByKp.set(kpId, entry);
      }
    }
    const broadHotspots = [...broadByKp.entries()]
      .map(([kpId, entry]) => {
        const kp = kpById.get(kpId);
        return {
          knowledgePointId: kpId,
          knowledgePointName: kp?.title ?? kpId,
          subject: kp && kp.subject in SUBJECT_CODE ? SUBJECT_CODE[kp.subject] : 'UNKNOWN',
          broadQuestionCount: entry.questions.size,
          medianCandidateCount: median(entry.counts),
          maxCandidateCount: Math.max(...entry.counts),
        };
      })
      .sort((a, b) => b.broadQuestionCount - a.broadQuestionCount || a.knowledgePointId.localeCompare(b.knowledgePointId));

    const SAMPLE_PER_SUBJECT = 10;
    const classOrder = ['READY', 'REVIEWABLE', 'BROAD', 'INSUFFICIENT'];
    const sample = [];
    for (const subjectCode of ['DS', 'CO', 'OS', 'CN']) {
      const rows = questionRows
        .filter((row) => row.subject === subjectCode)
        .sort((a, b) => a.id.localeCompare(b.id));
      const selected = new Set();
      const picked = [];
      const pick = (row) => {
        if (!row || selected.has(row.id) || picked.length >= SAMPLE_PER_SUBJECT) return false;
        selected.add(row.id);
        picked.push(row);
        return true;
      };
      for (const feasibility of classOrder) {
        pick(rows.find((row) => row.feasibility === feasibility));
      }
      const kpIds = [...new Set(rows.flatMap((row) => row.knowledgePointIds))].sort();
      for (const kpId of kpIds) {
        pick(rows.find((row) => row.knowledgePointIds.includes(kpId)));
      }
      for (const row of rows) {
        if (picked.length >= SAMPLE_PER_SUBJECT) break;
        pick(row);
      }
      sample.push(...picked);
    }
    sample.sort((a, b) => a.id.localeCompare(b.id));

    const sampleOutput = sample.map((row) => ({
      questionId: row.id,
      subject: row.subject,
      questionType: row.questionType,
      stemPreview: truncate(row.stem, 100),
      knowledgePoints: row.knowledgePointIds,
      candidateCount: row.candidateCount,
      feasibility: row.feasibility,
      candidateNodes: row.candidateIds.map((id) => {
        const node = nodeById.get(id);
        return node
          ? { id: node.id, name: node.name, chapter: node.chapterName, section: node.sectionName }
          : { id, name: null, chapter: null, section: null };
      }),
    }));

    const taggableCoverage = total === 0 ? 0 : (feasibilityCounts.READY + feasibilityCounts.REVIEWABLE) / total;

    const report = {
      generatedAt: new Date().toISOString(),
      totalQuestions: total,
      questionCompleteness: {
        totalQuestions: total,
        stemPresent: questionRows.filter((row) => row.hasStem).length,
        optionsPresent: questionRows.filter((row) => row.hasOptions).length,
        answerPresent: questionRows.filter((row) => row.hasAnswer).length,
        explanationPresent: questionRows.filter((row) => row.hasExplanation).length,
        withKnowledgePoint: questionRows.filter((row) => row.knowledgePointIds.length > 0).length,
        withoutKnowledgePoint: questionRows.filter((row) => row.knowledgePointIds.length === 0).length,
        singleKnowledgePoint: questionRows.filter((row) => row.knowledgePointIds.length === 1).length,
        multipleKnowledgePoints: questionRows.filter((row) => row.knowledgePointIds.length > 1).length,
        questionTypeCounts: questionRows.reduce((acc, row) => {
          acc[row.questionType] = (acc[row.questionType] ?? 0) + 1;
          return acc;
        }, {}),
        nonCurrentCount: questionRows.filter((row) => !row.isCurrent).length,
      },
      subjectDistribution: Object.fromEntries(
        Object.entries(bySubject).map(([subject, counts]) => [subject, { ...counts, percentage: Number(((counts.total / total) * 100).toFixed(1)) }]),
      ),
      knowledgePointDistribution: kpDistribution,
      candidateNarrowingRules: [
        'subject hard isolation (Question subject derived from KnowledgePoint.subject)',
        'chapter context equality via normalizeKnowledgeName (KP.chapter vs KnowledgeNode chapterName)',
        'name equality (exact or normalized) via Task 2 matcher',
        'active atomic KnowledgeNodes only',
        'no LLM/embedding/fuzzy promotion',
      ],
      candidateCountBuckets: buckets,
      candidateCountBucketsBySubject: bucketsBySubject,
      feasibilitySummary: feasibilityCounts,
      taggableCoverage: Number((taggableCoverage * 100).toFixed(1)),
      perSubjectFeasibility: Object.fromEntries(
        Object.entries(bySubject).map(([subject, counts]) => [subject, counts]),
      ),
      broadHotspots: broadHotspots,
      sample: sampleOutput,
    };
    writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    console.log(`totalQuestions: ${total}`);
    console.log(`READY: ${feasibilityCounts.READY}`);
    console.log(`REVIEWABLE: ${feasibilityCounts.REVIEWABLE}`);
    console.log(`BROAD: ${feasibilityCounts.BROAD}`);
    console.log(`INSUFFICIENT: ${feasibilityCounts.INSUFFICIENT}`);
    console.log(`taggableCoverage: ${(taggableCoverage * 100).toFixed(1)}%`);
    console.log('candidateCountBuckets:', JSON.stringify(buckets));
    console.log('perSubjectFeasibility:', JSON.stringify(bySubject));
    console.log('broadHotspots:', JSON.stringify(broadHotspots.slice(0, 10)));
    console.log(`sample size: ${sample.length}`);
    console.log(`Audit written to ${OUTPUT}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`[question-tagging-feasibility] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
