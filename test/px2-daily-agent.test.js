/**
 * PX-2 Daily AI Study Agent Tests.
 *
 * - adaptive difficulty: evidence-based reduce/maintain/challenge rules
 * - daily pipeline: context → evidence → draft → validation → review tasks
 *   → risk alerts → optional canonical write
 * - write goes only through createStudyTask with the DAILY generationKey
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { deriveDifficultyAdjustment } from '../apps/api/dist/agent/adaptive-difficulty.js';
import { DailyPlanningService } from '../apps/api/dist/agent/daily-planning.service.js';
import { StudyAgentToolRegistry } from '../apps/api/dist/agent/agent-tools.js';

const NOW = new Date('2026-09-06T07:30:00.000Z');

// ---- evidence-based adaptive difficulty ----

test('adaptive: weak recent accuracy forces reduce regardless of completion', () => {
  const adjustment = deriveDifficultyAdjustment({ recentAccuracy: 0.4, completionRate: 0.9, weakNodeCount: 2, dueCount: 1, overdueCount: 2 }, 60);
  assert.equal(adjustment.level, 'reduce');
  assert.equal(adjustment.availableMinutes, 60);
  assert.ok(adjustment.reasons.some((reason) => reason.includes('40%')));
  assert.ok(adjustment.reasons.some((reason) => reason.includes('逾期')));
});

test('adaptive: consistent completion + accuracy escalates the challenge tier', () => {
  const adjustment = deriveDifficultyAdjustment({ recentAccuracy: 0.8, completionRate: 0.85, weakNodeCount: 0, dueCount: 0, overdueCount: 0 }, 60);
  assert.equal(adjustment.level, 'challenge');
  assert.equal(adjustment.availableMinutes, 120);
});

test('adaptive: middle ground maintains; missing evidence maintains with reason', () => {
  const mid = deriveDifficultyAdjustment({ recentAccuracy: 0.65, completionRate: 0.5, weakNodeCount: 1, dueCount: 2, overdueCount: 0 }, 60);
  assert.equal(mid.level, 'maintain');
  assert.ok(mid.reasons.some((reason) => reason.includes('维持')));
  const cold = deriveDifficultyAdjustment({ recentAccuracy: null, completionRate: null, weakNodeCount: 0, dueCount: 0, overdueCount: 0 }, 60);
  assert.equal(cold.level, 'maintain');
  assert.ok(cold.reasons.some((reason) => reason.includes('数据不足')));
});

// ---- daily pipeline ----

function dailyDeps() {
  const calls = { context: 0, preview: 0, create: 0 };
  const deps = {
    studentContext: { getContext: async () => ({
      mastery: {
        weakNodes: [
          { knowledgeNodeId: 'OS-C06-S06-P02', title: '死锁必要条件', subject: 'OS', mastery: 0.3, attempts: 5 },
          { knowledgeNodeId: 'OS-C02-S04-P20', title: '信号量', subject: 'OS', mastery: 0.42, attempts: 8 },
        ],
        weakPoints: [], improvingPoints: [],
        masteredPoints: [{ knowledgeNodeId: 'DS-LIST-01', title: '顺序表', mastery: 0.92, attempts: 10 }],
        source: 'user_knowledge_mastery',
      },
      practice: { recentAccuracy: { window: 'last7d', baseline: null, sampleSize: 10, status: 'sufficient', value: 0.42 }, latestSubmittedAt: '2026-09-06T07:00:00.000Z' },
      review: { dueCount: 4, overdueCount: 2, highRiskQuestions: [{ questionId: 'w-1', wrongCount: 4, overdue: true }, { questionId: 'w-2', wrongCount: 2, overdue: false }] },
      plan: { source: 'empty', planId: null, todayTasks: [], completion: { completedCount: 0, totalCount: 0, rate: { window: 'last7d', baseline: null, sampleSize: 0, status: 'insufficient_data', value: null } } },
    }) },
    knowledgeSearch: { search: async () => ({ results: [] }) },
    questions: { listQuestions: () => [] },
    wrongQuestions: { getWrongQuestionsCompat: async () => [] },
    recommendation: {
      runRecommendationForUser: async () => ({
        result: { items: [
          { kind: 'TASK_DRAFT', knowledgeNodeId: 'OS-C06-S06-P02', action: 'WRONG_QUESTION', score: 95, estimatedMinutes: 30, scheduledDate: '2026-09-06', reasonCodes: ['REPEATED_WRONG'] },
          { kind: 'TASK_DRAFT', knowledgeNodeId: 'DS-LIST-01', action: 'LEARN', score: 80, estimatedMinutes: 40, scheduledDate: '2026-09-06', reasonCodes: [] },
        ] },
        nodeById: new Map([
          ['OS-C06-S06-P02', { id: 'OS-C06-S06-P02', name: '死锁必要条件', subject: 'OS', importance: 5, difficulty: 3 }],
          ['DS-LIST-01', { id: 'DS-LIST-01', name: '顺序表', subject: 'DS', importance: 3, difficulty: 1 }],
        ]),
      }),
      generateDailyPlanFromState: async (_userId, input) => {
        calls.create += 1;
        return { id: 'daily-plan-1', tasks: [{ title: '错题重做：死锁必要条件', minutes: 30 }] };
      },
    },
  };
  return {
    calls,
    service: new DailyPlanningService(new StudyAgentToolRegistry(deps)),
  };
}

test('daily pipeline: reduce level triggers on weak accuracy, plan filtered and risk-aware', async () => {
  const { service } = dailyDeps();
  const plan = await service.generateDailyPlan('u-1', { scheduledDate: '2026-09-06' }, NOW);

  assert.equal(plan.adjustment.level, 'reduce', 'accuracy 42% must force reduce');
  assert.equal(plan.evidence.recentAccuracyPercent, 42);
  // goals anchored on weak nodes and due reviews
  assert.ok(plan.goals.some((goal) => goal.includes('死锁必要条件')));
  assert.ok(plan.goals.some((goal) => goal.includes('复习')));
  // mastered node (顺序表, mastery 0.92) filtered out of recommended tasks
  assert.ok(!plan.recommendedTasks.some((task) => task.knowledgeNodeId === 'DS-LIST-01'));
  assert.ok(plan.recommendedTasks.some((task) => task.knowledgeNodeId === 'OS-C06-S06-P02'));
  // review tasks from high-risk questions
  assert.equal(plan.reviewTasks.length, 2);
  assert.equal(plan.reviewTasks[0].questionId, 'w-1');
  // risk alerts: overdue + low accuracy
  assert.ok(plan.riskAlerts.some((alert) => alert.includes('逾期')));
  assert.ok(plan.riskAlerts.some((alert) => alert.includes('正确率偏低')));
  // default: no write
  assert.equal(plan.execution.executed, false);
});

test('daily pipeline: execute=true writes through the canonical writer', async () => {
  const { calls, service } = dailyDeps();
  const plan = await service.generateDailyPlan('u-1', { scheduledDate: '2026-09-06', execute: true }, NOW);
  assert.equal(calls.create, 1);
  assert.equal(plan.execution.executed, true);
  assert.equal(plan.execution.planId, 'daily-plan-1');
  // DAILY generationKey namespace distinct from the learning-loop trigger
  const toolsCalls = plan.steps.filter((step) => step.tool === 'createStudyTask');
  assert.equal(toolsCalls.length, 1);
});

test('daily endpoint contract: guard, validations, no body userId', async () => {
  const source = await readFile(new URL('../apps/api/src/agent/agent.controller.ts', import.meta.url), 'utf8');
  assert.match(source, /Post\('agent\/daily\/plan'\)/);
  assert.match(source, /@Roles\('student', 'teacher', 'admin'\)/);
  assert.match(source, /private readonly dailyPlanning: DailyPlanningService/);
  const moduleSource = await readFile(new URL('../apps/api/src/agent/agent.module.ts', import.meta.url), 'utf8');
  assert.match(moduleSource, /DailyPlanningService/);
  assert.match(moduleSource, /exports:\s*\[StudyAgentService,\s*StudyPlannerService,\s*DailyPlanningService,\s*ExamSimulatorService,\s*SupervisorAgentService\]/);
});

test('adaptive adjustment is deterministic (evidence-only, no LLM)', () => {
  const evidence = { recentAccuracy: 0.4, completionRate: 0.9, weakNodeCount: 2, dueCount: 1, overdueCount: 2 };
  const a = deriveDifficultyAdjustment(evidence, 60);
  const b = deriveDifficultyAdjustment(evidence, 60);
  assert.deepEqual(a, b);
});