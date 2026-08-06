import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { accumulateTaskProgress } from '../packages/shared/dist/learning.js';

test('accumulateTaskProgress adds one attempt and tracks correctness and minutes', () => {
  const first = accumulateTaskProgress({
    current: { completedQuestionCount: 0, correctCount: 0, minutesSpent: 0 },
    correct: true,
    timeSpentSec: 90,
    questionTarget: 12,
  });
  assert.deepEqual(first.progress, { completedQuestionCount: 1, correctCount: 1, minutesSpent: 2 });
  assert.equal(first.reachedTarget, false);

  const second = accumulateTaskProgress({
    current: first.progress,
    correct: false,
    timeSpentSec: 30,
    questionTarget: 12,
  });
  assert.deepEqual(second.progress, { completedQuestionCount: 2, correctCount: 1, minutesSpent: 3 });
  assert.equal(second.reachedTarget, false);
});

test('accumulateTaskProgress flags reachedTarget when the planned question count is met', () => {
  const result = accumulateTaskProgress({
    current: { completedQuestionCount: 14, correctCount: 11, minutesSpent: 45 },
    correct: true,
    timeSpentSec: 60,
    questionTarget: 15,
  });
  assert.equal(result.progress.completedQuestionCount, 15);
  assert.equal(result.progress.correctCount, 12);
  assert.equal(result.reachedTarget, true);
});

test('study service wires practice records into today task progress and auto-completes at target', async () => {
  const source = await readFile(new URL('../apps/api/src/study/study.service.ts', import.meta.url), 'utf8');
  assert.match(source, /accumulateTaskProgress,/, 'service should import the shared accumulator');
  assert.match(source, /private async applyPracticeProgressToTasks\(userId: string, record: PracticeRecord\)/, 'service should expose the progress hook');
  assert.match(source, /await this\.applyPracticeProgressToTasks\(input\.userId, savedRecord\);/, 'single-question submits should accumulate progress');
  assert.match(source, /for \(const record of records\) \{\s*await this\.applyPracticeProgressToTasks\(userId, record\);/, 'session submits should accumulate progress per record');
  assert.match(source, /progress: this\.getTaskProgressView\(userId, task\)/, 'today plan should expose per-task progress');
  assert.match(source, /await this\.completeStudyTask\(task\.id, \{/, 'reaching the target should auto-complete the task');
});

test('today plan UI shows live practice progress and App refreshes the plan after practice', async () => {
  const todayPlanSource = await readFile(new URL('../apps/web/src/components/TodayPlan.tsx', import.meta.url), 'utf8');
  assert.match(todayPlanSource, /task\.progress/, 'task card should read progress');
  assert.match(todayPlanSource, /已答 \{task\.progress\.completedQuestionCount\}\/\{task\.questionCount\} 题/, 'task card should show answered/target');
  assert.match(todayPlanSource, /练习记录已自动累计/, 'manual completion form should be framed as a supplement');

  const typeSource = await readFile(new URL('../apps/web/src/api/endpoints/onboarding.ts', import.meta.url), 'utf8');
  assert.match(typeSource, /progress\?: \{/, 'TodayPlan type should carry progress');

  const appSource = await readFile(new URL('../apps/web/src/App.tsx', import.meta.url), 'utf8');
  assert.match(appSource, /refreshTodayPlan\(\),\s*refreshStudyReminders\(\)/, 'single-question submit should refresh the today plan');
  assert.match(appSource, /refreshOverview\(\),\s*refreshTodayPlan\(\)/, 'session submit should refresh the today plan');
});
