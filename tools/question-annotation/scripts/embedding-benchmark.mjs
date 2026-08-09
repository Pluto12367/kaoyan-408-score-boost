import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  BGE_SMALL_ZH_SPEC,
  E5_SMALL_SPEC,
  EMBEDDING_BENCHMARK_VERSION,
  LocalTransformersProvider,
  embedWithCache,
  selectModelWinner,
} from '../core/embedding.js';
import { getWorkspaceSummary, listNodes, listQuestions, openWorkspace } from '../workspace/workspace.mjs';

const TOOL_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULTS = {
  workspace: join(TOOL_ROOT, 'local-data', 'annotation-workspace.db'),
  truth: join(TOOL_ROOT, 'local-data', 'gold-truth-manifest-v1.json'),
  cacheDir: join(TOOL_ROOT, 'local-data', 'embedding-cache'),
  metaDir: join(TOOL_ROOT, 'local-data', 'embedding-meta'),
  reportOut: join(TOOL_ROOT, 'local-data', 'embedding-benchmark-dev.json'),
  winnerOut: join(TOOL_ROOT, 'local-data', 'embedding-model-v1.json'),
};
const GOLD_SHA = '6ca5fa53e8b0db415c7d7132445a72bf10297550d110df0b92f8ce301fabd99d';
const DEV_REQUIRED = 24;
const HOLDOUT_REQUIRED = 16;

/**
 * Task 7 DEV embedding benchmark (24 DEV only). HOLDOUT is fail-closed and
 * never evaluated during model selection.
 */
export function resolveBenchmarkSplit(split) {
  if (split === 'DEV') return 'DEV';
  if (split === 'HOLDOUT') {
    throw new Error('HOLDOUT evaluation is reserved for the Task 9 gate; the Task 7 benchmark is DEV-only');
  }
  throw new Error(`unsupported benchmark split ${split}; only DEV is allowed in Task 7`);
}

function parseArgs(argv) {
  const args = { model: null, split: 'DEV' };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--workspace') args.workspace = argv[++index];
    else if (token === '--truth') args.truth = argv[++index];
    else if (token === '--cache-dir') args.cacheDir = argv[++index];
    else if (token === '--meta-dir') args.metaDir = argv[++index];
    else if (token === '--report-out') args.reportOut = argv[++index];
    else if (token === '--winner-out') args.winnerOut = argv[++index];
    else if (token === '--model') args.model = argv[++index];
    else if (token === '--split') args.split = argv[++index];
  }
  return args;
}

const SELECTION_RULE = (a, b) =>
  b.metrics.primaryRecallAt8 - a.metrics.primaryRecallAt8 ||
  b.metrics.primaryRecallAt12 - a.metrics.primaryRecallAt12 ||
  b.metrics.macroAllRelevantAt12 - a.metrics.macroAllRelevantAt12 ||
  a.modelId.localeCompare(b.modelId);

function dotProduct(left, right) {
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) sum += left[index] * right[index];
  return sum;
}

