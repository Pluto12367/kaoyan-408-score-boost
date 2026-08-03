import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const SAMPLE_KINDS = new Set(['text', 'scan', 'complex']);
const TERMINAL_BATCH_STATUSES = new Set(['review', 'parsing_partial_failure', 'failed', 'completed', 'partially_imported']);
const REQUIRED_FIELDS = ['stem', 'answer', 'analysis', 'difficulty', 'type', 'source'];

export function validateManifest(manifest) {
  if (!manifest || !Array.isArray(manifest.samples) || manifest.samples.length === 0) {
    throw new Error('manifest.samples must be a non-empty array');
  }
  const samples = manifest.samples.map((sample, index) => {
    if (!SAMPLE_KINDS.has(sample?.kind)) throw new Error(`samples[${index}].kind must be text, scan, or complex`);
    if (typeof sample.path !== 'string' || !sample.path.toLowerCase().endsWith('.pdf')) throw new Error(`samples[${index}].path must name a PDF`);
    if (!Number.isInteger(sample.expectedQuestions) || sample.expectedQuestions < 1) throw new Error(`samples[${index}].expectedQuestions must be a positive integer`);
    for (const field of ['expectedFormulas', 'expectedImages']) {
      if (sample[field] != null && (!Number.isInteger(sample[field]) || sample[field] < 0)) throw new Error(`samples[${index}].${field} must be a non-negative integer when provided`);
    }
    return {
      kind: sample.kind,
      path: sample.path,
      expectedQuestions: sample.expectedQuestions,
      expectedFormulas: sample.expectedFormulas ?? null,
      expectedImages: sample.expectedImages ?? null,
    };
  });
  return { samples };
}

export function summarizeBatch({ kind, expectedQuestions, expectedFormulas = null, expectedImages = null, elapsedMs, pageCount, batch, candidates }) {
  const safeCandidates = Array.isArray(candidates) ? candidates : [];
  const detectedQuestions = safeCandidates.length;
  const complete = safeCandidates.filter((candidate) => REQUIRED_FIELDS.every((field) => hasValue(candidate?.[field]))).length;
  const answers = safeCandidates.filter((candidate) => hasValue(candidate?.answer)).length;
  const formulaCandidates = safeCandidates.filter((candidate) => Array.isArray(candidate?.formulas) && candidate.formulas.length > 0).length;
  const imageCandidates = safeCandidates.filter((candidate) => Array.isArray(candidate?.assets) && candidate.assets.length > 0).length;
  const warnings = safeCandidates.filter((candidate) => Array.isArray(candidate?.warnings) && candidate.warnings.length > 0).length;
  const cost = readCost(batch?.costSummary);
  const safePageCount = Math.max(1, Number.isInteger(pageCount) ? pageCount : 1);
  return {
    kind,
    expectedQuestions,
    expectedFormulas,
    expectedImages,
    detectedQuestions,
    pageCount: safePageCount,
    elapsedMs,
    metrics: {
      precision: ratio(Math.min(detectedQuestions, expectedQuestions), detectedQuestions),
      recall: ratio(Math.min(detectedQuestions, expectedQuestions), expectedQuestions),
      requiredFieldCompleteness: ratio(complete, detectedQuestions),
      answerAssociation: ratio(answers, detectedQuestions),
      formulaRetention: expectedFormulas === null ? null : ratio(Math.min(formulaCandidates, expectedFormulas), expectedFormulas),
      imageRetention: expectedImages === null ? null : ratio(Math.min(imageCandidates, expectedImages), expectedImages),
      manualWarningRate: ratio(warnings, detectedQuestions),
    },
    cost,
    costPer100Pages: cost === null ? null : round((cost / safePageCount) * 100),
  };
}

