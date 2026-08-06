import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rebalanceTaskLoad } from '../packages/shared/dist/learning.js';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('stage 2: rebalanceTaskLoad reduce mode cuts load by ~30% with floors', () => {
  const adjustments = rebalanceTaskLoad({
    mode: 'reduce',
    tasks: [
      { id: 't-1', priority: '高', status: 'pending', questionCount: 15, minutes: 90 },
      { id: 't-2', priority: '中', status: 'in_progress', questionCount: 3, minutes: 15 },
      { id: 't-3', priority: '低', status: 'completed', questionCount: 20, minutes: 120 },
    ],
  });

  assert.equal(adjustments[0].questionCount, 11);
  assert.equal(adjustments[0].minutes, 63);
  assert.equal(adjustments[1].questionCount, 5, 'question count should keep a floor');
  assert.equal(adjustments[1].minutes, 20, 'minutes should keep a floor');
  assert.deepEqual(adjustments[2], { id: 't-3' }, 'completed tasks must not be adjusted');
});

test('stage 2: rebalanceTaskLoad priority_only postpones non-high tasks only', () => {
  const adjustments = rebalanceTaskLoad({
    mode: 'priority_only',
    tasks: [
      { id: 't-1', priority: '高', status: 'pending', questionCount: 15, minutes: 90 },
      { id: 't-2', priority: '中', status: 'pending', questionCount: 12, minutes: 60 },
      { id: 't-3', priority: '低', status: 'completed', questionCount: 20, minutes: 120 },
    ],
  });

  assert.deepEqual(adjustments[0], { id: 't-1' });
  assert.deepEqual(adjustments[1], { id: 't-2', status: 'postponed' });
  assert.deepEqual(adjustments[2], { id: 't-3' });
});

test('stage 2: backend exposes reschedule, rebalance and history-import endpoints', async () => {
  const controller = await source('apps/api/src/study/study.controller.ts');
  assert.match(controller, /@Post\('tasks\/:taskId\/reschedule'\)/, 'reschedule route should exist');
  assert.match(controller, /@Post\('tasks\/rebalance'\)/, 'rebalance route should exist');
  assert.match(controller, /@Post\('assessment-history\/import'\)/, 'history import route should exist');

  const service = await source('apps/api/src/study/study.service.ts');
  assert.match(service, /async rescheduleTask\(userId: string, taskId: string, scheduledDate: string\)/, 'service should expose rescheduleTask');
  assert.match(service, /async rebalanceTasks\(userId: string, mode: TaskRebalanceMode\)/, 'service should expose rebalanceTasks');
  assert.match(service, /async importAssessmentHistory\(/, 'service should expose importAssessmentHistory');

  const repository = await source('apps/api/src/study/onboarding-plan.repository.ts');
  assert.match(repository, /async rescheduleTask\(userId: string, taskId: string, scheduledDate: string\)/, 'repository should persist reschedule');
  assert.match(repository, /async rebalanceTasks\(userId: string, adjustments: TaskRebalanceAdjustment\[\]\)/, 'repository should persist rebalance');
});

test('stage 2: TodayPlan offers 重新安排 / 降低本周任务量 / 只保留高优先级', async () => {
  const onboarding = await source('apps/web/src/api/endpoints/onboarding.ts');
  assert.match(onboarding, /export async function rescheduleTask\(taskId: string, scheduledDate: string\)/, 'client should expose rescheduleTask');
  assert.match(onboarding, /export async function rebalanceTasks\(mode: 'reduce' \| 'priority_only'\)/, 'client should expose rebalanceTasks');

  const todayPlan = await source('apps/web/src/components/TodayPlan.tsx');
  assert.match(todayPlan, /重新安排/, 'task card should offer reschedule');
  assert.match(todayPlan, /降低本周任务量/, 'task card should offer load reduction');
  assert.match(todayPlan, /只保留高优先级/, 'task card should offer priority-only mode');
  assert.match(todayPlan, /await rescheduleTask\(taskId, scheduledDate\)/, 'reschedule action should call the endpoint');
  assert.match(todayPlan, /await rebalanceTasks\(mode\)/, 'rebalance action should call the endpoint');
});

test('stage 2: DiagnosticSummary offers history-score import wired to the API', async () => {
  const dashboard = await source('apps/web/src/api/endpoints/dashboard.ts');
  assert.match(dashboard, /export async function importAssessmentHistory\(/, 'client should expose importAssessmentHistory');

  const diagnostic = await source('apps/web/src/features/diagnostic/DiagnosticSummary.tsx');
  assert.match(diagnostic, /历史成绩导入（可选）/, 'diagnostic panel should offer history import');
  assert.match(diagnostic, /await importAssessmentHistory\(\{ title, score, totalScore \}\)/, 'import should call the endpoint');
  assert.match(diagnostic, /评估历史已更新/, 'success copy should reference the assessment history');
});