function corpusHash(nodes) {
  const canonical = nodes
    .map((node) => ({ id: node.nodeId, name: node.name, chapter: node.chapterName, section: node.sectionName }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

async function getNodeVectors(provider, nodes, cacheDir, specHash) {
  const file = join(cacheDir, `node-vectors-${specHash}.json`);
  const corpus = corpusHash(nodes);
  if (existsSync(file)) {
    const cached = JSON.parse(readFileSync(file, 'utf8'));
    if (cached.specHash === specHash && cached.corpusHash === corpus && cached.entries.length === nodes.length) {
      return new Map(cached.entries.map((entry) => [entry.nodeId, entry.vector]));
    }
  }
  const map = new Map();
  for (const node of nodes) {
    const text = [node.name, node.chapterName, node.sectionName].filter((value) => value != null && value !== '').join(' ');
    map.set(node.nodeId, await provider.embed('passage', text));
  }
  writeFileSync(file, `${JSON.stringify({ specHash, corpusHash: corpus, entries: [...map].map(([nodeId, vector]) => ({ nodeId, vector })) })}\n`, 'utf8');
  return map;
}

function rankBySimilarity(queryVector, nodes, nodeVectors, subject, topK) {
  const scored = nodes
    .filter((node) => node.subject === subject)
    .map((node) => ({ nodeId: node.nodeId, score: dotProduct(queryVector, nodeVectors.get(node.nodeId)) }))
    .sort((a, b) => b.score - a.score || a.nodeId.localeCompare(b.nodeId));
  return scored.slice(0, topK);
}

async function benchmarkModel(spec, { questions, nodes, devEntries, questionById, cacheDir, metaDir }) {
  const provider = new LocalTransformersProvider(spec, { modelCacheDir: cacheDir, metaDir });
  const revision = await provider.resolvedRevision();
  if (!revision) throw new Error(`cannot resolve revision for ${spec.id}; benchmark blocked`);
  const specHash = `${spec.id.replace(/[^a-zA-Z0-9]/g, '-')}-${revision}`;
  const nodeVectors = await getNodeVectors(provider, nodes, cacheDir, specHash);
  const embedder = { embed: (view, text) => embedWithCache(provider, view, text, join(cacheDir, 'vectors')) };

  const perQuestion = [];
  for (const entry of devEntries) {
    const question = questionById.get(entry.questionId);
    if (!question) throw new Error(`DEV question ${entry.questionId} missing from workspace`);
    const stemVector = await embedder.embed('query', question.stem);
    const analysisVector = await embedder.embed('query', question.analysis ?? '');
    const top12 = rankBySimilarity(stemVector, nodes, nodeVectors, question.subject, 12);
    const top12Analysis = rankBySimilarity(analysisVector, nodes, nodeVectors, question.subject, 12);
    const relevant = new Set([entry.primaryNodeId, ...(entry.secondaryNodeIds ?? [])].filter(Boolean));
    const top8Ids = top12.slice(0, 8).map((candidate) => candidate.nodeId);
    const top12Ids = top12.map((candidate) => candidate.nodeId);
    const hit = top12Ids.filter((id) => relevant.has(id)).length;
    perQuestion.push({
      questionId: entry.questionId,
      primaryAt8: top8Ids.includes(entry.primaryNodeId) ? 1 : 0,
      primaryAt12: top12Ids.includes(entry.primaryNodeId) ? 1 : 0,
      macroRecallAt12: hit / relevant.size,
      top12: top12Ids,
      top12Analysis: top12Analysis.map((candidate) => candidate.nodeId),
    });
  }
  const count = perQuestion.length;
  return {
    modelId: spec.id,
    resolvedRevision: revision,
    spec: {
      id: spec.id,
      revision: revision,
      queryPrefix: spec.queryPrefix,
      passagePrefix: spec.passagePrefix,
      pooling: spec.pooling,
      normalize: spec.normalize,
      dimension: spec.dimension,
      transformersVersion: spec.transformersVersion,
    },
    metrics: {
      primaryRecallAt8: perQuestion.reduce((sum, item) => sum + item.primaryAt8, 0) / count,
      primaryRecallAt12: perQuestion.reduce((sum, item) => sum + item.primaryAt12, 0) / count,
      macroAllRelevantAt12: perQuestion.reduce((sum, item) => sum + item.macroRecallAt12, 0) / count,
    },
    primaryRecallAt8Count: perQuestion.reduce((sum, item) => sum + item.primaryAt8, 0),
    primaryRecallAt12Count: perQuestion.reduce((sum, item) => sum + item.primaryAt12, 0),
    perQuestion,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  resolveBenchmarkSplit(args.split);

  const db = openWorkspace(args.workspace ?? DEFAULTS.workspace);
  const summary = getWorkspaceSummary(db);
  const questions = listQuestions(db);
  const nodes = listNodes(db);
  db.close();

  const truth = JSON.parse(readFileSync(args.truth ?? DEFAULTS.truth, 'utf8'));
  if (truth.sha256 !== GOLD_SHA) throw new Error(`Gold truth sha mismatch: ${truth.sha256}`);
  if (truth.snapshotId !== summary.snapshotId) throw new Error(`Gold truth snapshot mismatch: ${truth.snapshotId} != ${summary.snapshotId}`);

  const devEntries = truth.entries.filter((entry) => entry.split === 'DEV');
  const holdoutEntries = truth.entries.filter((entry) => entry.split === 'HOLDOUT');
  if (devEntries.length !== DEV_REQUIRED) throw new Error(`DEV questions ${devEntries.length} != ${DEV_REQUIRED}`);
  if (holdoutEntries.length !== HOLDOUT_REQUIRED) throw new Error(`HOLDOUT questions ${holdoutEntries.length} != ${HOLDOUT_REQUIRED}`);

  const activeAtomic = nodes.filter((node) => node.isActive && node.nodeType === 'atomicPoint');
  const questionById = new Map(questions.map((question) => [question.questionId, question]));
  const cacheDir = args.cacheDir ?? DEFAULTS.cacheDir;
  const metaDir = args.metaDir ?? DEFAULTS.metaDir;
  const models = args.model ? [args.model] : [E5_SMALL_SPEC.id, BGE_SMALL_ZH_SPEC.id];
  const perModel = {};
  for (const modelId of models) {
    const spec = modelId === E5_SMALL_SPEC.id ? E5_SMALL_SPEC : modelId === BGE_SMALL_ZH_SPEC.id ? BGE_SMALL_ZH_SPEC : null;
    if (!spec) throw new Error(`unknown model ${modelId}`);
    console.log(`benchmarking ${spec.id} ...`);
    const result = await benchmarkModel(spec, { questions, nodes: activeAtomic, devEntries, questionById, cacheDir, metaDir });
    perModel[spec.id] = result;
    console.log(
      `${spec.id}: PRIMARY Recall@8=${result.primaryRecallAt8Count}/${devEntries.length} (${result.metrics.primaryRecallAt8.toFixed(4)}), ` +
        `PRIMARY Recall@12=${result.primaryRecallAt12Count}/${devEntries.length} (${result.metrics.primaryRecallAt12.toFixed(4)}), ` +
        `Macro AllRelevant@12=${result.metrics.macroAllRelevantAt12.toFixed(4)}`,
    );
  }

  const winnerKey = selectModelWinner(perModel, SELECTION_RULE);
  const winner = perModel[winnerKey];
  const report = {
    benchmarkVersion: EMBEDDING_BENCHMARK_VERSION,
    goldSha256: truth.sha256,
    split: 'DEV',
    questionCount: devEntries.length,
    snapshotId: truth.snapshotId,
    selectionRule: 'DEV PRIMARY Recall@8 -> DEV PRIMARY Recall@12 -> Macro AllRelevant@12 -> modelId asc',
    evaluatedHoldout: 0,
    models: Object.fromEntries(Object.entries(perModel).map(([id, model]) => [id, { spec: model.spec, metrics: model.metrics, perQuestion: model.perQuestion }])),
    winnerModelId: winnerKey,
  };
  writeFileSync(args.reportOut ?? DEFAULTS.reportOut, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const winnerSpec = {
    benchmarkVersion: EMBEDDING_BENCHMARK_VERSION,
    goldSha256: truth.sha256,
    selectedOn: 'DEV',
    ...winner.spec,
  };
  writeFileSync(args.winnerOut ?? DEFAULTS.winnerOut, `${JSON.stringify(winnerSpec, null, 2)}\n`, 'utf8');

  console.log(`DEV evaluated: ${devEntries.length}; HOLDOUT evaluated: 0`);
  console.log(`WINNER: ${winnerKey}`);
  console.log(`winner spec: ${args.winnerOut ?? DEFAULTS.winnerOut}`);
  console.log(`report: ${args.reportOut ?? DEFAULTS.reportOut}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[embedding-benchmark] FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
