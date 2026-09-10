/**
 * V12-M4 — score opportunity shadow service.
 *
 * Pins the assembly contract: real snapshot data drives exam importance, nodes
 * with no snapshot are absent rather than zero, sparse prerequisite data reads
 * as unknown rather than "ready", and the service writes nothing.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
// The service gates on DATABASE_URL (dual-mode convention). The harness supplies
// a stub Prisma, so a placeholder DSN is enough to exercise the enabled path.
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://stub:stub@127.0.0.1:5432/stub';
require('ts-node/register');

const { ScoreOpportunityService } = require('../apps/api/src/study/score-opportunity.service.ts');

function harness(options = {}) {
  const prisma = {
    user: {
      findUnique: async () => options.user ?? { examDate: new Date(Date.now() + 60 * 86_400_000) },
    },
    knowledgeFrequencySnapshot: {
      findMany: async () => options.snapshots ?? [],
    },
    userKnowledgeMastery: { findMany: async () => options.mastery ?? [] },
    knowledgeNode: { findMany: async () => options.nodes ?? [] },
    knowledgeRelation: { findMany: async () => options.relations ?? [] },
  };
  return new ScoreOpportunityService(options.enabled === false ? undefined : prisma);
}

const snap = (nodeId, primaryScore5y, evidenceConfidence = 'HIGH') => ({
  knowledgeNodeId: nodeId,
  primaryScore5y,
  evidenceConfidence,
});

test('the shadow is honestly absent when the store is unavailable', async () => {
  const service = harness({ enabled: false });
  assert.equal(await service.getOpportunities('u1', {}), null);
});

test('no frequency snapshots means no ranking is produced at all', async () => {
  const service = harness({ snapshots: [] });
  const result = await service.getOpportunities('u1', {});
  assert.ok(result);
  assert.equal(result.opportunities.length, 0);
  assert.equal(result.summary.basis.includes('不给出空排名'), true);
  assert.equal(result.authoritative, false);
});

test('nodes with a snapshot and mastery are scored and ranked descending', async () => {
  const service = harness({
    snapshots: [snap('node-1', 10), snap('node-2', 4)],
    nodes: [
      { id: 'node-1', name: 'A', difficulty: 3 },
      { id: 'node-2', name: 'B', difficulty: 5 },
    ],
    mastery: [
      { knowledgeNodeId: 'node-1', mastery: 0.2, recentAccuracy: 0.4, correctCount: 1, retention: 0.3 },
      { knowledgeNodeId: 'node-2', mastery: 0.25, recentAccuracy: 0.4, correctCount: 2, retention: 0.3 },
    ],
  });

  const result = await service.getOpportunities('u1', {});
  assert.ok(result);
  assert.equal(result.opportunities.length, 2);
  for (const row of result.opportunities) {
    assert.ok(row.score != null, 'both nodes have every required factor');
    assert.equal(row.authoritative, false);
  }
  assert.ok((result.opportunities[0].score ?? 0) >= (result.opportunities[1].score ?? 0));
  assert.equal(result.summary.scored, 2);
  assert.equal(result.summary.blocked, 0);
});

test('a node the user never practised blocks on missing weakness instead of assuming 0.5', async () => {
  const service = harness({
    snapshots: [snap('node-1', 10)],
    nodes: [{ id: 'node-1', name: 'A', difficulty: 3 }],
    mastery: [],
  });

  const result = await service.getOpportunities('u1', {});
  assert.ok(result);
  assert.equal(result.opportunities.length, 0, 'a blocked node is not ranked');
  assert.equal(result.summary.blocked, 1);
  assert.equal(result.summary.blockedByFactor.weakness, 1);
  assert.match(result.summary.basis, /拒绝出分/);
});

test('sparse prerequisite data is treated as unknown, not as readiness', async () => {
  const service = harness({
    snapshots: [snap('node-1', 10)],
    nodes: [{ id: 'node-1', name: 'A', difficulty: 3 }],
    mastery: [
      { knowledgeNodeId: 'node-1', mastery: 0.2, recentAccuracy: 0.4, correctCount: 0, retention: 0.3 },
    ],
    relations: [],
  });

  const result = await service.getOpportunities('u1', {});
  assert.ok(result);
  const row = result.opportunities[0];
  const recoverability = row.factors.find((factor) => factor.key === 'recoverability');
  // everSucceeded is known (false) so the factor is present, but readiness is not
  // invented — and the risk text says the prerequisite picture is missing.
  assert.match(row.risk, /前置|知识关系/);
  assert.ok(recoverability.value != null);
  assert.ok(recoverability.value <= 0.45, 'never-succeeded caps recoverability');
});

test('a zero primary score yields no exam importance rather than a zero-importance claim', async () => {
  const service = harness({
    snapshots: [snap('node-1', 0)],
    nodes: [{ id: 'node-1', name: 'A', difficulty: 3 }],
    mastery: [
      { knowledgeNodeId: 'node-1', mastery: 0.2, recentAccuracy: 0.4, correctCount: 1, retention: 0.3 },
    ],
  });

  const result = await service.getOpportunities('u1', {});
  assert.ok(result);
  assert.equal(result.opportunities.length, 0);
  assert.equal(result.summary.blockedByFactor.examImportance, 1);
});

test('the top parameter bounds the returned ranking', async () => {
  const snapshots = Array.from({ length: 6 }, (_, index) => snap(`node-${index}`, 10 - index));
  const nodes = snapshots.map((row, index) => ({ id: row.knowledgeNodeId, name: `N${index}`, difficulty: 3 }));
  const mastery = snapshots.map((row) => ({
    knowledgeNodeId: row.knowledgeNodeId,
    mastery: 0.2,
    recentAccuracy: 0.4,
    correctCount: 1,
    retention: 0.3,
  }));

  const service = harness({ snapshots, nodes, mastery });
  const result = await service.getOpportunities('u1', { top: 3 });
  assert.ok(result);
  assert.equal(result.opportunities.length, 3);
  assert.equal(result.summary.scored, 6);
});

test('the endpoint is teacher/admin only and admits absence', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../apps/api/src/study/daily-brief.controller.ts', import.meta.url)),
    'utf8',
  );
  const start = source.indexOf("@Get('coach/score-opportunity')");
  assert.ok(start > 0, 'the opportunity route must be declared');
  const afterMethod = source.indexOf('async getScoreOpportunity', start);
  const nextRoute = source.indexOf('@Get(', afterMethod);
  const body = source.slice(start, nextRoute > afterMethod ? nextRoute : source.length);
  assert.ok(body.includes('getScoreOpportunity'), 'positive control: slice covers the method');
  assert.ok(body.includes("@Query('top')"), 'positive control: slice covers the signature');
  assert.ok(body.includes('@UseGuards(RoleGuard)'));
  assert.ok(body.includes("@Roles('teacher', 'admin')"));
  assert.ok(body.includes('store_unavailable'));
});

test('the service writes nothing', () => {
  const raw = readFileSync(
    fileURLToPath(new URL('../apps/api/src/study/score-opportunity.service.ts', import.meta.url)),
    'utf8',
  );
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const primitive of ['.create(', '.update(', '.upsert(', '.delete(', 'saveMastery', 'applyReview']) {
    assert.ok(!code.includes(primitive), `the shadow must not contain ${primitive}`);
  }
});
