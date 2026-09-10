/**
 * V12-M2a — Recommendation Exposure service.
 *
 * Joins the server's own recommendation facts with client exposure telemetry.
 * The tests pin the EB-3 honesty rule at the service boundary too: a store with
 * no exposure telemetry must surface "unknown", never a zero.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

const { RecommendationExposureService } = require('../apps/api/src/study/recommendation-exposure.service.ts');

function actionRow(overrides = {}) {
  return {
    id: 'a1',
    userId: 'u1',
    actionType: 'practice',
    targetType: 'knowledge_node',
    targetId: 'node-1',
    reason: '近 3 年考频高但掌握度低',
    evidenceRefs: {},
    status: 'CREATED',
    version: 0,
    creationKey: 'ck-1',
    studyTaskId: 'task-1',
    createdAt: new Date('2026-09-10T01:00:00.000Z'),
    updatedAt: new Date('2026-09-10T01:00:00.000Z'),
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    ...overrides,
  };
}

function eventRow(type, payload, at = '2026-09-10T02:00:00.000Z') {
  return { id: `e-${type}-${at}`, userId: 'u1', type, eventKey: null, payload, createdAt: new Date(at) };
}

function createHarness(options = {}) {
  const enabled = options.enabled ?? true;
  const actions = {
    enabled,
    listRecentByUser: async () => options.actions ?? [],
  };
  const userEvents = {
    enabled,
    listByType: async (userId, type) => (options.events ?? []).filter((row) => row.type === type),
  };
  return new RecommendationExposureService(actions, userEvents);
}

test('joins recommendation facts with exposure telemetry into a funnel', async () => {
  const service = createHarness({
    actions: [actionRow()],
    events: [eventRow('recommendation.exposed', { taskId: 'task-1', surface: 'today_mission' })],
  });

  const result = await service.getFunnel('u1', {});
  assert.ok(result);
  assert.equal(result.funnel.summary.generated, 1);
  assert.equal(result.funnel.summary.exposed, 1);
  assert.equal(result.funnel.summary.exposureTelemetryAvailable, true);
  assert.equal(result.funnel.rows[0].title, '近 3 年考频高但掌握度低');
});

test('without exposure telemetry the funnel reports unknown rather than zero', async () => {
  const service = createHarness({ actions: [actionRow()], events: [] });

  const result = await service.getFunnel('u1', {});
  assert.ok(result);
  assert.equal(result.funnel.summary.exposureTelemetryAvailable, false);
  assert.equal(result.funnel.summary.exposed, null);
  assert.equal(result.funnel.rows[0].stages.exposed, null);
});

test('viewed observations are matched separately from exposure', async () => {
  const service = createHarness({
    actions: [actionRow()],
    events: [
      eventRow('recommendation.exposed', { taskId: 'task-1' }),
      eventRow('recommendation.viewed', { taskId: 'task-1', surface: 'why_drawer' }),
    ],
  });

  const result = await service.getFunnel('u1', {});
  assert.ok(result);
  assert.equal(result.funnel.summary.exposed, 1);
  assert.equal(result.funnel.summary.viewed, 1);
  assert.equal(result.funnel.rows[0].reachedStage, 'viewed');
});

test('server-side started and completed facts flow through without telemetry', async () => {
  const service = createHarness({
    actions: [
      actionRow({ id: 'a1', studyTaskId: 't1' }),
      actionRow({
        id: 'a2',
        studyTaskId: 't2',
        status: 'COMPLETED',
        startedAt: new Date('2026-09-10T03:00:00.000Z'),
        completedAt: new Date('2026-09-10T04:00:00.000Z'),
      }),
    ],
    events: [],
  });

  const result = await service.getFunnel('u1', {});
  assert.ok(result);
  assert.equal(result.funnel.summary.generated, 2);
  assert.equal(result.funnel.summary.started, 1);
  assert.equal(result.funnel.summary.completed, 1);
});

test('malformed telemetry payloads are skipped instead of counted', async () => {
  const service = createHarness({
    actions: [actionRow()],
    events: [
      eventRow('recommendation.exposed', null),
      eventRow('recommendation.exposed', { surface: 'today_mission' }),
      eventRow('recommendation.exposed', { taskId: 'task-1' }),
    ],
  });

  const result = await service.getFunnel('u1', {});
  assert.ok(result);
  assert.equal(result.funnel.summary.exposed, 1, 'only the row carrying an identity counts');
});

test('the funnel is honestly absent when the store is unavailable', async () => {
  const service = createHarness({ enabled: false });
  assert.equal(await service.getFunnel('u1', {}), null);
});

test('the service never claims exposure beyond what telemetry reported', async () => {
  const service = createHarness({
    actions: [actionRow({ id: 'a1', studyTaskId: 't1' }), actionRow({ id: 'a2', studyTaskId: 't2' })],
    events: [eventRow('recommendation.exposed', { taskId: 't1' })],
  });

  const result = await service.getFunnel('u1', {});
  assert.ok(result);
  assert.equal(result.funnel.summary.exposed, 1);
  assert.equal(result.funnel.rows.find((row) => row.actionId === 'a2').stages.exposed, false);
});
