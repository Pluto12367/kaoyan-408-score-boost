/**
 * V12-M3 — Shadow Decision Chain service.
 *
 * The service assembles the chain from real facts. What matters here:
 *   • the universe is the STUDENT's own nodes (the earlier leak class);
 *   • absence is admitted (no store, no mastery rows) rather than faked;
 *   • it writes nothing and never touches production semantics.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://stub:stub@127.0.0.1:5432/stub';
require('ts-node/register');

const { ShadowDecisionChainService } = require('../apps/api/src/study/shadow-decision-chain.service.ts');

function masteryRow(overrides = {}) {
  return {
    knowledgeNodeId: 'node-1',
    mastery: 0.4,
    accuracy: 0.45,
    recentAccuracy: 0.45,
    attempts: 4,
    correctCount: 2,
    wrongCount: 2,
    confidence: 0.3,
    retention: 0.6,
    stabilityDays: 1.7,
    lastReviewedAt: new Date('2026-09-09T00:00:00.000Z'),
    pinned: false,
    ...overrides,
  };
}

function harness(options = {}) {
  const enabled = options.enabled ?? true;
  const prisma = {
    userKnowledgeMastery: { findMany: async () => options.mastery ?? [] },
    knowledgeNode: {
      findMany: async () => options.nodes ?? [{ id: 'node-1', name: '线性表', subject: '数据结构', importance: 4, difficulty: 3 }],
    },
    knowledgeFrequencySnapshot: { findMany: async () => options.snapshots ?? [] },
    knowledgeRelation: { findMany: async () => options.relations ?? [] },
    user: { findUnique: async () => options.user ?? { targetScore: 120, remainingDays: 60 } },
    questionKnowledgeNodeTag: { findMany: async () => [] },
  };
  const assembly = options.assembly !== undefined
    ? options.assembly
    : {
        windowDays: 60,
        asOf: new Date('2026-09-11T00:00:00.000Z'),
        nodes: [
          {
            nodeId: 'node-1',
            replay: {
              nodeId: 'node-1',
              observations: 2,
              observedCorrect: 2,
              storedMastery: 0.4,
              replayMastery: 0.55,
              delta: 0.15,
              direction: 'unified_higher',
              basis: 'test',
              replayState: {
                mastery: 0.55,
                accuracy: 0.6,
                recentAccuracy: 0.62,
                attempts: 6,
                correctCount: 4,
                wrongCount: 2,
                confidence: 0.4,
              },
            },
            trigger: { eventId: 'ev-1', eventType: 'review.recalled', at: '2026-09-10T00:00:00.000Z' },
            observed: null,
          },
        ],
      };
  const reviewShadow = {
    enabled,
    assembleReplayInputs: async () => (enabled ? assembly : null),
  };
  return new ShadowDecisionChainService(enabled ? prisma : undefined, reviewShadow);
}

test('the chain is honestly absent when the store is unavailable', async () => {
  const service = harness({ enabled: false });
  assert.equal(await service.getChain('u1', {}), null);
});

test('a student with no mastery rows yields no chain rather than an empty verdict', async () => {
  const service = harness({ mastery: [] });
  assert.equal(await service.getChain('u1', {}), null);
});

test('the chain propagates a review divergence into priority and ranking', async () => {
  const service = harness({ mastery: [masteryRow()] });
  const chain = await service.getChain('u1', {});

  assert.ok(chain);
  assert.equal(chain.authoritative, false);
  assert.equal(chain.productionSemanticsChanged, false);
  assert.equal(chain.rows.length, 1);

  const row = chain.rows[0];
  assert.equal(row.observedMastery, 0.4);
  assert.equal(row.shadowMastery, 0.55);
  assert.equal(row.masteryDirection, 'unified_higher');
  assert.equal(row.triggerEventType, 'review.recalled');
  assert.match(row.attribution, /review\.recalled/);
  assert.ok(row.priorityDelta !== 0, 'better mastery must move the weakness-driven priority');
  assert.ok(row.shadowRank != null || row.observedRank != null);
  assert.equal(chain.summary.candidateUniverse.consistent, true);
});

test('the candidate universe is the student\'s own nodes only', async () => {
  const service = harness({
    mastery: [masteryRow({ knowledgeNodeId: 'mine' })],
    nodes: [
      { id: 'mine', name: '我的节点', subject: '数据结构', importance: 4, difficulty: 3 },
      { id: 'stranger', name: '别人的节点', subject: '操作系统', importance: 5, difficulty: 4 },
    ],
    assembly: { windowDays: 60, asOf: new Date('2026-09-11T00:00:00.000Z'), nodes: [] },
  });

  const chain = await service.getChain('u1', {});
  assert.ok(chain);
  assert.deepEqual(chain.summary.candidateUniverse.nodeIds, ['mine']);
  assert.equal(chain.rows.some((row) => row.knowledgeNodeId === 'stranger'), false);
  assert.equal(chain.rows[0].masteryDelta, null, 'a node with no replay has no divergence to claim');
  assert.equal(chain.rows[0].masteryDirection, 'insufficient_data');
});

test('a node with no frequency snapshot degrades to LOW evidence rather than zero importance', async () => {
  const service = harness({ mastery: [masteryRow()], snapshots: [] });
  const chain = await service.getChain('u1', {});
  assert.ok(chain);
  assert.equal(chain.rows.length, 1, 'a node without a snapshot still participates honestly');
  assert.equal(chain.rows[0].observedPriority > 0, true);
});

test('two calls on identical facts produce identical decisions', async () => {
  const service = harness({ mastery: [masteryRow()] });
  const first = await service.getChain('u1', {});
  const second = await service.getChain('u1', {});
  assert.ok(first && second);
  assert.deepEqual(
    first.rows.map((row) => [row.priorityDelta, row.rankDelta, row.masteryDelta]),
    second.rows.map((row) => [row.priorityDelta, row.rankDelta, row.masteryDelta]),
  );
});

test('the service writes nothing and never touches authoritative semantics', () => {
  const raw = readFileSync(
    fileURLToPath(new URL('../apps/api/src/study/shadow-decision-chain.service.ts', import.meta.url)),
    'utf8',
  );
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
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
    'score-center/service',
  ]) {
    assert.ok(!code.includes(primitive), `the shadow must not contain ${primitive}`);
  }
  assert.ok(code.includes('remainingDays'), 'days-to-exam must come from the real production field');
  assert.ok(!code.includes('examDate'), 'User has no examDate field');
});
