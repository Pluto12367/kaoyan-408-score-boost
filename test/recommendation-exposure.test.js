/**
 * V12-M2a — Recommendation Exposure funnel (pure module contract).
 *
 * EB-3: the system could not answer "did the student actually SEE the
 * recommendation?". The critical honesty rule under test: when no exposure
 * telemetry exists at all we must return UNKNOWN (null), never 0 — reporting
 * "0 exposed" would be a fabricated measurement, and reporting "exposed" from
 * anything other than a real client observation would be fabricated exposure.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecommendationFunnel } from '../packages/shared/dist/index.js';

function fact(overrides = {}) {
  return {
    actionId: 'a1',
    title: '线性表顺序存储',
    createdAt: '2026-09-10T01:00:00.000Z',
    startedAt: null,
    completedAt: null,
    status: 'CREATED',
    taskId: 'task-1',
    ...overrides,
  };
}

test('with no exposure telemetry the funnel reports unknown, not zero', () => {
  const funnel = buildRecommendationFunnel({ recommendations: [fact()], observations: [] });

  assert.equal(funnel.summary.exposureTelemetryAvailable, false);
  assert.equal(funnel.summary.exposed, null, 'absent telemetry is unknown, not "0 exposed"');
  assert.equal(funnel.summary.viewed, null);
  assert.equal(funnel.rows[0].stages.exposed, null);
  assert.equal(funnel.rows[0].stages.viewed, null);
  assert.match(funnel.summary.basis, /无法判断|尚无/);
});

test('once telemetry exists, absence of an observation for one item means genuinely not exposed', () => {
  const funnel = buildRecommendationFunnel({
    recommendations: [fact({ actionId: 'a1' }), fact({ actionId: 'a2', taskId: 'task-2' })],
    observations: [{ stage: 'exposed', actionId: 'a1', at: '2026-09-10T02:00:00.000Z', surface: 'today_mission' }],
  });

  assert.equal(funnel.summary.exposureTelemetryAvailable, true);
  assert.equal(funnel.summary.exposed, 1);
  const a2 = funnel.rows.find((row) => row.actionId === 'a2');
  assert.equal(a2.stages.exposed, false, 'the instrument works, so absence is meaningful');
});

test('an exposure observation matches by taskId when the client only knows the task', () => {
  const funnel = buildRecommendationFunnel({
    recommendations: [fact({ actionId: 'a1', taskId: 'task-1' })],
    observations: [{ stage: 'exposed', taskId: 'task-1', at: '2026-09-10T02:00:00.000Z' }],
  });
  assert.equal(funnel.rows[0].stages.exposed, true);
});

test('viewed requires its own observation and is not inferred from exposure', () => {
  const funnel = buildRecommendationFunnel({
    recommendations: [fact()],
    observations: [{ stage: 'exposed', actionId: 'a1', at: '2026-09-10T02:00:00.000Z' }],
  });
  assert.equal(funnel.rows[0].stages.exposed, true);
  assert.equal(funnel.rows[0].stages.viewed, false, 'seeing a card is not opening its explanation');
});

test('reached stage walks the lifecycle in order', () => {
  const generated = buildRecommendationFunnel({ recommendations: [fact()], observations: [] });
  assert.equal(generated.rows[0].reachedStage, 'generated');

  const started = buildRecommendationFunnel({
    recommendations: [fact({ status: 'STARTED', startedAt: '2026-09-10T03:00:00.000Z' })],
    observations: [],
  });
  assert.equal(started.rows[0].reachedStage, 'started');

  const completed = buildRecommendationFunnel({
    recommendations: [
      fact({ status: 'COMPLETED', startedAt: '2026-09-10T03:00:00.000Z', completedAt: '2026-09-10T04:00:00.000Z' }),
    ],
    observations: [],
  });
  assert.equal(completed.rows[0].reachedStage, 'completed');
});

test('a started recommendation is not downgraded when exposure telemetry is missing', () => {
  const funnel = buildRecommendationFunnel({
    recommendations: [fact({ status: 'STARTED', startedAt: '2026-09-10T03:00:00.000Z' })],
    observations: [],
  });
  assert.equal(funnel.rows[0].stages.started, true);
  assert.equal(funnel.rows[0].reachedStage, 'started', 'server facts are stronger than absent telemetry');
});

test('started and completed counts come from server facts and need no telemetry', () => {
  const funnel = buildRecommendationFunnel({
    recommendations: [
      fact({ actionId: 'a1' }),
      fact({ actionId: 'a2', status: 'COMPLETED', startedAt: 'x', completedAt: 'y' }),
    ],
    observations: [],
  });
  assert.equal(funnel.summary.generated, 2);
  assert.equal(funnel.summary.started, 1);
  assert.equal(funnel.summary.completed, 1);
});

test('duplicate observations of the same stage never inflate the funnel', () => {
  const funnel = buildRecommendationFunnel({
    recommendations: [fact()],
    observations: [
      { stage: 'exposed', actionId: 'a1', at: '2026-09-10T02:00:00.000Z' },
      { stage: 'exposed', actionId: 'a1', at: '2026-09-10T02:00:01.000Z' },
      { stage: 'exposed', actionId: 'a1', at: '2026-09-10T02:00:02.000Z' },
    ],
  });
  assert.equal(funnel.summary.exposed, 1);
});

test('observations for unknown recommendations are ignored, never attributed', () => {
  const funnel = buildRecommendationFunnel({
    recommendations: [fact({ actionId: 'a1' })],
    observations: [{ stage: 'exposed', actionId: 'ghost', at: '2026-09-10T02:00:00.000Z' }],
  });
  assert.equal(funnel.summary.exposed, 0);
  assert.equal(funnel.rows[0].stages.exposed, false);
});

test('an empty recommendation set yields an honest empty funnel', () => {
  const funnel = buildRecommendationFunnel({ recommendations: [], observations: [] });
  assert.equal(funnel.rows.length, 0);
  assert.equal(funnel.summary.generated, 0);
  assert.equal(funnel.summary.exposed, null);
  assert.equal(funnel.summary.exposureTelemetryAvailable, false);
});

test('every row explains itself in plain language', () => {
  const funnel = buildRecommendationFunnel({
    recommendations: [fact()],
    observations: [{ stage: 'exposed', actionId: 'a1', at: '2026-09-10T02:00:00.000Z' }],
  });
  assert.ok(funnel.rows[0].basis.length > 0);
  assert.match(funnel.rows[0].basis, /曝光|看到|推荐/);
});
