import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  BGE_SMALL_ZH_SPEC,
  E5_SMALL_SPEC,
  LocalTransformersProvider,
  persistModelMeta,
} from '../core/embedding.js';

const TOOL_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_CACHE_DIR = join(TOOL_ROOT, 'local-data', 'embedding-cache');
const DEFAULT_META_DIR = join(TOOL_ROOT, 'local-data', 'embedding-meta');

const CANDIDATES = {
  'Xenova/multilingual-e5-small': E5_SMALL_SPEC,
  'Xenova/bge-small-zh-v1.5': BGE_SMALL_ZH_SPEC,
};

const SMOKE_TEXTS = ['TCP三次握手', '补码', '拥塞避免'];

function l2Norm(vector) {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

function parseArgs(argv) {
  const args = { model: null, cacheDir: DEFAULT_CACHE_DIR, metaDir: DEFAULT_META_DIR };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--model') args.model = argv[++index];
    else if (token === '--cache-dir') args.cacheDir = argv[++index];
    else if (token === '--meta-dir') args.metaDir = argv[++index];
  }
  return args;
}

async function smokeModel(spec, { cacheDir, metaDir }) {
  console.log(`loading ${spec.id} ...`);
  const provider = new LocalTransformersProvider(spec, { modelCacheDir: cacheDir });
  const revision = await provider.resolvedRevision();
  if (!revision) {
    throw new Error(`cannot resolve revision for ${spec.id}; refusing to record an unverifiable model`);
  }
  for (const text of SMOKE_TEXTS) {
    const query = await provider.embed('query', text);
    const passage = await provider.embed('passage', text);
    const queryNorm = l2Norm(query);
    const passageNorm = l2Norm(passage);
    if (query.length !== spec.dimension || passage.length !== spec.dimension) {
      throw new Error(`${spec.id} dimension mismatch for "${text}"`);
    }
    if (!query.every((value) => Number.isFinite(value)) || !passage.every((value) => Number.isFinite(value))) {
      throw new Error(`${spec.id} non-finite values for "${text}"`);
    }
    if (Math.abs(queryNorm - 1) > 1e-4 || Math.abs(passageNorm - 1) > 1e-4) {
      throw new Error(`${spec.id} L2 norm mismatch for "${text}": ${queryNorm}/${passageNorm}`);
    }
  }
  const metaFile = persistModelMeta(spec, revision, spec.transformersVersion, metaDir);
  console.log(JSON.stringify({
    modelId: spec.id,
    resolvedRevision: revision,
    transformersVersion: spec.transformersVersion,
    dimension: spec.dimension,
    pooling: spec.pooling,
    normalize: spec.normalize,
    queryPrefix: spec.queryPrefix,
    passagePrefix: spec.passagePrefix,
    queryNormSample: l2Norm(await provider.embed('query', SMOKE_TEXTS[0])),
    metaFile,
  }, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const models = args.model ? [args.model] : Object.keys(CANDIDATES);
  for (const modelId of models) {
    const spec = CANDIDATES[modelId];
    if (!spec) throw new Error(`unknown model ${modelId}; expected one of ${Object.keys(CANDIDATES).join(', ')}`);
    await smokeModel(spec, { cacheDir: args.cacheDir, metaDir: args.metaDir });
  }
  console.log('embedding smoke PASS');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[embedding-smoke] FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
