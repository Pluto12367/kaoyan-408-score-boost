import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const DATA_DIR = join(process.cwd(), 'data', '408');
const EXPECTED_SUBJECT_SCORES = { DS: 45, CO: 45, OS: 35, CN: 25 };
const SUBJECTS = new Set(['DS', 'CO', 'OS', 'CN']);
const NODE_TYPES = new Set(['subject', 'chapter', 'section', 'atomicPoint']);
const TREND_DIRECTIONS = new Set(['rising', 'stable', 'falling', 'cold']);
const EVIDENCE_CONFIDENCES = new Set(['high', 'medium', 'low']);
const HISTORICAL_MAPPING_STATUSES = new Set([
  'historical-index-awaiting-atomic-inversion',
  'source-tagged-broad',
]);

function loadJson(relativePath) {
  return JSON.parse(readFileSync(join(DATA_DIR, relativePath), 'utf8'));
}

export function verify408Data() {
  const tree = loadJson('knowledge-tree-408-v2.json');
  const frequency = loadJson('frequency-model-v2.json');
  const historical = loadJson('408-2009-2021-historical-question-index.json');

  const byId = new Map();
  const atomicIds = new Set();
  for (const node of tree.nodes) {
    byId.set(String(node.id), node);
    if (node.nodeType === 'atomicPoint') atomicIds.add(String(node.id));
  }

  const requireNode = (id, context) => {
    if (!byId.has(String(id))) {
      throw new Error(`${context}: unknown knowledge node ${id}`);
    }
  };

  const requireAtomic = (id, context) => {
    if (!atomicIds.has(String(id))) {
      throw new Error(`${context}: ${id} is not an atomicPoint`);
    }
  };

  // 1. Knowledge tree: stable IDs, valid subjects/types, resolvable parents and relations.
  for (const node of tree.nodes) {
    const id = String(node.id);
    if (!SUBJECTS.has(String(node.subject))) {
      throw new Error(`KnowledgeNode ${id}: subject "${node.subject}" is not DS|CO|OS|CN`);
    }
    if (!NODE_TYPES.has(String(node.nodeType))) {
      throw new Error(`KnowledgeNode ${id}: nodeType "${node.nodeType}" is invalid`);
    }
    if (node.parentId != null) requireNode(node.parentId, `KnowledgeNode ${id} parent`);
    for (const prerequisite of node.prerequisites ?? []) {
      requireAtomic(prerequisite, `KnowledgeNode ${id} prerequisite`);
    }
    for (const related of node.relatedPoints ?? []) {
      requireAtomic(related, `KnowledgeNode ${id} relatedPoint`);
    }
  }

  // 2. Frequency model: every entry must reference an existing atomic knowledge node.
  for (const item of frequency.items) {
    requireAtomic(item.knowledgePointId, 'frequency item');
    if (!TREND_DIRECTIONS.has(String(item.trend?.direction))) {
      throw new Error(`frequency ${item.knowledgePointId}: invalid trend direction ${item.trend?.direction}`);
    }
    if (!EVIDENCE_CONFIDENCES.has(String(item.evidenceConfidence))) {
      throw new Error(`frequency ${item.knowledgePointId}: invalid evidence confidence ${item.evidenceConfidence}`);
    }
  }

  // 3. 2022-2026 exact atomic mappings: 47 questions, 150 points, canonical subject totals,
  //    and every primary/secondary tag targets an atomicPoint.
  for (const year of [2022, 2023, 2024, 2025, 2026]) {
    const bundle = loadJson(`exam-mapping/408-${year}-question-knowledge-map.json`);
    if (bundle.meta.questionCount !== 47 || bundle.questions.length !== 47) {
      throw new Error(`paper ${year}: expected 47 questions, got ${bundle.questions.length}`);
    }
    const subjectTotals = {};
    for (const question of bundle.questions) {
      subjectTotals[question.subject] = (subjectTotals[question.subject] ?? 0) + Number(question.score ?? 0);
      requireAtomic(question.primaryKnowledgePointId, `paper ${year} ${question.id} primary`);
      for (const secondary of question.secondaryKnowledgePointIds ?? []) {
        requireAtomic(secondary, `paper ${year} ${question.id} secondary`);
      }
    }
    const total = Object.values(subjectTotals).reduce((sum, value) => sum + value, 0);
    if (total !== 150) throw new Error(`paper ${year}: total score ${total} != 150`);
    for (const [subject, expected] of Object.entries(EXPECTED_SUBJECT_SCORES)) {
      if (subjectTotals[subject] !== expected) {
        throw new Error(`paper ${year}: subject ${subject} score ${subjectTotals[subject]} != ${expected}`);
      }
    }
  }

  // 4. 2009-2021 historical index stays broad: no exact atomic primary/secondary fields.
  for (const question of historical.questions) {
    if (question.precision === 'BROAD_HISTORICAL' && question.role === 'PRIMARY') {
      throw new Error(`historical ${question.id}: BROAD_HISTORICAL tags must never be PRIMARY`);
    }
    if (question.primaryKnowledgePointId != null || question.secondaryKnowledgePointIds?.length) {
      throw new Error(`historical ${question.id}: must not carry exact atomic tags`);
    }
    if (!HISTORICAL_MAPPING_STATUSES.has(String(question.mappingStatus))) {
      throw new Error(`historical ${question.id}: unexpected mappingStatus ${question.mappingStatus}`);
    }
  }

  return {
    nodes: tree.nodes.length,
    atomicPoints: atomicIds.size,
    frequencyItems: frequency.items.length,
    historicalQuestions: historical.questions.length,
  };
}

export function assertNoBroadPrimaryTag(tags, context) {
  for (const tag of tags) {
    if (tag.precision === 'BROAD_HISTORICAL' && tag.role === 'PRIMARY') {
      throw new Error(`${context}: BROAD_HISTORICAL tags must never be PRIMARY`);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const summary = verify408Data();
    console.log(
      `[verify-408-data] OK: ${summary.nodes} nodes (${summary.atomicPoints} atomic), `
        + `${summary.frequencyItems} frequency items, ${summary.historicalQuestions} historical questions.`,
    );
  } catch (error) {
    console.error(`[verify-408-data] FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
