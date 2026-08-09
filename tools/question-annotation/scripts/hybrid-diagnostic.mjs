import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FUSION_VERSION, RRF_K } from '../core/fusion.js';
import { HYBRID_RETRIEVER_VERSION, retrieveTop12 } from '../core/retriever.js';
import { LEXICAL_VERSION, buildLexicalIndex } from '../core/lexical.js';
import { EMBEDDING_BENCHMARK_VERSION, LocalTransformersProvider } from '../core/embedding.js';

const TOOL_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULTS = {
  snapshot: join(TOOL_ROOT, 'local-data', 'snapshot-snap-399242fb3d7f.json'),
  truth: join(TOOL_ROOT, 'local-data', 'gold-truth-manifest-v1.json'),
  winnerSpec: join(TOOL_ROOT, 'local-data', 'embedding-model-v1.json'),
  cacheDir: join(TOOL_ROOT, 'local-data', 'embedding-cache'),
  metaDir: join(TOOL_ROOT, 'local-data', 'embedding-meta'),
  reportOut: join(TOOL_ROOT, 'local-data', 'hybrid-diagnostic-dev.json'),
};
const GOLD_SHA = '6ca5fa53e8b0db415c7d7132445a72bf10297550d110df0b92f8ce301fabd99d';
const DEV_REQUIRED = 24;
const HOLDOUT_REQUIRED = 16;
const E5_BASELINE = {
  primaryRecallAt8Count: 23,
  primaryRecallAt12Count: 24,
  macroAllRelevantAt12: 1,
};

export function resolveBenchmarkSplit(split) {
  if (split === 'DEV') return 'DEV';
  if (split === 'HOLDOUT') {
    throw new Error('HOLDOUT evaluation is reserved for the Task 9 gate; the hybrid diagnostic is DEV-only');
  }
  throw new Error(`unsupported split ${split}; only DEV is allowed`);
}

