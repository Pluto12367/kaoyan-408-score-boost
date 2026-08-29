import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadSnapshotModule() {
  const source = await readFile(new URL('../apps/api/src/study/today-plan.snapshot.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    fileName: 'today-plan.snapshot.ts',
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

const asOf = '2026-08-24T08:00:00.000Z';

function makeInput() {
  return {
    userId: 'u-1',
    asOf,
    planFacts: {
      planId: 'plan-1',
      phase: '强化',
      status: 'ACTIVE',
      windowStart: '2026-08-18',
      windowEnd: '2026-08-24',
      generatedAt: '2026-08-24T00:00:00.000Z',
      checkpointState: 'normal',
    },
    taskFacts: {
      todayTasks: [
        {
          id: 'task-1',
          knowledgePointId: 'kp-os',
          questionIds: ['q-1', 'q-2'],
          title: '页表专项',
          subject: '操作系统',
          chapter: '内存管理',
          minutes: 30,
          questionCount: 10,
          mode: '专项训练',
          priority: '高',
          scheduledDate: '2026-08-24',
          status: 'pending',
          completed: false,
          completedAt: null,
          startedAt: null,
          postponeCount: 0,
          nextAvailableAt: null,
          progress: { completedQuestionCount: 2, correctCount: 1, minutesSpent: 6, reachedTarget: false },
        },
      ],
      counts: { pending: 1, inProgress: 0, postponed: 0, completed: 0 },
      weekDays: [
        { date: '2026-08-24', taskCount: 2, completedTasks: 0, totalMinutes: 45, focusKnowledgePointId: 'kp-os', focusCompleted: false },
      ],
    },
    reviewFacts: {
      dueCount: 1,
      overdueCount: 0,
      nextReviewAt: '2026-08-24T07:00:00.000Z',
      items: [{ questionId: 'q-1', nextReviewAt: '2026-08-24T07:00:00.000Z', reviewCount: 1, stability: 'learning', overdue: false }],
    },
    activityFacts: {
      streakDays: 3,
      isActiveToday: true,
      latestActivityAt: '2026-08-23T10:00:00.000Z',
    },
    masteryFacts: {
      source: 'user_knowledge_mastery',
      averageMastery: 62,
      weakCount: 2,
      reviewCount: 3,
      masteredCount: 5,
      lastUpdatedAt: '2026-08-23T12:00:00.000Z',
      weakPoints: [
        { knowledgeNodeId: 'kp-os', subject: '操作系统', chapter: '内存管理', title: '页表', masteryRate: 35, accuracyRate: 40, attempts: 10, wrongCount: 6 },
      ],
    },
    scoreFacts: {
      available: false,
      generatedAt: null,
      raw: null,
    },
  };
}

test('today plan snapshot can be constructed with six fact groups', async () => {
  const mod = await loadSnapshotModule();
  assert.equal(typeof mod.buildTodayPlanSnapshot, 'function', 'buildTodayPlanSnapshot must be exported');
  const snapshot = mod.buildTodayPlanSnapshot(makeInput());
  assert.equal(snapshot.userId, 'u-1');
  assert.equal(snapshot.asOf, asOf);
  assert.ok(snapshot.planFacts, 'planFacts required');
  assert.ok(snapshot.taskFacts, 'taskFacts required');
  assert.ok(snapshot.reviewFacts, 'reviewFacts required');
  assert.ok(snapshot.activityFacts, 'activityFacts required');
  assert.ok(snapshot.masteryFacts, 'masteryFacts required');
  assert.ok('scoreFacts' in snapshot, 'scoreFacts required');
  assert.equal(snapshot.source, 'today_plan_student_state_score_center');
});

test('today plan snapshot contract excludes UI and strategy fields', async () => {
  const mod = await loadSnapshotModule();
  const snapshot = mod.buildTodayPlanSnapshot(makeInput());
  const json = JSON.stringify(snapshot);
  const forbidden = ['nextAction', 'recommendation', 'priorityTasks', 'checkpointMessage', 'recommendationStrategy', 'uiConfig', 'actionText', 'actionAnchor'];
  for (const key of forbidden) {
    assert.equal(json.includes(`"${key}"`), false, `${key} must stay out of TodayPlanSnapshot`);
  }
  // also ensure snapshot does not accidentally expose DTO sorting field as top-level UI
  assert.equal('priorityTasks' in snapshot, false);
  assert.equal('checkpointMessage' in snapshot, false);
});

test('snapshot facts keep raw values without UI copy', async () => {
  const mod = await loadSnapshotModule();
  const snapshot = mod.buildTodayPlanSnapshot(makeInput());
  // planFacts should keep phase as fact, not recommendation
  assert.equal(snapshot.planFacts.phase, '强化');
  // taskFacts tasks must not contain nextAction
  const taskJson = JSON.stringify(snapshot.taskFacts.todayTasks[0]);
  assert.equal(taskJson.includes('nextAction'), false);
  assert.equal(taskJson.includes('reason'), false);
});
