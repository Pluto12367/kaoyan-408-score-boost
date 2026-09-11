/**
 * V12-M3 — review→mastery shadow service.
 *
 * Pins the contract that makes this shadow safe to run against real students:
 *
 *   1. it is read-only — no write repository is even imported;
 *   2. the evidence boundary is enforced at the service level too: an observed
 *      review with no evidence receipt does NOT move the shadow's mastery;
 *   3. the authoritative behaviour of `applyReview` is untouched, and mastery
 *      semantics are still not switched;
 *   4. absence (unavailable store, missing downstream) is reported, never
 *      rendered as an empty success.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

const { ReviewMasteryShadowService } = require('../apps/api/src/study/review-mastery-shadow.service.ts');
const { isCandidateEnabled, parseMasterySemantics } = require('../packages/shared/dist/index.js');

const NOW = Date.now();
const SERVICE_SOURCE = new URL('../apps/api/src/study/review-mastery-shadow.service.ts', import.meta.url);
const SCORE_CENTER_SOURCE = new URL('../apps/api/src/score-center/service.ts', import.meta.url);
const CONTROLLER_SOURCE = new URL('../apps/api/src/study/daily-brief.controller.ts', import.meta.url);
const MODULE_SOURCE = new URL('../apps/api/src/study/study.module.ts', import.meta.url);

const attempt = (overrides = {}) => ({
  attemptId: overrides.attemptId ?? 'att-1',
  scheduleId: overrides.scheduleId ?? 'sched-1',
  questionId: overrides.questionId ?? 'q1',
  reviewedAt: overrides.reviewedAt ?? new Date(NOW - 3 * 86_400_000).toISOString(),
  redoCorrect: overrides.redoCorrect ?? true,
  nextIntervalDays: 3,
  idempotencyKey: null,
});

function harness(options = {}) {
  const enabled = options.enabled ?? true;
  const prisma = {
    questionKnowledgeNodeTag: { findMany: async () => options.tags ?? [{ questionId: 'q1', knowledgeNodeId: 'node-1', role: 'PRIMARY' }] },
    knowledgeNode: { findMany: async () => options.nodes ?? [{ id: 'node-1', difficulty: 3 }] },
    userKnowledgeMastery: { findMany: async () => options.mastery ?? [{ knowledgeNodeId: 'node-1', mastery: 0.5, stabilityDays: 2, confidence: 0.4 }] },
    userMasterySnapshot: { findMany: async () => options.snapshots ?? [] },
  };
  const reviewSchedules = { enabled, listAttemptsByUser: async () => options.attempts ?? [] };
  const evidence = options.evidence === undefined
    ? { list: async () => null }
    : options.evidence;
  const chain = options.chain === undefined ? undefined : options.chain;
  return new ReviewMasteryShadowService(enabled ? prisma : undefined, reviewSchedules, evidence, chain);
}

const recallReceipt = (input) => ({
  id: input.id,
  userId: 'u1',
  action: 'review.recalled',
  kind: 'recall_outcome',
  strength: 'strong',
  canInfluenceMastery: true,
  basis: '',
  metrics: { attempts: 1, correctCount: 1, accuracyRate: 100, minutesSpent: null, selfRating: null, selfReported: false },
  sourceId: input.sourceId ?? 'q1',
  actionId: null,
  recordedAt: input.recordedAt,
  source: 'derived',
});

test('the shadow is honestly absent when the store is unavailable', async () => {
  const service = harness({ enabled: false });
  assert.equal(await service.getShadow('u1', {}), null);
  assert.equal(await service.getCohort(['u1'], {}), null);
});

test('no review history yields an empty shadow that claims nothing', async () => {
  const service = harness({ attempts: [], evidence: { list: async () => ({ records: [] }) } });
  const result = await service.getShadow('u1', {});
  assert.ok(result);
  assert.equal(result.authoritative, false);
  assert.equal(result.model, 'production', 'the candidate model must never be the default');
  assert.equal(result.projection.reconciliation.events, 0);
  assert.equal(result.mastery.eventRows.length, 0);
  assert.equal(result.dataset.summary.events, 0);
  assert.equal(result.dataset.summary.attributionComplete, true, 'nothing to attribute is not an attribution failure');
  assert.equal(result.audit.passed, true);
  assert.equal(result.downstream.available, false);
  assert.match(result.downstream.basis, /不可用/);
});

test('the evidence boundary holds at the service level: no receipt, no mastery movement', async () => {
  // This is the load-bearing property. The review happened (the attempt row
  // exists) and was observed, but V12 does not let it touch the ability
  // estimate until the evidence layer has issued a receipt for it.
  const service = harness({
    attempts: [attempt({ redoCorrect: true })],
    evidence: { list: async () => ({ records: [], summary: {} }) },
  });
  const result = await service.getShadow('u1', {});
  assert.ok(result);
  assert.equal(result.projection.reconciliation.events, 1);
  assert.equal(result.projection.reconciliation.eventsWithReceipt, 0);
  assert.equal(result.projection.reconciliation.eventsWithoutReceipt, 1);
  assert.equal(result.projection.observations[0].eligibleForMastery, false);
  assert.equal(result.mastery.eventRows.length, 0);
  assert.equal(result.mastery.summary.eventsSkipped, 1);
  assert.equal(result.dataset.summary.events, 0);
  assert.equal(result.audit.passed, true, 'refusing to move is not a violation');
  assert.match(result.projection.observations[0].basis, /不参与掌握度影子/);
});

test('a receipted review produces a traceable step and a non-authoritative dataset', async () => {
  const reviewedAt = new Date(NOW - 3 * 86_400_000).toISOString();
  const service = harness({
    attempts: [attempt({ reviewedAt, redoCorrect: true })],
    evidence: { list: async () => ({ records: [recallReceipt({ id: 'LEARNING_EVIDENCE:u1:review.recalled:q1', recordedAt: reviewedAt })], summary: {} }) },
  });
  const result = await service.getShadow('u1', {});
  assert.ok(result);
  assert.equal(result.projection.reconciliation.eventsWithReceipt, 1);
  assert.equal(result.mastery.eventRows.length, 1);
  assert.equal(result.mastery.eventRows[0].reviewEventId, 'review-attempt:att-1');
  assert.equal(result.dataset.rows.length, 1);
  assert.equal(result.dataset.rows[0].authoritative, false);
  assert.equal(result.dataset.rows[0].reviewEventId, 'review-attempt:att-1');
  assert.ok(result.dataset.rows[0].attribution[0].startsWith('review.recalled:'));
  assert.equal(result.dataset.summary.attributionComplete, false, 'the downstream chain was not available');
  assert.equal(result.audit.passed, true);
  assert.match(result.mastery.eventRows[0].basis, /统一语义目标/);
});

test('node-level downstream numbers are reused from the decision chain, not recomputed', async () => {
  const reviewedAt = new Date(NOW - 3 * 86_400_000).toISOString();
  const chain = {
    getChain: async () => ({
      rows: [{
        knowledgeNodeId: 'node-1',
        observedPriority: 50,
        shadowPriority: 54,
        observedOpportunity: 0.4,
        shadowOpportunity: 0.47,
        observedRank: 4,
        shadowRank: 2,
        attribution: 'review.recalled（e） → 掌握度 0.5 → 0.6 → 优先级上升 4 分 → 推荐排名前进 2 位。',
      }],
    }),
  };
  const service = harness({
    attempts: [attempt({ reviewedAt, redoCorrect: true })],
    evidence: { list: async () => ({ records: [recallReceipt({ id: 'rcpt', recordedAt: reviewedAt })], summary: {} }) },
    chain,
  });
  const result = await service.getShadow('u1', {});
  assert.ok(result);
  assert.equal(result.downstream.available, true);
  assert.equal(result.dataset.summary.attributionComplete, true);
  const row = result.dataset.rows[0];
  assert.equal(row.observedPriority, 50);
  assert.equal(row.shadowPriority, 54);
  assert.equal(row.priorityDelta, 4);
  assert.equal(row.opportunityDelta, 0.07);
  assert.equal(row.rankDelta, -2);
  assert.ok(row.attribution.includes('priority'));
  assert.ok(row.attribution.includes('opportunity'));
  assert.ok(row.attribution.includes('recommendation'));
  assert.match(row.attributionBasis, /推荐排名/);
  assert.equal(result.audit.passed, true);
});

test('a node the decision chain never covered reads as unattributed, not as unchanged', async () => {
  const reviewedAt = new Date(NOW - 3 * 86_400_000).toISOString();
  const service = harness({
    attempts: [attempt({ reviewedAt, redoCorrect: true })],
    evidence: { list: async () => ({ records: [recallReceipt({ id: 'rcpt', recordedAt: reviewedAt })], summary: {} }) },
    chain: { getChain: async () => ({ rows: [] }) },
  });
  const result = await service.getShadow('u1', {});
  assert.ok(result);
  assert.equal(result.downstream.available, false);
  assert.equal(result.dataset.summary.attributionComplete, false);
  assert.equal(result.dataset.rows[0].priorityDelta, null);
  assert.match(result.downstream.basis, /没有覆盖/);
});

test('the candidate model is opt-in and behaviourally separate', async () => {
  const reviewedAt = new Date(NOW - 3 * 86_400_000).toISOString();
  const service = harness({
    attempts: [attempt({ reviewedAt, redoCorrect: true })],
    evidence: { list: async () => ({ records: [recallReceipt({ id: 'rcpt', recordedAt: reviewedAt })], summary: {} }) },
  });
  const production = await service.getShadow('u1', {});
  const candidate = await service.getShadow('u1', { shadowModel: 'direction_preserving' });
  assert.equal(production.model, 'production');
  assert.equal(candidate.model, 'direction_preserving');
  assert.equal(candidate.authoritative, false);
});

// ---------------------------------------------------------------------------
// Structural guards: the production write path and the switch stay untouched
// ---------------------------------------------------------------------------

test('the shadow service imports no write repository at all', () => {
  const source = readFileSync(SERVICE_SOURCE, 'utf8');
  const imports = [...source.matchAll(/^import .*from '(.+)';$/gm)].map((match) => match[1]);
  const repositoryImports = imports.filter((path) => /repository/i.test(path));
  assert.deepEqual(
    repositoryImports,
    ['./review-schedule.repository'],
    'only the read-only review schedule repository may be imported',
  );
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.equal(/applyReview|applyAttempts|scoreCenterService/.test(stripped), false);
  assert.equal(/\$transaction/.test(stripped), false);
  assert.match(stripped, /findMany/, 'positive control: the file really was scanned');
});

test('applyReview still leaves mastery untouched — the gap is real, not papered over', () => {
  const source = readFileSync(SCORE_CENTER_SOURCE, 'utf8');
  const start = source.indexOf('async applyReview(');
  assert.ok(start > 0, 'applyReview must still exist');
  // Bound at the NEXT method, not at a later one: V12-M3-C inserted
  // `applyReviewObservation` between applyReview and getKnowledgeDetail, and
  // that method legitimately DOES assign mastery. Slicing past it dragged the
  // new authoritative writer into this assertion.
  const end = source.indexOf('async applyReviewObservation(', start);
  assert.ok(end > start, 'positive control: the slice is bounded by the next method');
  const body = source.slice(start, end);
  assert.ok(body.length > 400, 'positive control: the extracted body is not empty');
  // Strip comments: the doc comment of the NEXT method also names the switch,
  // and matching prose is how an assertion stops testing behaviour.
  const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  // The gap this milestone exists to close: applyReview itself never assigns
  // mastery. The ability estimate is reached through the evidence projection
  // (applyReviewObservation), which is asserted separately below.
  assert.match(code, /\.\.\.current,/, 'applyReview must still spread the existing mastery state');
  assert.match(code, /updateStabilityAfterReview/, 'stability is still what review updates');
  assert.match(code, /retention = 1/, 'the stored retention constant is unchanged');
  assert.equal(/mastery\s*:/.test(code.replace(/mastery\s*:\s*current\.mastery/g, '')), false,
    'applyReview must not assign a new mastery value');
  assert.equal(/applyMasterySemantics/.test(code), false, 'the review writer must not apply the transition itself');
  assert.equal(/userKnowledgeMastery|userMasterySnapshot\s*\.\s*(update|upsert|create)/.test(code.replace(/saveMasteryWithOptimisticRetry|saveMasterySnapshot/g, '')), false);
});

test('the authoritative review→mastery projection is conditioned on a receipt', () => {
  const source = readFileSync(
    new URL('../apps/api/src/study/review-mastery-integration.service.ts', import.meta.url),
    'utf8',
  );
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  // The literal production chain, in order: receipt → projection → mastery.
  const receipt = code.indexOf('recordReviewRecallDurable');
  const projection = code.indexOf('projectReviewEvidence(');
  const apply = code.indexOf('applyReviewObservation(');
  assert.ok(receipt > 0, 'the receipt must be recorded');
  assert.ok(projection > receipt, 'the receipt must exist before the projection decides');
  assert.ok(apply > projection, 'mastery must be applied after the projection');
  assert.match(code, /if \(!durable\.persisted\)/, 'a non-durable receipt must block the mastery write');
  assert.match(code, /if \(!observation\.eligibleForMastery\)/, 'an ineligible receipt must block the mastery write');
  assert.match(code, /findCanonicalEvent/, 'the exactly-once claim must be checked');
  assert.match(code, /REVIEW_MASTERY_APPLIED_EVENT_TYPE/, 'the claim must be recorded for replay safety');

  // It must NOT go around the evidence layer.
  assert.equal(/applyReview\(/.test(code), false, 'the integration must not call the review writer directly');
  assert.equal(/userKnowledgeMastery/.test(code), false, 'the integration must not write mastery itself');
  assert.ok(!/updateMasteryAfterAttempt\(/.test(code), 'the transition belongs to the mastery engine, not here');
});

test('mastery semantics remain unswitched and unreachable from the shadow', () => {
  assert.equal(process.env.MASTERY_SEMANTICS, undefined, 'the flag must not be set in this environment');
  assert.equal(parseMasterySemantics(undefined), 'legacy');
  assert.equal(isCandidateEnabled(undefined), false);
  assert.equal(parseMasterySemantics('anything-else'), 'legacy', 'only the exact opt-in value enables the candidate');
  const envFiles = ['.env.development', '.env.production.example', '.env.staging.example', '.env.example'];
  for (const file of envFiles) {
    let content;
    try {
      content = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    } catch {
      continue;
    }
    assert.equal(/^\s*MASTERY_SEMANTICS\s*=/m.test(content), false, `${file} must not enable the candidate`);
  }
});

test('the endpoint is registered, teacher/admin only, and defaults to production semantics', () => {
  const controller = readFileSync(CONTROLLER_SOURCE, 'utf8');
  const index = controller.indexOf("@Get('coach/review-mastery-shadow')");
  assert.ok(index > 0, 'the endpoint must be registered');
  const slice = controller.slice(index, controller.indexOf('@Get(', index + 1));
  assert.ok(slice.length > 200, 'positive control: the handler slice is not empty');
  assert.match(slice, /@UseGuards\(RoleGuard\)/);
  assert.match(slice, /@Roles\('teacher', 'admin'\)/);
  assert.match(slice, /shadowModel === 'candidate' \? 'direction_preserving' : 'production'/);
  assert.match(slice, /this\.reviewMasteryShadow\.getShadow/);
  assert.match(slice, /reason: 'store_unavailable'/, 'absence must be reported, not thrown away');

  const moduleSource = readFileSync(MODULE_SOURCE, 'utf8');
  assert.match(moduleSource, /ReviewMasteryShadowService/, 'the provider must be registered');
  assert.match(moduleSource, /from '\.\/review-mastery-shadow\.service'/, 'and imported from its own file');
});