function parseArgs(argv) {
  const args = { split: 'DEV' };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--snapshot') args.snapshot = argv[++index];
    else if (token === '--truth') args.truth = argv[++index];
    else if (token === '--winner-spec') args.winnerSpec = argv[++index];
    else if (token === '--cache-dir') args.cacheDir = argv[++index];
    else if (token === '--meta-dir') args.metaDir = argv[++index];
    else if (token === '--report-out') args.reportOut = argv[++index];
    else if (token === '--split') args.split = argv[++index];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  resolveBenchmarkSplit(args.split);

  const snapshot = JSON.parse(readFileSync(args.snapshot ?? DEFAULTS.snapshot, 'utf8'));
  const truth = JSON.parse(readFileSync(args.truth ?? DEFAULTS.truth, 'utf8'));
  const winner = JSON.parse(readFileSync(args.winnerSpec ?? DEFAULTS.winnerSpec, 'utf8'));
  if (truth.sha256 !== GOLD_SHA) throw new Error(`Gold truth sha mismatch: ${truth.sha256}`);
  if (truth.snapshotId !== snapshot.snapshotId) throw new Error('Gold truth snapshot mismatch');
  if (winner.selectedOn !== 'DEV' || winner.id !== 'Xenova/multilingual-e5-small') {
    throw new Error(`unexpected winner spec ${winner.id}/${winner.selectedOn}`);
  }

  const devEntries = truth.entries.filter((entry) => entry.split === 'DEV');
  const holdoutEntries = truth.entries.filter((entry) => entry.split === 'HOLDOUT');
  if (devEntries.length !== DEV_REQUIRED) throw new Error(`DEV questions ${devEntries.length} != ${DEV_REQUIRED}`);
  if (holdoutEntries.length !== HOLDOUT_REQUIRED) throw new Error(`HOLDOUT questions ${holdoutEntries.length} != ${HOLDOUT_REQUIRED}`);

  const activeAtomic = snapshot.nodes.filter((node) => node.isActive && node.nodeType === 'atomicPoint');
  const lexical = buildLexicalIndex(activeAtomic);
  const spec = {
    id: winner.id,
    revision: winner.revision,
    queryPrefix: winner.queryPrefix,
    passagePrefix: winner.passagePrefix,
    pooling: winner.pooling,
    normalize: winner.normalize,
    dimension: winner.dimension,
    transformersVersion: winner.transformersVersion,
  };
  const cacheDir = args.cacheDir ?? DEFAULTS.cacheDir;
  const metaDir = args.metaDir ?? DEFAULTS.metaDir;
  const provider = new LocalTransformersProvider(spec, { modelCacheDir: cacheDir, metaDir });
  const providers = { lexical, stem: provider, analysis: provider };
  const questionById = new Map(snapshot.questions.map((question) => [question.id, question]));

  const poolBySubject = new Map();
  for (const node of activeAtomic) {
    const list = poolBySubject.get(node.subject) ?? [];
    list.push(node.id);
    poolBySubject.set(node.subject, list);
  }
  const perQuestion = [];
  let crossSubject = 0;
  for (const entry of devEntries) {
    const question = questionById.get(entry.questionId);
    if (!question) throw new Error(`DEV question ${entry.questionId} missing from snapshot`);
    const candidates = await retrieveTop12(question, snapshot, providers, cacheDir);
    const pool = new Set(poolBySubject.get(question.subject) ?? []);
    if (candidates.some((candidate) => !pool.has(candidate.nodeId))) crossSubject += 1;
    const relevant = new Set([entry.primaryNodeId, ...(entry.secondaryNodeIds ?? [])].filter(Boolean));
    const top8Ids = candidates.slice(0, 8).map((candidate) => candidate.nodeId);
    const top12Ids = candidates.map((candidate) => candidate.nodeId);
    const hit = top12Ids.filter((id) => relevant.has(id)).length;
    perQuestion.push({
      questionId: entry.questionId,
      split: 'DEV',
      primaryAt8: top8Ids.includes(entry.primaryNodeId) ? 1 : 0,
      primaryAt12: top12Ids.includes(entry.primaryNodeId) ? 1 : 0,
      macroRecallAt12: hit / relevant.size,
      candidates: candidates.map((candidate) => ({
        nodeId: candidate.nodeId,
        rank: candidate.finalRank,
        rrfScore: candidate.rrfScore,
        lexicalRank: candidate.lexicalRank,
        stemEmbeddingRank: candidate.stemEmbeddingRank,
        analysisEmbeddingRank: candidate.analysisEmbeddingRank,
        kpMatched: candidate.kpMatched,
        chapterMatched: candidate.chapterMatched,
      })),
    });
  }

  const count = perQuestion.length;
  const primaryRecallAt8Count = perQuestion.reduce((sum, item) => sum + item.primaryAt8, 0);
  const primaryRecallAt12Count = perQuestion.reduce((sum, item) => sum + item.primaryAt12, 0);
  const macroAllRelevantAt12 = perQuestion.reduce((sum, item) => sum + item.macroRecallAt12, 0) / count;
  const report = {
    diagnosticVersion: 'hybrid-diagnostic-v1',
    retrieverVersion: HYBRID_RETRIEVER_VERSION,
    lexicalVersion: LEXICAL_VERSION,
    fusionVersion: FUSION_VERSION,
    rrfK: RRF_K,
    embeddingBenchmarkVersion: EMBEDDING_BENCHMARK_VERSION,
    embeddingSpec: {
      id: winner.id,
      revision: winner.revision,
      queryPrefix: winner.queryPrefix,
      passagePrefix: winner.passagePrefix,
      pooling: winner.pooling,
      normalize: winner.normalize,
      dimension: winner.dimension,
      transformersVersion: winner.transformersVersion,
    },
    goldSha256: truth.sha256,
    snapshotId: truth.snapshotId,
    split: 'DEV',
    questionCount: count,
    evaluatedHoldout: 0,
    crossSubjectCount: crossSubject,
    metrics: {
      primaryRecallAt8: primaryRecallAt8Count / count,
      primaryRecallAt12: primaryRecallAt12Count / count,
      macroAllRelevantAt12,
      primaryRecallAt8Count,
      primaryRecallAt12Count,
    },
    e5Baseline: E5_BASELINE,
    perQuestion,
  };
  writeFileSync(args.reportOut ?? DEFAULTS.reportOut, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`Hybrid PRIMARY Recall@8  = ${primaryRecallAt8Count}/${count} (${(primaryRecallAt8Count / count).toFixed(4)})`);
  console.log(`Hybrid PRIMARY Recall@12 = ${primaryRecallAt12Count}/${count} (${(primaryRecallAt12Count / count).toFixed(4)})`);
  console.log(`Hybrid Macro AllRelevant@12 = ${macroAllRelevantAt12.toFixed(4)}`);
  console.log(`E5 baseline: Recall@8=${E5_BASELINE.primaryRecallAt8Count}/${count}, Recall@12=${E5_BASELINE.primaryRecallAt12Count}/${count}`);
  console.log(`DEV evaluated: ${count}; HOLDOUT evaluated: 0; crossSubject: ${crossSubject}`);
  console.log(`report: ${args.reportOut ?? DEFAULTS.reportOut}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[hybrid-diagnostic] FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
