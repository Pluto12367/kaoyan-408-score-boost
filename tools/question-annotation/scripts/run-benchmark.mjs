import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  BENCHMARK_VERSION,
  computeBenchmarkMetrics,
  evaluateRetrievalGate,
  finalRetrieverConfigHash,
  resolveBenchmarkSplit,
  selectSplitEntries,
  validateFrozenConfig,
} from '../core/benchmark.js';
import { retrieveSemanticTop12 } from '../core/retriever.js';
import { LocalTransformersProvider } from '../core/embedding.js';

const TOOL_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULTS = {
  snapshot: join(TOOL_ROOT, 'local-data', 'snapshot-snap-399242fb3d7f.json'),
  truth: join(TOOL_ROOT, 'local-data', 'gold-truth-manifest-v1.json'),
  config: join(TOOL_ROOT, 'config', 'final-retriever-v1.json'),
  cacheDir: join(TOOL_ROOT, 'local-data', 'embedding-cache'),
  metaDir: join(TOOL_ROOT, 'local-data', 'embedding-meta'),
  reportOut: join(TOOL_ROOT, 'local-data', 'benchmark-report.json'),
};
const GOLD_SHA = '6ca5fa53e8b0db415c7d7132445a72bf10297550d110df0b92f8ce301fabd99d';
const EXPECTED_COUNTS = { DEV: 24, HOLDOUT: 16 };

function parseArgs(argv) {
  const args = { split: 'DEV' };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--snapshot') args.snapshot = argv[++index];
    else if (token === '--gold') args.truth = argv[++index];
    else if (token === '--config') args.config = argv[++index];
    else if (token === '--config-hash') args.configHash = argv[++index];
    else if (token === '--split') args.split = argv[++index];
    else if (token === '--cache-dir') args.cacheDir = argv[++index];
    else if (token === '--meta-dir') args.metaDir = argv[++index];
    else if (token === '--report-out') args.reportOut = argv[++index];
  }
  return args;
}

