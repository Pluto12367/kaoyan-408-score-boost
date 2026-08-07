import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('frontend tracking: trackEvent posts best-effort to /events', async () => {
  const events = await source('apps/web/src/api/events.ts');
  assert.match(events, /export async function trackEvent\(type: string, payload\?: Record<string, unknown>\)/, 'trackEvent should be exported');
  assert.match(events, /\/events/, 'trackEvent should target the events endpoint');
  assert.match(events, /catch \{/, 'tracking failures must be silent');
  assert.match(events, /best-effort/, 'module should document best-effort semantics');
});

test('frontend tracking: App fires representative student actions', async () => {
  const app = await source('apps/web/src/App.tsx');
  assert.match(app, /import \{ trackEvent \} from '\.\/api\/events';/, 'App should import trackEvent');
  assert.match(app, /void trackEvent\('nav\.continue_today'\)/, 'continue-today should be tracked');
  assert.match(app, /void trackEvent\('practice\.set_start'\)/, 'practice-set start should be tracked');
  assert.match(app, /void trackEvent\('practice\.learning_mode_start'\)/, 'learning mode should be tracked');
  assert.match(app, /void trackEvent\('wrong\.open_review', \{ questionId \}\)/, 'wrong-question review should be tracked');
  assert.match(app, /void trackEvent\('tutor\.ask'\)/, 'AI tutor ask should be tracked');
  assert.match(app, /void trackEvent\('assessment\.generate'\)/, 'assessment generation should be tracked');
});

test('frontend tracking: TodayPlan fires task lifecycle events', async () => {
  const todayPlan = await source('apps/web/src/components/TodayPlan.tsx');
  assert.match(todayPlan, /import \{ trackEvent \} from '\.\.\/api\/events';/, 'TodayPlan should import trackEvent');
  assert.match(todayPlan, /void trackEvent\('task\.manual_complete', \{ taskId \}\)/, 'manual completion should be tracked');
  assert.match(todayPlan, /void trackEvent\('task\.start', \{ taskId \}\)/, 'task start should be tracked');
  assert.match(todayPlan, /void trackEvent\('task\.postpone', \{ taskId \}\)/, 'task postpone should be tracked');
  assert.match(todayPlan, /void trackEvent\('task\.reschedule', \{ taskId, scheduledDate \}\)/, 'task reschedule should be tracked');
  assert.match(todayPlan, /void trackEvent\('task\.rebalance', \{ mode \}\)/, 'task rebalance should be tracked');
});
