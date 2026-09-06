import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('today plan rolls over an expired or empty seven-day plan so week progress stays current', () => {
  const source = readFileSync('apps/api/src/study/study.service.ts', 'utf8');
  const block = source.slice(source.indexOf('async getTodayPlan'), source.indexOf('async getTodayPlan') + 1800);
  assert.match(block, /lastScheduledDate/);
  assert.match(block, /hasCurrentWindow/);
  assert.match(block, /!hasCurrentWindow/);
  assert.match(block, /sevenDayPlansByUser\.delete\(userId\)/);
  assert.match(block, /buildSevenDayPlan\(userId\)/);
  // V8 #13: the rebuilt plan is augmented with carried-over open tasks
  assert.match(block, /harvestCarryOverTasks\(scheduledPlan\.tasks, today\)/);
  assert.match(block, /applyCarryOver\(freshPlan, carryOver, today\)/);
  assert.match(block, /saveOnboarding\(userId, profile, augmented\)/);
  assert.match(block, /sevenDayPlansByUser\.set\(userId, scheduledPlan\)/);
});
