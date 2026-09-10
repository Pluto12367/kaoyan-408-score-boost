/**
 * V12-M2a — Recommendation exposure wiring & honesty proof (EB-3).
 *
 * The funnel is only meaningful if exposure telemetry actually flows from the
 * surfaces that render recommendations. These tests pin the wiring, the
 * transport permission, the anti-fabrication rules, and the read-only nature of
 * the funnel service.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

const {
  TELEMETRY_EVENT_TYPES,
  RESERVED_CANONICAL_EVENT_TYPES,
} = require('../apps/api/src/study/canonical-event-writer.service.ts');

const read = (path) => readFileSync(`${root}${path}`, 'utf8');

// ---------------------------------------------------------------------------
// Transport permission
// ---------------------------------------------------------------------------

test('exposure telemetry is client-reportable and never a forgeable canonical event', () => {
  assert.ok(
    TELEMETRY_EVENT_TYPES.includes('recommendation.exposed'),
    'the client must be allowed to report that a recommendation was rendered',
  );
  assert.ok(TELEMETRY_EVENT_TYPES.includes('recommendation.viewed'));
  assert.ok(
    !RESERVED_CANONICAL_EVENT_TYPES.includes('recommendation.exposed'),
    'exposure is not a server-only event; it is a client observation',
  );
});

test('the pre-existing recommendation lifecycle types stay server-only', () => {
  for (const type of ['recommendation.created', 'recommendation.accepted', 'recommendation.completed']) {
    assert.ok(RESERVED_CANONICAL_EVENT_TYPES.includes(type));
    assert.ok(!TELEMETRY_EVENT_TYPES.includes(type));
  }
});

// ---------------------------------------------------------------------------
// Anti-fabrication rules in the client reporter
// ---------------------------------------------------------------------------

test('the reporter never emits exposure in static-demo mode', () => {
  const source = read('apps/web/src/features/recommendation/recommendationExposure.ts');
  assert.ok(source.includes('isStaticDemoMode'), 'a demo has no student to observe');
  assert.match(source, /if \(isStaticDemoMode\(\)\) return;/);
});

test('the reporter de-duplicates per day/surface/item', () => {
  const source = read('apps/web/src/features/recommendation/recommendationExposure.ts');
  assert.ok(source.includes('reported.has(key)'), 'repeat renders must not flood the telemetry endpoint');
  assert.ok(source.includes('dayKey()'));
});

test('the reporter drops targets with no identity instead of attributing them', () => {
  const source = read('apps/web/src/features/recommendation/recommendationExposure.ts');
  assert.ok(source.includes('if (!id) return;'));
});

// ---------------------------------------------------------------------------
// Wiring: the surfaces that actually render recommendations
// ---------------------------------------------------------------------------

test('the today-mission surface reports exposure for the tasks it rendered', () => {
  const source = read('apps/web/src/features/student/home/components/TodayMission.tsx');
  assert.ok(source.includes('reportRecommendationExposed'), 'TodayMission renders engine recommendations');
  assert.match(source, /reportRecommendationExposed\('today_mission'/);
  assert.ok(
    source.includes('model.tasks.length === 0 || loading || error'),
    'must not report exposure while loading or errored',
  );
});

test('the score-center surface reports exposure and reports viewed only on explanation open', () => {
  const source = read('apps/web/src/features/today-score-center/TodaysScoreCenter.tsx');
  assert.match(source, /reportRecommendationExposed\('score_center'/);
  assert.match(source, /reportRecommendationViewed\('score_center'/);
  const viewedAt = source.indexOf("reportRecommendationViewed('score_center'");
  const setItemAt = source.indexOf('setExplainItem(item)', viewedAt);
  assert.ok(viewedAt > 0 && setItemAt > viewedAt, 'viewed must be tied to opening the explanation');
});

// ---------------------------------------------------------------------------
// Service boundaries
// ---------------------------------------------------------------------------

test('the exposure service is read-only and touches no learning write table', () => {
  const source = read('apps/api/src/study/recommendation-exposure.service.ts');
  for (const primitive of [
    '.create(',
    '.update(',
    '.updateMany(',
    '.upsert(',
    '.delete(',
    'userKnowledgeMastery',
    'practiceRecord',
  ]) {
    assert.ok(
      !source.includes(primitive),
      `the funnel is a read model and must not contain ${primitive}`,
    );
  }
});

test('the funnel endpoint is self-only and honestly absent when the store is down', () => {
  const source = read('apps/api/src/study/daily-brief.controller.ts');
  assert.ok(source.includes("@Get('coach/recommendation-funnel')"));
  const start = source.indexOf("@Get('coach/recommendation-funnel')");
  const body = source.slice(start, source.indexOf("/** V11-M4.2", start));
  assert.ok(!body.includes("@Query('userId')"), 'recommendation history is personal data');
  assert.ok(body.includes('store_unavailable'), 'must admit absence rather than return an empty funnel');
});

test('the funnel denominator comes from real recommendation rows, not from plans', () => {
  const repository = read('apps/api/src/study/recommendation-action.repository.ts');
  assert.ok(
    repository.includes('listRecentByUser'),
    'the funnel must count actual RecommendationAction rows',
  );
});
