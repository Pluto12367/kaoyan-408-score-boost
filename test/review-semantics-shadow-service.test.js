/**
 * V12-M3 Phase B — review semantics shadow service.
 *
 * Pins the read-only contract: the shadow assembles from existing facts, writes
 * nothing, emits no events, and admits absence rather than returning an empty
 * success. Also proves the question→node resolution honours PRIMARY tags, which
 * is what makes the replay comparable to production's applyAttempts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

const { ReviewSemanticsShadowService } = require('../apps/api/src/study/review-semantics-shadow.service.ts');

const NOW = Date.now();

function harness(options = {}) {
  const enabled = options.enabled ?? true;
  const prisma = {
    questionKnowledgeNodeTag: {
      findMany: async () => options.tags ?? [],
    },
    question: { findMany: async () => options.questions ?? [] },
    knowledgeNode: { findMany: async () => options.nodes ?? [{ id: 'node-1', difficulty: 3 }] },
    userKnowledgeMastery: { findMany: async () => options.mastery ?? [] },
    userMasterySnapshot: { findMany: async () => options.snapshots ?? [] },
  };
  const reviewSchedules = {
    enabled,
    listAttemptsByUser: async () => options.attempts ?? [],
  };
  return new ReviewSemanticsShadowService(enabled ? prisma : undefined, reviewSchedules);
}

const attempt = (overrides = {}) => ({
  questionId: 'q1',
  reviewedAt: new Date(NOW - 3 * 86_400_000).toISOString(),
  redoCorrect: true,
  nextIntervalDays: 3,
  ...overrides,
});

test('the shadow is honestly absent when the store is unavailable', async () => {
  const service = harness({ enabled: false });
  assert.equal(await service.getShadow('u1', {}), null);
});

test('no review history yields an empty shadow that claims nothing', async () => {
  const service = harness({ attempts: [] });
  const result = await service.getShadow('u1', {});
  assert.ok(result);
  assert.equal(result.authoritative, false, 'shadow output must never look authoritative');
  assert.equal(result.masteryReplay.rows.length, 0);
  assert.equal(result.retention.rows.length, 0);
  assert.equal(result.source, 'derived');
});

test('the published semantics matrix is served alongside the numbers', async () => {
  const service = harness({ attempts: [] });
  const result = await service.getShadow('u1', {});
  assert.ok(result);
  assert.ok(Array.isArray(result.semantics));
  assert.ok(result.semantics.some((row) => row.action === 'review.recalled' && row.changesMastery === false));
});

test('resolves a question to its PRIMARY node and replays observed reviews', async () => {
  const service = harness({
    attempts: [
      attempt({ reviewedAt: new Date(NOW - 5 * 86_400_000).toISOString(), redoCorrect: true }),
      attempt({ reviewedAt: new Date(NOW - 3 * 86_400_000).toISOString(), redoCorrect: true }),
    ],
    tags: [
      { questionId: 'q1', knowledgeNodeId: 'node-secondary', role: 'SECONDARY' },
      { questionId: 'q1', knowledgeNodeId: 'node-primary', role: 'PRIMARY' },
    ],
    nodes: [
      { id: 'node-primary', difficulty: 3 },
      { id: 'node-secondary', difficulty: 3 },
    ],
    mastery: [
      { knowledgeNodeId: 'node-primary', mastery: 0.5, retention: 1, stabilityDays: 2.89, lastReviewedAt: new Date(NOW - 3 * 86_400_000) },
    ],
    snapshots: [
      {
        knowledgeNodeId: 'node-primary',
        mastery: 0.5,
        accuracy: 0.55,
        recentAccuracy: 0.55,
        attempts: 4,
        correctCount: 2,
        wrongCount: 2,
        confidence: 0.3,
        snapshotDate: new Date(NOW - 6 * 86_400_000),
      },
    ],
  });

  const result = await service.getShadow('u1', {});
  assert.ok(result);
  assert.equal(result.masteryReplay.rows.length, 1, 'only the PRIMARY node is replayed');
  const row = result.masteryReplay.rows[0];
  assert.equal(row.nodeId, 'node-primary');
  assert.equal(row.observations, 2);
  assert.equal(row.observedCorrect, 2);
  assert.equal(row.storedMastery, 0.5);
  assert.ok(row.replayMastery > 0.5, 'observed correct reviews raise the replayed estimate');
  assert.equal(row.direction, 'unified_higher');
});

test('falls back to a neutral baseline when no snapshot precedes the observation', async () => {
  const service = harness({
    attempts: [attempt()],
    tags: [{ questionId: 'q1', knowledgeNodeId: 'node-1', role: 'PRIMARY' }],
    mastery: [{ knowledgeNodeId: 'node-1', mastery: 0.5, retention: 1, stabilityDays: 1.7, lastReviewedAt: new Date(NOW) }],
    snapshots: [],
  });

  const result = await service.getShadow('u1', {});
  assert.ok(result);
  const row = result.masteryReplay.rows[0];
  assert.ok(row.replayMastery != null, 'the replay is still decidable without a baseline');
  assert.match(row.basis, /无历史快照/);
});

test('exposes a stored constant retention as optimistic against the time-aware value', async () => {
  const service = harness({
    attempts: [attempt({ reviewedAt: new Date(NOW - 20 * 86_400_000).toISOString() })],
    tags: [{ questionId: 'q1', knowledgeNodeId: 'node-1', role: 'PRIMARY' }],
    mastery: [
      {
        knowledgeNodeId: 'node-1',
        mastery: 0.7,
        retention: 1,
        stabilityDays: 2,
        lastReviewedAt: new Date(NOW - 20 * 86_400_000),
      },
    ],
  });

  const result = await service.getShadow('u1', {});
  assert.ok(result);
  const row = result.retention.rows[0];
  assert.equal(row.storedRetention, 1);
  assert.ok(row.computedRetention < 1);
  assert.equal(row.verdict, 'stored_optimistic');
  assert.equal(result.retention.summary.authoritative, false);
});

test('window filtering keeps old attempts out of the replay', async () => {
  const service = harness({
    attempts: [attempt({ reviewedAt: new Date(NOW - 400 * 86_400_000).toISOString() })],
    tags: [{ questionId: 'q1', knowledgeNodeId: 'node-1', role: 'PRIMARY' }],
  });

  const result = await service.getShadow('u1', { windowDays: 60 });
  assert.ok(result);
  assert.equal(result.masteryReplay.rows.length, 0);
});

test('the endpoint is teacher/admin only and admits absence when the store is down', () => {
  const source = require('node:fs').readFileSync(
    fileURLToPath(new URL('../apps/api/src/study/daily-brief.controller.ts', import.meta.url)),
    'utf8',
  );
  const at = source.indexOf("@Get('coach/review-semantics-shadow')");
  assert.ok(at > 0, 'the shadow route must be declared');
  const window = source.slice(at, at + 700);
  assert.ok(window.includes('@UseGuards(RoleGuard)'));
  assert.ok(
    window.includes("@Roles('teacher', 'admin')"),
    'the shadow is a model-quality instrument, not student UI',
  );
  assert.ok(window.includes('store_unavailable'), 'absence must be admitted');
  assert.ok(window.includes('resolveUserId'), 'teacher access must go through authorization');
});

test('the shadow writes nothing and never touches the learning write tables', () => {
  const raw = require('node:fs').readFileSync(
    fileURLToPath(new URL('../apps/api/src/study/review-semantics-shadow.service.ts', import.meta.url)),
    'utf8',
  );
  // Scan CODE, not prose: the module's docblock legitimately names the write
  // paths it deliberately avoids, and a naive substring check would flag that.
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const primitive of [
    '.create(',
    '.update(',
    '.updateMany(',
    '.upsert(',
    '.delete(',
    'saveMastery',
    'applyReview',
    'applyAttempts',
    'recordCanonicalEvent',
  ]) {
    assert.ok(!code.includes(primitive), `the shadow must not contain ${primitive}`);
  }
});
