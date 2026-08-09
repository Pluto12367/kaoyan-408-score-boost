import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import os from 'node:os';

export const EMBEDDING_BENCHMARK_VERSION = 'embedding-benchmark-v1';

function installedTransformersVersion() {
  try {
    const require = createRequire(import.meta.url);
    const entry = require.resolve('@huggingface/transformers');
    let dir = dirname(entry);
    while (dir && dir.length > 3) {
      const packageFile = join(dir, 'package.json');
      if (existsSync(packageFile)) {
        const packageJson = JSON.parse(readFileSync(packageFile, 'utf8'));
        if (packageJson.name === '@huggingface/transformers') return packageJson.version;
      }
      dir = dirname(dir);
    }
  } catch {
    // fall through
  }
  return 'unknown';
}

const TRANSFORMERS_VERSION = installedTransformersVersion();

export const E5_SMALL_SPEC = Object.freeze({
  id: 'Xenova/multilingual-e5-small',
  revision: 'main',
  queryPrefix: 'query: ',
  passagePrefix: 'passage: ',
  pooling: 'mean',
  normalize: true,
  dimension: 384,
  transformersVersion: TRANSFORMERS_VERSION,
});

export const BGE_SMALL_ZH_SPEC = Object.freeze({
  id: 'Xenova/bge-small-zh-v1.5',
  revision: 'main',
  queryPrefix: '为这个句子生成表示以用于检索相关文章：',
  passagePrefix: '',
  pooling: 'cls',
  normalize: true,
  dimension: 512,
  transformersVersion: TRANSFORMERS_VERSION,
});

const VALID_POOLING = new Set(['mean', 'cls']);

export function validateEmbeddingModelSpec(spec) {
  const errors = [];
  if (!spec || typeof spec.id !== 'string' || spec.id.length === 0) errors.push('spec: id missing');
  if (!spec || typeof spec.revision !== 'string' || spec.revision.length === 0) errors.push('spec: revision missing');
  if (!spec || typeof spec.queryPrefix !== 'string') errors.push('spec: queryPrefix must be a string');
  if (!spec || typeof spec.passagePrefix !== 'string') errors.push('spec: passagePrefix must be a string');
  if (!spec || !VALID_POOLING.has(spec.pooling)) errors.push(`spec: invalid pooling ${spec?.pooling}`);
  if (!spec || spec.normalize !== true) errors.push('spec: normalize must be true');
  if (!spec || !Number.isInteger(spec.dimension) || spec.dimension <= 0) errors.push(`spec: invalid dimension ${spec?.dimension}`);
  if (!spec || typeof spec.transformersVersion !== 'string' || spec.transformersVersion.length === 0) {
    errors.push('spec: transformersVersion missing');
  }
  return { ok: errors.length === 0, errors: errors.sort() };
}

// Content normalization mirrors snapshot.js/lexical.js normalizeText so the
// cache identity is stable across query and passage construction.
function fullWidthToHalf(char) {
  const code = char.charCodeAt(0);
  if (code >= 0xff01 && code <= 0xff5e) return String.fromCharCode(code - 0xfee0);
  if (code === 0x3000) return ' ';
  return char;
}

function normalizeText(value) {
  let text = String(value ?? '').trim();
  text = [...text].map(fullWidthToHalf).join('');
  text = text.toLowerCase();
  text = text.replace(/[\u2018\u2019]/g, "'");
  text = text.replace(/[\u201C\u201D]/g, '"');
  text = text.replace(/[，,]/g, ',');
  text = text.replace(/[。.]/g, '.');
  text = text.replace(/[；;]/g, ';');
  text = text.replace(/[：:]/g, ':');
  text = text.replace(/[！!]/g, '!');
  text = text.replace(/[？?]/g, '?');
  text = text.replace(/[\u2013\u2014\u2212_-]/g, '-');
  text = text.replace(/[·・]/g, '-');
  text = text.replace(/\s+/g, ' ');
  return text.trim();
}

function l2Normalize(vector) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0 || !Number.isFinite(norm)) return vector;
  return vector.map((value) => value / norm);
}

/**
 * Canonical, field-sensitive spec hash. Any encoding config change
 * (id/revision/prefix/pooling/normalize/dimension/version) invalidates caches.
 */