function nodeText(node) {
  return [node.name, node.chapterName, node.sectionName].filter((value) => value != null && value !== '').join(' ');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const split = resolveBenchmarkSplit(args.split);
  const snapshot = JSON.parse(readFileSync(args.snapshot ?? DEFAULTS.snapshot, 'utf8'));
  const truth = JSON.parse(readFileSync(args.truth ?? DEFAULTS.truth, 'utf8'));
  const config = JSON.parse(readFileSync(args.config ?? DEFAULTS.config, 'utf8'));
  const configHash = args.configHash ?? finalRetrieverConfigHash(config);

  if (truth.sha256 !== GOLD_SHA) throw new Error(`Gold truth sha mismatch: ${truth.sha256}`);
  if (truth.snapshotId !== snapshot.snapshotId) throw new Error('Gold truth snapshot mismatch');
  if (split === 'HOLDOUT') {
    const frozen = validateFrozenConfig(config, configHash);
    if (!frozen.ok) throw new Error(`HOLDOUT gate blocked: ${frozen.errors.join('; ')}`);
  } else {
    const frozen = validateFrozenConfig(config, configHash);
    if (!frozen.ok) throw new Error(`final retriever config invalid: ${frozen.errors.join('; ')}`);
  }

  const entries = selectSplitEntries(truth.entries, split);
  if (entries.length !== EXPECTED_COUNTS[split]) {
    throw new Error(`${split} questions ${entries.length} != ${EXPECTED_COUNTS[split]}`);
  }

  const provider = new LocalTransformersProvider(
    {
      id: config.modelId,
      revision: config.resolvedRevision,
      queryPrefix: config.queryPrefix,
      passagePrefix: config.passagePrefix,
      pooling: config.pooling,
      normalize: config.normalize,
      dimension: config.dimension,
      transformersVersion: config.transformersVersion,
    },
    { modelCacheDir: args.cacheDir ?? DEFAULTS.cacheDir, metaDir: args.metaDir ?? DEFAULTS.metaDir },
  );
  const cacheDir = join(args.cacheDir ?? DEFAULTS.cacheDir, 'vectors');
  const questionById = new Map(snapshot.questions.map((question) => [question.id, question]));
  const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const kpIdsByQuestion = new Map();
  for (const relation of snapshot.questionKnowledgePoints ?? []) {
    const list = kpIdsByQuestion.get(relation.questionId) ?? [];
    list.push(relation.knowledgePointId);
    kpIdsByQuestion.set(relation.questionId, list);
  }
  const poolBySubject = new Map();
  for (const node of snapshot.nodes) {
    if (node.isActive && node.nodeType === 'atomicPoint') {
      const list = poolBySubject.get(node.subject) ?? new Set();
      list.add(node.id);
      poolBySubject.set(node.subject, list);
    }
  }

  const runs = [];
  const perQuestion = [];
  let activeAtomicViolations = 0;
  let invalidNodes = 0;
  let duplicates = 0;
  let nonFiniteScores = 0;
  for (const entry of entries) {
    const question = questionById.get(entry.questionId);
    if (!question) throw new Error(`${split} question ${entry.questionId} missing from snapshot`);
    const candidates = await retrieveSemanticTop12(question, snapshot, provider, cacheDir);
    const subjectNodeIds = poolBySubject.get(question.subject) ?? new Set();
    for (const candidate of candidates) {
      const node = nodeById.get(candidate.nodeId);
      if (!node) invalidNodes += 1;
      else if (!node.isActive || node.nodeType !== 'atomicPoint') activeAtomicViolations += 1;
      if (!Number.isFinite(candidate.score)) nonFiniteScores += 1;
    }
    const seen = new Set();
    for (const candidate of candidates) {
      if (seen.has(candidate.nodeId)) duplicates += 1;
      seen.add(candidate.nodeId);
    }
    const primaryRank = candidates.find((candidate) => candidate.nodeId === entry.primaryNodeId)?.finalRank ?? null;
    const relevant = new Set([entry.primaryNodeId, ...(entry.secondaryNodeIds ?? [])].filter(Boolean));
    const relevantRanks = candidates
      .filter((candidate) => relevant.has(candidate.nodeId))
      .map((candidate) => candidate.finalRank)
      .sort((a, b) => a - b);
    runs.push({
      questionId: entry.questionId,
      subject: question.subject,
      knowledgePointIds: kpIdsByQuestion.get(entry.questionId) ?? [],
      candidates,
      goldPrimary: entry.primaryNodeId,
      goldSecondary: entry.secondaryNodeIds ?? [],
      subjectNodeIds,
    });
    perQuestion.push({
      questionId: entry.questionId,
      split,
      goldPrimaryRank: primaryRank,
      relevantRanks,
      candidates: candidates.map((candidate) => ({
        nodeId: candidate.nodeId,
        rank: candidate.finalRank,
        score: candidate.score,
      })),
    });
  }

  const metrics = computeBenchmarkMetrics(runs);
  const safety = { activeAtomicViolations, invalidNodes, duplicates, nonFiniteScores };
  const gate = split === 'HOLDOUT' ? evaluateRetrievalGate({ ...metrics, ...safety }, entries.length) : null;
  const report = {
    benchmarkVersion: BENCHMARK_VERSION,
    split,
    questionCount: entries.length,
    holdoutRunCountBefore: 0,
    configChangedAfterHoldout: false,
    finalRetrieverConfigHash: configHash,
    goldSha256: truth.sha256,
    snapshotId: truth.snapshotId,
    retriever: {
      id: config.retriever,
      modelId: config.modelId,
      resolvedRevision: config.resolvedRevision,
      transformersVersion: config.transformersVersion,
      queryPrefix: config.queryPrefix,
      passagePrefix: config.passagePrefix,
      pooling: config.pooling,
      normalize: config.normalize,
      dimension: config.dimension,
      topKInitial: config.topKInitial,
      topKExpanded: config.topKExpanded,
    },
    metrics,
    safety,
    gate,
    perQuestion,
  };
  writeFileSync(args.reportOut ?? DEFAULTS.reportOut, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const count = entries.length;
  const hit8 = Math.round(metrics.primaryRecallAt8 * count);
  const hit12 = Math.round(metrics.primaryRecallAt12 * count);
  console.log(`${split} evaluated: ${count}`);
  console.log(`PRIMARY Recall@8  = ${hit8}/${count} (${metrics.primaryRecallAt8.toFixed(4)})`);
  console.log(`PRIMARY Recall@12 = ${hit12}/${count} (${metrics.primaryRecallAt12.toFixed(4)})`);
  console.log(`Macro AllRelevant@12 = ${metrics.macroAllRelevantAt12.toFixed(4)}`);
  console.log(`safety: crossSubject=${metrics.crossSubjectCount} activeAtomicViolations=${safety.activeAtomicViolations} invalidNodes=${safety.invalidNodes} duplicates=${safety.duplicates} nonFiniteScores=${safety.nonFiniteScores}`);
  console.log(`report: ${args.reportOut ?? DEFAULTS.reportOut}`);
  if (gate) {
    console.log(gate.pass ? 'RETRIEVAL_GATE_PASS' : 'RETRIEVAL_GATE_FAIL');
    if (!gate.pass) console.log(`gate reasons: ${gate.reasons.join('; ')}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[run-benchmark] FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
