import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('today plan reviewDue reflects due review schedules, matching the review/due widget', () => {
  const source = readFileSync('apps/api/src/study/study.service.ts', 'utf8');
  const occurrences = source.match(/reviewDue: this\.getDueReviews\(userId\)\.dueCount/g) ?? [];
  assert.ok(occurrences.length >= 2, 'both getTodayPlan paths should derive reviewDue from due reviews');
  assert.doesNotMatch(source, /reviewDue: wrongQuestions\.filter\(\(q\) => q\.reviewStatus === 'pending'\)\.length/);
});