export function embeddingSpecHash(spec) {
  const canonical = {
    id: spec.id,
    revision: spec.revision,
    queryPrefix: spec.queryPrefix,
    passagePrefix: spec.passagePrefix,
    pooling: spec.pooling,
    normalize: spec.normalize,
    dimension: spec.dimension,
    transformersVersion: spec.transformersVersion,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** Deterministic hash vector used by the CI-safe Fake provider. */
export function fakeEmbeddingFor(text, spec) {
  let buffer = createHash('sha256').update(String(text)).digest();
  const values = [];
  let counter = 0;
  while (values.length < spec.dimension) {
    buffer = createHash('sha256').update(Buffer.concat([buffer, Buffer.from(String(counter))])).digest();
    for (let index = 0; index + 3 < buffer.length && values.length < spec.dimension; index += 4) {
      values.push(((buffer[index] + buffer[index + 1] * 256) / 65535) * 2 - 1);
    }
    counter += 1;
  }
  return spec.normalize ? l2Normalize(values) : values;
}

export class FakeEmbeddingProvider {
  constructor(spec) {
    const validation = validateEmbeddingModelSpec(spec);
    if (!validation.ok) throw new Error(`invalid embedding spec: ${validation.errors.join('; ')}`);
    this.spec = spec;
    this.providerId = `fake:${spec.id}`;
    this.modelVersion = spec.revision;
  }

  async embed(view, text) {
    const prefixed = (view === 'query' ? this.spec.queryPrefix : this.spec.passagePrefix) + String(text);
    return fakeEmbeddingFor(prefixed, this.spec);
  }
}

export async function embedWithCache(provider, view, text, cacheDir) {
  const content = normalizeText(text);
  const specHash = embeddingSpecHash(provider.spec);
  const key = createHash('sha256').update(`${specHash}|${view}|${content}`).digest('hex');
  const file = join(cacheDir, `${key}.json`);
  if (existsSync(file)) {
    const entry = JSON.parse(readFileSync(file, 'utf8'));
    if (entry.specHash === specHash && entry.view === view) return entry.vector;
  }
  const vector = await provider.embed(view, text);
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(file, `${JSON.stringify({ specHash, view, vector, providerId: provider.providerId, modelVersion: provider.modelVersion })}\n`, 'utf8');
  return vector;
}

function resolveRevisionFromLocalCache(spec, cacheDir) {
  const root = cacheDir ?? join(os.homedir(), '.cache', 'huggingface');
  const modelDir = join(root, `models--${spec.id.replace(/\//g, '--')}`);
  try {
    const resolved = readFileSync(join(modelDir, 'refs', spec.revision), 'utf8').trim();
    if (/^[0-9a-f]{40}$/.test(resolved)) return resolved;
  } catch {
    // fall through to snapshot directory lookup
  }
  try {
    const snapshots = readdirSync(join(modelDir, 'snapshots'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    if (/^[0-9a-f]{40}$/.test(spec.revision) && snapshots.includes(spec.revision)) return spec.revision;
    if (snapshots.length === 1) return snapshots[0];
  } catch {
    // no cache yet
  }
  return null;
}

async function resolveRevisionFromHub(spec) {
  try {
    const response = await fetch(`https://huggingface.co/api/models/${spec.id}`, {
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data.sha === 'string' && /^[0-9a-f]{40}$/.test(data.sha) ? data.sha : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the actual model revision: local hub cache refs/snapshots first,
 * then the HuggingFace Hub API for the requested branch. Returns null when it
 * cannot be determined reliably; callers must fail closed in that case.
 */
export async function resolveModelRevision(spec, cacheDir) {
  const local = resolveRevisionFromLocalCache(spec, cacheDir);
  if (local) return local;
  return resolveRevisionFromHub(spec);
}

export function persistModelMeta(spec, resolvedRevision, transformersVersion, dir) {
  const file = join(dir, `${spec.id.replace(/\//g, '--')}-revision.json`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    file,
    `${JSON.stringify({
      id: spec.id,
      revision: spec.revision,
      resolvedRevision,
      transformersVersion,
      resolvedAt: new Date().toISOString(),
    }, null, 2)}\n`,
    'utf8',
  );
  return file;
}

/**
 * Real local provider backed by @huggingface/transformers (lazy import).
 * Applies the model-specific query/passage prefix, pools per spec.pooling and
 * L2-normalizes per spec.normalize. Never touches Gold truth.
 */
export class LocalTransformersProvider {
  constructor(spec, options = {}) {
    const validation = validateEmbeddingModelSpec(spec);
    if (!validation.ok) throw new Error(`invalid embedding spec: ${validation.errors.join('; ')}`);
    this.spec = { ...spec };
    this.modelCacheDir = options.modelCacheDir ?? null;
    this.metaDir = options.metaDir ?? null;
    this.pipelinePromise = null;
    this._resolvedRevision = null;
    this.providerId = `transformers:${this.spec.id}`;
    this.modelVersion = this.spec.revision;
  }

  async loadPipeline() {
    if (!this.pipelinePromise) {
      const { env, pipeline } = await import('@huggingface/transformers');
      if (this.modelCacheDir) env.cacheDir = this.modelCacheDir;
      env.allowRemoteModels = true;
      env.allowLocalModels = false;
      this.pipelinePromise = pipeline('feature-extraction', this.spec.id, { revision: this.spec.revision });
    }
    return this.pipelinePromise;
  }

  async embed(view, text) {
    const extractor = await this.loadPipeline();
    const prefixed = (view === 'query' ? this.spec.queryPrefix : this.spec.passagePrefix) + String(text);
    const output = await extractor(prefixed, { pooling: this.spec.pooling, normalize: false });
    let vector = Array.from(output.data);
    if (output.dims && output.dims.length === 3) {
      const [, seq, hidden] = output.dims;
      const values = [];
      if (this.spec.pooling === 'cls') {
        for (let index = 0; index < hidden; index += 1) values.push(vector[index]);
      } else {
        for (let hiddenIndex = 0; hiddenIndex < hidden; hiddenIndex += 1) {
          let sum = 0;
          for (let seqIndex = 0; seqIndex < seq; seqIndex += 1) sum += vector[seqIndex * hidden + hiddenIndex];
          values.push(sum / seq);
        }
      }
      vector = values;
    }
    if (vector.length !== this.spec.dimension) {
      throw new Error(`embedding dimension mismatch: got ${vector.length}, expected ${this.spec.dimension}`);
    }
    return this.spec.normalize ? l2Normalize(vector) : vector;
  }

  async resolvedRevision() {
    if (!this._resolvedRevision) {
      if (this.metaDir) {
        const metaFile = join(this.metaDir, `${this.spec.id.replace(/\//g, '--')}-revision.json`);
        try {
          const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
          if (meta.id === this.spec.id && /^[0-9a-f]{40}$/.test(meta.resolvedRevision)) {
            this._resolvedRevision = meta.resolvedRevision;
            return this._resolvedRevision;
          }
        } catch {
          // persist on first resolution
        }
      }
      await this.loadPipeline();
      this._resolvedRevision = await resolveModelRevision(this.spec, this.modelCacheDir);
      if (this._resolvedRevision && this.metaDir) {
        persistModelMeta(this.spec, this._resolvedRevision, this.spec.transformersVersion, this.metaDir);
      }
    }
    return this._resolvedRevision;
  }
}

function dotProduct(left, right) {
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) sum += left[index] * right[index];
  return sum;
}

/**
 * Pure embedding retrieval. Subject is a hard filter applied before scoring;
 * inactive and non-atomic nodes never rank. Embeddings are L2-normalized by
 * contract, so the cosine similarity is the dot product. Ranking: score
 * descending, nodeId ascending.
 */
export async function retrieveSemanticCandidates(embedder, nodes, subject, queryText, topK, queryView = 'query') {
  const candidates = (nodes ?? []).filter(
    (node) =>
      node.subject === subject &&
      node.isActive !== false &&
      (node.nodeType === undefined || node.nodeType === null || node.nodeType === 'atomicPoint'),
  );
  if (candidates.length === 0) return [];
  const queryVector = await embedder.embed(queryView, String(queryText));
  const scored = [];
  for (const candidate of candidates) {
    const text = [candidate.name, candidate.chapterName, candidate.sectionName].filter((value) => value != null && value !== '').join(' ');
    const passage = await embedder.embed('passage', text);
    scored.push({ nodeId: candidate.id, score: dotProduct(queryVector, passage) });
  }
  scored.sort((a, b) => b.score - a.score || a.nodeId.localeCompare(b.nodeId));
  const limit = typeof topK === 'number' && topK > 0 ? topK : scored.length;
  return scored.slice(0, limit);
}

/**
 * Deterministic, model-agnostic winner selection. `rule(a, b)` returns < 0 when
 * `a` wins over `b`; it receives only per-model metric objects (DEV-only by
 * construction) and never any split/truth/holdout fields.
 */
export function selectModelWinner(perModel, rule) {
  const entries = Object.entries(perModel);
  if (entries.length === 0) throw new Error('selectModelWinner: no model metrics');
  let winner = entries[0];
  for (const entry of entries.slice(1)) {
    if (rule(entry[1], winner[1]) < 0) winner = entry;
  }
  return winner[0];
}
