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
  assert.match(block, /saveOnboarding\(userId, profile, freshPlan\)/);
  assert.match(block, /sevenDayPlansByUser\.set\(userId, scheduledPlan\)/);
});