export async function runBenchmark(config, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const log = options.log ?? console.log;
  const manifest = validateManifest(config.manifest);
  const apiUrl = requiredUrl(config.apiUrl, 'apiUrl');
  const token = await login(fetchImpl, apiUrl, config.email, config.password);
  const startedAt = new Date().toISOString();
  const samples = [];

  for (const sample of manifest.samples) {
    const started = Date.now();
    const bytes = await readFile(resolve(sample.path));
    const response = await fetchImpl(`${apiUrl}/admin/question-imports`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
      body: formForSample(bytes, sample),
    });
    const created = await expectJson(response, 'upload');
    const completed = await waitForReview(fetchImpl, apiUrl, token, created.batchId, config.pollIntervalMs ?? 2_000, config.timeoutMs ?? 15 * 60_000);
    const candidates = await listCandidates(fetchImpl, apiUrl, token, created.batchId);
    const pageCount = pageCountFor(completed, candidates);
    const summary = summarizeBatch({ kind: sample.kind, expectedQuestions: sample.expectedQuestions, expectedFormulas: sample.expectedFormulas, expectedImages: sample.expectedImages, elapsedMs: Date.now() - started, pageCount, batch: completed, candidates });
    samples.push({ batchId: created.batchId, ...summary, candidateExport: redactCandidates(candidates) });
    log(`[benchmark-question-parser] completed ${sample.kind}: ${summary.detectedQuestions} candidates across ${pageCount} pages`);
  }

  return {
    schemaVersion: 1, startedAt, completedAt: new Date().toISOString(),
    samples, totals: aggregate(samples),
    releaseDecision: {
      status: 'hold',
      reason: 'manual-admin-approval-required',
      requiredApproval: ['correction-rate', 'cost-per-100-pages', 'processing-time'],
    },
    note: 'Candidate text, answers, analyses, provider tokens, and credentials are intentionally omitted.',
  };
}

async function login(fetchImpl, apiUrl, email, password) {
  if (!email || !password) throw new Error('BENCHMARK_ADMIN_EMAIL and BENCHMARK_ADMIN_PASSWORD are required');
  const response = await fetchImpl(`${apiUrl}/auth/login`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ email, password }) });
  const session = await expectJson(response, 'admin login');
  if (!session.accessToken || session.user?.role !== 'admin') throw new Error('benchmark requires an administrator account');
  return session.accessToken;
}

async function waitForReview(fetchImpl, apiUrl, token, batchId, pollIntervalMs, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const batch = await expectJson(await fetchImpl(`${apiUrl}/admin/question-imports/${encodeURIComponent(batchId)}`, { headers: { Authorization: `Bearer ${token}` } }), 'batch status');
    if (TERMINAL_BATCH_STATUSES.has(batch.status)) return batch;
    await delay(pollIntervalMs);
  }
  throw new Error(`batch ${batchId} did not reach review before the timeout`);
}

async function listCandidates(fetchImpl, apiUrl, token, batchId) {
  const items = [];
  let page = 1;
  while (true) {
    const payload = await expectJson(await fetchImpl(`${apiUrl}/admin/question-imports/${encodeURIComponent(batchId)}/candidates?page=${page}&pageSize=100`, { headers: { Authorization: `Bearer ${token}` } }), 'candidate export');
    items.push(...(payload.items ?? []));
    if (items.length >= (payload.total ?? 0) || (payload.items ?? []).length === 0) return items;
    page += 1;
  }
}

function formForSample(bytes, sample) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'application/pdf' }), basename(sample.path));
  form.append('source', `Private benchmark sample (${sample.kind})`);
  form.append('rightsConfirmed', 'true');
  form.append('title', `Private benchmark ${sample.kind}`);
  return form;
}

function redactCandidates(candidates) {
  return candidates.map((candidate) => ({ id: candidate.id, status: candidate.status, pageNumber: candidate.pageNumber ?? null, warningCodes: Array.isArray(candidate.warnings) ? candidate.warnings.map((warning) => warning?.code).filter(Boolean) : [], hasFormula: Boolean(candidate.formulas?.length), hasImage: Boolean(candidate.assets?.length) }));
}

