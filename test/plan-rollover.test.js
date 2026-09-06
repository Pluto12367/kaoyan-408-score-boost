import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('today plan rolls over an expired or empty seven-day plan so week progress stays current', () => {
  const source = readFileSync('apps/api/src/study/study.service.ts', 'utf8');
  // Anchor from the method start to the response tail — no fixed byte window.
  const start = source.indexOf('async getTodayPlan');
  const end = source.indexOf('weeklyAdjustment: scheduledPlan', start);
  assert.ok(end > start, 'getTodayPlan must expose the weekly adjustment');
  const block = source.slice(start, end + 120);
  assert.match(block, /lastScheduledDate/);
  assert.match(block, /hasCurrentWindow/);
  assert.match(block, /!hasCurrentWindow/);
  assert.match(block, /sevenDayPlansByUser\.delete\(userId\)/);
  assert.match(block, /buildSevenDayPlan\(userId\)/);
  // V8 #13: the rebuilt plan is augmented with carried-over open tasks
  assert.match(block, /harvestCarryOverTasks\(scheduledPlan\.tasks, today\)/);
  assert.match(block, /applyCarryOver\(applyWeeklyIntensity\(freshPlan, weeklyAdjustment \?\? \{ factor: 1, verdict: 'maintain' \}\), carryOver, today\)/);
  assert.match(block, /weeklyAdjustment: scheduledPlan\.weeklyAdjustment \?\? null/);
  assert.match(block, /saveOnboarding\(userId, profile, augmented\)/);
  assert.match(block, /sevenDayPlansByUser\.set\(userId, scheduledPlan\)/);
});
