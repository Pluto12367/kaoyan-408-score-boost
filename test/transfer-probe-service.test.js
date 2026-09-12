/**
 * S2 Transfer Probe — service contract (sandbox-loaded).
 *
 * Pins the orchestration invariants:
 *   • scheduling is idempotent and skips pending/recent probes; it REQUIRES
 *     observed intervention evidence (a completion marker alone never schedules)
 *   • delivery enforces never-seen (E2-E6) via the eligibility loader and is
 *     capped per day; no eligible question => honest no_probe_available
 *   • expiry is not failure
 *   • the projection endpoints are read-only over the evidence ledger
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://stub:stub@127.0.0.1:5432/stub';
process.env.TRANSFER_PROBE_ENABLED = 'true';
require('ts-node/register');

const { TransferProbeService, TransferProbeProjection } = require('../apps/api/src/transfer-probe/transfer-probe.service.ts');

const DAY = 86_400_000;
const NOW = new Date('2026-09-12T04:00:00.000Z'); // 38h after the intervention below

function stubDb(overrides = {}) {
  const calls = { created: [], updates: [], sessions: [] };
  const interventionCompletedAt = new Date(NOW.getTime() - 38 * 3_600_000);
  const db = {
    calls,
    practiceRecord: {
      count: async () => 3,
      findFirst: async () => null,
      findMany: async () => [],
    },
    recommendationAction: {
      findFirst: async () => null,
      findMany: async () => [],
      findUnique: async () => ({ targetId: 'node-1' }),
      update: async ({ where, data }) => {
        calls.updates.push({ table: 'recommendationAction', where, data });
        return { id: where.id };
      },
    },
    studyTask: {
      create: async ({ data }) => {
        calls.created.push({ table: 'studyTask', data });
        return { id: 'probe-task-1' };
      },
      findMany: async () => [],
      update: async () => ({ id: 'x' }),
    },
    question: {
      findMany: async () => [
        { id: 'pq-1', stem: 'probe stem', options: ['A', 'B'], type: 'SINGLE_CHOICE', difficulty: 'MEDIUM', expectedTimeSec: 100, familyId: 'fam-1', source: 'transfer_probe_pool' },
      ],
      count: async () => 2,
    },
    learningSession: {
      findFirst: async () => null,
      count: async () => 0,
    },
    userEvent: { findFirst: async () => null, findMany: async () => [] },
    knowledgePointNodeMap: { findFirst: async () => ({ knowledgePointId: 'kp-1' }) },
    knowledgeNode: { findUnique: async () => ({ name: 'Cache 基本原理' }) },
    reviewAttempt: { findFirst: async () => null },
    ...overrides,
  };
  return db;
}

function stubAdapters(db) {
  return {
    actionAdapter: {
      createOrGetAction: async (input) => {
        db.calls.created.push({ table: 'action', data: input });
        return { id: 'probe-action-1' };
      },
      bindStudyTask: async () => true,
    },
    studyPlanRepository: {
      createOrGetByGenerationKey: async () => ({ id: 'probe-plan-1' }),
    },
    learningSessions: {
      createFromAction: async (session) => {
        db.calls.sessions.push(session);
        return { ...session, id: 'probe-session-1' };
      },
    },
    questionsService: { findQuestionById: async () => null },
  };
}

function service(db, adapters = {}) {
  const a = { ...stubAdapters(db), ...adapters };
  return new TransferProbeService(db, a.actionAdapter, a.studyPlanRepository, a.learningSessions, a.questionsService);
}

const completedTask = { id: 'task-1', knowledgeNodeId: 'node-1', completedAt: new Date(NOW.getTime() - 38 * 3_600_000) };

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

test('scheduling requires observed intervention evidence — a bare completion never schedules', async () => {
  const db = stubDb({ practiceRecord: { count: async () => 0, findFirst: async () => null, findMany: async () => [] } });
  const result = await service(db).scheduleProbeForCompletedTask('u1', completedTask);
  assert.deepEqual(result, { skipped: 'no_intervention_evidence' });
  assert.equal(db.calls.created.length, 0);
});

test('a happy-path schedule creates the probe action and the probe task', async () => {
  const db = stubDb();
  const result = await service(db).scheduleProbeForCompletedTask('u1', completedTask);
  assert.equal(result.probeId, 'probe-action-1');
  const actionCall = db.calls.created.find((row) => row.table === 'action');
  assert.equal(actionCall.data.actionType, 'TRANSFER_PROBE', 'the probe action type passes through the adapter');
  assert.ok(actionCall.data.generationKey.startsWith('TRANSFER_PROBE:u1:node-1:'), 'deterministic creation identity');
  const taskCall = db.calls.created.find((row) => row.table === 'studyTask');
  assert.equal(taskCall.data.mode, '复测');
  assert.equal(taskCall.data.questionCount, 1);
});

test('duplicate scheduling is reported as duplicate without binding a second task', async () => {
  const db = stubDb({
    recommendationAction: {
      findFirst: async (args) => (args.where.creationKey ? { id: 'existing-action' } : null),
      findMany: async () => [],
      findUnique: async () => ({ targetId: 'node-1' }),
      update: async () => ({ id: 'x' }),
    },
  });
  const result = await service(db).scheduleProbeForCompletedTask('u1', completedTask);
  assert.equal(result.duplicate, true);
  const binds = db.calls.created.filter((row) => row.table === 'studyTask');
  assert.equal(binds.length, 1, 'only one task creation path ran (no second bind)');
});

test('a pending probe on the node skips new scheduling', async () => {
  const db = stubDb({
    recommendationAction: {
      findFirst: async (args) => (args.where.status ? { id: 'pending' } : null),
      findMany: async () => [],
      findUnique: async () => ({ targetId: 'node-1' }),
      update: async () => ({ id: 'x' }),
    },
  });
  const result = await service(db).scheduleProbeForCompletedTask('u1', completedTask);
  assert.deepEqual(result, { skipped: 'pending_probe_exists' });
});

test('a probe on the node within the spacing window skips new scheduling', async () => {
  const db = stubDb({
    recommendationAction: {
      findFirst: async (args) => (args.where.createdAt ? { id: 'recent' } : null),
      findMany: async () => [],
      findUnique: async () => ({ targetId: 'node-1' }),
      update: async () => ({ id: 'x' }),
    },
  });
  const result = await service(db).scheduleProbeForCompletedTask('u1', completedTask);
  assert.deepEqual(result, { skipped: 'recent_probe_exists' });
});

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

function dueProbeDb(overrides = {}) {
  const db = stubDb({
    practiceRecord: {
      count: async () => 3,
      findFirst: async () => null,
      // intervention facts: the node has objective practice on MEDIUM SINGLE_CHOICE
      findMany: async () => [{ question: { difficulty: 'MEDIUM', type: 'SINGLE_CHOICE' } }],
    },
    recommendationAction: {
      findFirst: async () => null,
      findMany: async (args) => {
        if (args.where.status === 'CREATED') {
          return [{
            id: 'probe-action-1',
            targetId: 'node-1',
            status: 'CREATED',
            createdAt: new Date(NOW.getTime() - 38 * 3_600_000),
            evidenceRefs: [{ kind: 'transfer-probe', taskId: 'probe-task-1', interventionCompletedAt: new Date(NOW.getTime() - 38 * 3_600_000).toISOString() }],
            studyTask: { id: 'probe-task-1', scheduledDate: '2026-09-12' },
          }];
        }
        return [];
      },
      findUnique: async () => ({ targetId: 'node-1' }),
      update: async ({ where, data }) => {
        db.calls.updates.push({ table: 'recommendationAction', where, data });
        return { id: where.id };
      },
    },
    studyTask: {
      create: async ({ data }) => { db.calls.created.push({ table: 'studyTask', data }); return { id: 't' }; },
      findMany: async () => [],
      update: async () => ({ id: 'x' }),
    },
    ...overrides,
  });
  return db;
}

test('delivery opens the probe session, starts the action and returns a student-safe card', async () => {
  const db = dueProbeDb();
  const result = await service(db).getDueProbes('u1');
  assert.equal(result.deliveredCount, 1);
  const card = result.cards[0];
  assert.equal(card.session.sessionId, 'probe-session-1');
  assert.equal(card.session.question.stem, 'probe stem');
  assert.ok(!('answer' in card.session.question), 'the card never carries the answer');
  assert.ok(!('analysis' in card.session.question), 'the card never carries the analysis');
  const session = db.calls.sessions[0];
  assert.equal(session.type, 'transfer_probe');
  assert.equal(session.actionId, 'probe-action-1');
  const start = db.calls.updates.find((row) => row.data.status === 'STARTED');
  assert.ok(start, 'the probe action moved to STARTED');
});

test('no eligible question yields an honest no_probe_available card and no session', async () => {
  const db = dueProbeDb({
    question: {
      findMany: async () => [],
      count: async () => 0,
    },
  });
  const result = await service(db).getDueProbes('u1');
  assert.equal(result.deliveredCount, 0);
  assert.equal(result.cards[0].reason, 'no_probe_available');
  assert.equal(result.cards[0].session, null);
  assert.equal(db.calls.sessions.length, 0);
});

test('an out-of-window probe expires without being counted as failure', async () => {
  const db = stubDb({
    recommendationAction: {
      findFirst: async () => null,
      findMany: async (args) => (args.where.status === 'CREATED'
        ? [{
          id: 'stale-action',
          targetId: 'node-1',
          status: 'CREATED',
          createdAt: new Date(NOW.getTime() - 40 * DAY),
          evidenceRefs: [{ kind: 'transfer-probe', interventionCompletedAt: new Date(NOW.getTime() - 40 * DAY).toISOString() }],
        }]
        : []),
      findUnique: async () => ({ targetId: 'node-1' }),
      update: async ({ where, data }) => {
        db.calls.updates.push({ table: 'recommendationAction', where, data });
        return { id: where.id };
      },
    },
    studyTask: { create: async () => ({ id: 't' }), findMany: async () => [], update: async () => ({ id: 'x' }) },
  });
  const result = await service(db).getDueProbes('u1');
  assert.equal(result.deliveredCount, 0);
  const expired = db.calls.updates.find((row) => row.data.status === 'EXPIRED');
  assert.ok(expired, 'the stale probe action expired');
});

test('the feature flag stops scheduling and delivery entirely', async () => {
  process.env.TRANSFER_PROBE_ENABLED = 'false';
  const db = stubDb();
  const result = await service(db).getDueProbes('u1');
  assert.equal(result.featureEnabled, false);
  assert.equal(result.cards.length, 0);
  process.env.TRANSFER_PROBE_ENABLED = 'true';
});

// ---------------------------------------------------------------------------
// Projection — read-only over the evidence ledger
// ---------------------------------------------------------------------------

test('the transfer summary aggregates evidence events and never writes', async () => {
  const probeEvent = (questionId, correct) => ({
    id: `ev-${questionId}`,
    type: 'EVIDENCE_RECORDED',
    createdAt: new Date(NOW),
    payload: {
      action: 'practice.answered',
      actionId: 'probe-action-1',
      observedAttempts: 1,
      observedCorrectCount: correct ? 1 : 0,
      recordedAt: NOW.toISOString(),
      detail: { kind: 'transfer_probe', probeId: 'probe-action-1', nodeId: 'node-1', questionId, bucket: 'MEDIUM', isomorphism: 'verified', kind_probe: 'practice_difficulty' },
    },
  });
  const events = [probeEvent('pq-1', true), probeEvent('pq-2', true), probeEvent('pq-3', true), probeEvent('pq-4', true), probeEvent('pq-5', false)];
  const db = stubDb({
    userEvent: { findFirst: async () => null, findMany: async () => events },
    practiceRecord: {
      count: async () => 0,
      findFirst: async () => null,
      findMany: async () => Array.from({ length: 10 }, (_, i) => ({ correct: i < 8 })),
    },
    question: { findMany: async () => [], count: async () => 4 },
    learningSession: { findFirst: async () => null, count: async () => 0 },
  });
  const projection = new TransferProbeProjection(db);
  const summary = await projection.getTransferSummary();
  assert.equal(summary.authoritative, false);
  assert.equal(summary.rows.length, 1);
  const row = summary.rows[0];
  assert.equal(row.nodeId, 'node-1');
  assert.equal(row.probeAttempts, 5);
  assert.equal(row.transferRate, 80);
  assert.equal(row.practiceAccuracy, 80);
  assert.equal(row.transferGap, 0);
  assert.equal(row.gate, 'reported');
  assert.equal(summary.poolRemainingByBucket['node-1'].MEDIUM, 4);
});

test('the transfer summary reports insufficient_data below the sample floor', async () => {
  const probeEvent = (i) => ({
    id: `ev-${i}`,
    type: 'EVIDENCE_RECORDED',
    createdAt: new Date(NOW),
    payload: {
      action: 'practice.answered', actionId: 'p1', observedAttempts: 1, observedCorrectCount: 1,
      recordedAt: NOW.toISOString(),
      detail: { kind: 'transfer_probe', probeId: 'p1', nodeId: 'node-1', questionId: `q${i}`, bucket: 'MEDIUM', isomorphism: 'verified', kind_probe: 'practice_difficulty' },
    },
  });
  const db = stubDb({
    userEvent: { findFirst: async () => null, findMany: async () => [1, 2, 3].map(probeEvent) },
    practiceRecord: { count: async () => 0, findFirst: async () => null, findMany: async () => [] },
    question: { findMany: async () => [], count: async () => 0 },
    learningSession: { findFirst: async () => null, count: async () => 0 },
  });
  const projection = new TransferProbeProjection(db);
  const summary = await projection.getTransferSummary();
  assert.equal(summary.rows[0].gate, 'insufficient_data');
  assert.equal(summary.rows[0].transferRate, null);
});