function aggregate(samples) {
  const pages = samples.reduce((total, sample) => total + sample.pageCount, 0);
  const elapsedMs = samples.reduce((total, sample) => total + sample.elapsedMs, 0);
  const totalCost = samples.reduce((total, sample) => total + (sample.cost ?? 0), 0);
  const weighted = (key, denominator) => denominator === 0 ? 0 : round(samples.reduce((total, sample) => total + (sample.metrics[key] * (key === 'recall' ? sample.expectedQuestions : sample.detectedQuestions)), 0) / denominator);
  const optionalWeighted = (key, expectedKey) => {
    const scoped = samples.filter((sample) => sample.metrics[key] !== null);
    const denominator = scoped.reduce((total, sample) => total + sample[expectedKey], 0);
    return denominator === 0 ? null : round(scoped.reduce((total, sample) => total + (sample.metrics[key] * sample[expectedKey]), 0) / denominator);
  };
  const expected = samples.reduce((total, sample) => total + sample.expectedQuestions, 0);
  const detected = samples.reduce((total, sample) => total + sample.detectedQuestions, 0);
  return {
    pageCount: pages,
    expectedQuestions: expected,
    detectedQuestions: detected,
    elapsedMs,
    totalCost: samples.some((sample) => sample.cost !== null) ? round(totalCost) : null,
    costPer100Pages: samples.some((sample) => sample.cost !== null) ? round((totalCost / Math.max(1, pages)) * 100) : null,
    precision: weighted('precision', detected),
    recall: weighted('recall', expected),
    requiredFieldCompleteness: weighted('requiredFieldCompleteness', detected),
    answerAssociation: weighted('answerAssociation', detected),
    formulaRetention: optionalWeighted('formulaRetention', 'expectedFormulas'),
    imageRetention: optionalWeighted('imageRetention', 'expectedImages'),
    manualWarningRate: weighted('manualWarningRate', detected),
  };
}

function pageCountFor(batch, candidates) { return Math.max(1, ...[...(batch.assets ?? []), ...candidates].map((item) => Number(item?.pageNumber) || 0)); }
function readCost(cost) { const value = cost?.totalCost ?? cost?.amount ?? cost?.cost; return Number.isFinite(Number(value)) ? Number(value) : null; }
function ratio(value, total) { return total === 0 ? 0 : round(value / total); }
function round(value) { return Math.round(value * 10_000) / 10_000; }
function hasValue(value) { return typeof value === 'string' ? value.trim().length > 0 : value !== undefined && value !== null; }
function jsonHeaders() { return { 'content-type': 'application/json; charset=utf-8' }; }
function requiredUrl(value, name) { try { const url = new URL(value); if (url.protocol !== 'https:') throw new Error(); return url.href.replace(/\/$/, ''); } catch { throw new Error(`${name} must be an HTTPS URL`); } }
async function expectJson(response, label) { let body; try { body = await response.json(); } catch { throw new Error(`${label} returned non-JSON status ${response.status}`); } if (!response.ok) throw new Error(`${label} failed with status ${response.status}${body?.message ? `: ${body.message}` : ''}`); return body; }
const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

function readArgs(argv) {
  const values = Object.fromEntries(argv.slice(2).reduce((pairs, value, index, all) => value.startsWith('--') ? [...pairs, [value.slice(2), all[index + 1]]] : pairs, []));
  if (!values.manifest || !values.output) throw new Error('Usage: node scripts/benchmark-question-parser.mjs --manifest <private-manifest.json> --output <result.json>');
  return values;
}

async function main() {
  const args = readArgs(process.argv);
  const manifest = JSON.parse(await readFile(resolve(args.manifest), 'utf8'));
  const result = await runBenchmark({ manifest, apiUrl: args['api-url'] ?? process.env.BENCHMARK_API_URL, email: process.env.BENCHMARK_ADMIN_EMAIL, password: process.env.BENCHMARK_ADMIN_PASSWORD });
  await writeFile(resolve(args.output), `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await stat(resolve(args.output));
  console.log(JSON.stringify({ output: resolve(args.output), samples: result.samples.length, totals: result.totals }, null, 2));
}

if (process.argv[1]?.endsWith('benchmark-question-parser.mjs')) main().catch((error) => { console.error(`[benchmark-question-parser] FAIL ${error instanceof Error ? error.message : 'unknown error'}`); process.exitCode = 1; });
