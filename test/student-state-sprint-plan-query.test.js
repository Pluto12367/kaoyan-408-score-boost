import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

test('StudentStateSprintPlanQueryService builds sprint plan from snapshot plus read-only supplemental facts', async () => {
  const { StudentStateSprintPlanQueryService } = require('../apps/api/src/study/student-state-sprint-plan-query.service.ts');
  const snapshotCalls = [];
  const readCalls = [];
  const writeCalls = [];
  const service = new StudentStateSprintPlanQueryService(
    {
      async getSnapshot(userId, asOf) {
        snapshotCalls.push({ userId, asOf: asOf.toISOString() });
        return sprintSnapshot();
      },
    },
    createReadOnlyPrisma(readCalls, writeCalls),
  );

  const result = await withDatabaseUrl(() =>
    service.getSprintPlanCompat('u-1', new Date('2026-08-24T08:30:00.000Z')),
  );

  assert.deepEqual(snapshotCalls, [
    { userId: 'u-1', asOf: '2026-08-24T08:30:00.000Z' },
  ]);
  assert.deepEqual(writeCalls, []);
  assert.deepEqual(readCalls.map((call) => call.name).sort(), [
    'practiceRecord.findMany',
    'studyPlan.findFirst',
    'systemConfig.findFirst',
  ]);
  assert.equal(result.userId, 'u-1');
  assert.equal(result.title, '7 天冲刺计划');
  assert.equal(result.generatedAt, '2026-08-24T08:30:00.000Z');
  assert.equal(result.currentStage, '强化');
  assert.equal(result.scoreGap, 28);
  assert.equal(result.weeklyQuestionTarget, 246);
  assert.equal(result.weeklyReviewTarget, 25);
  assert.deepEqual(result.risks, [
    '错题本仍有 2 道待处理，建议每天至少复盘 3 道。',
    '当前正确率 33%，本周先稳住基础题正确率。',
  ]);
  assert.deepEqual(result.days.map((day) => day.date), [
    '2026-08-24',
    '2026-08-25',
    '2026-08-26',
    '2026-08-27',
    '2026-08-28',
    '2026-08-29',
    '2026-08-30',
  ]);
  assert.deepEqual(result.days.map((day) => day.focus), [
    '图的遍历专项',
    '排序算法查漏',
    '图的遍历专项',
    '排序算法查漏',
    '图的遍历专项',
    '排序算法查漏',
    '阶段小测与错题回看',
  ]);
});

test('StudentStateSprintPlanQueryService uses no-database defaults without touching prisma reads', async () => {
  const { StudentStateSprintPlanQueryService } = require('../apps/api/src/study/student-state-sprint-plan-query.service.ts');
  const readCalls = [];
  const writeCalls = [];
  const service = new StudentStateSprintPlanQueryService(
    { async getSnapshot(userId) { return sprintSnapshot({ userId, weakPoints: [] }); } },
    createReadOnlyPrisma(readCalls, writeCalls),
  );

  const result = await withoutDatabaseUrl(() =>
    service.getSprintPlanCompat('u-demo', '2026-08-24T09:00:00.000Z'),
  );

  assert.deepEqual(readCalls, []);
  assert.deepEqual(writeCalls, []);
  assert.equal(result.userId, 'u-demo');
  assert.equal(result.weeklyQuestionTarget, 204);
  assert.equal(result.weeklyReviewTarget, 25);
  assert.deepEqual(result.days.map((day) => day.focus), [
    '408 高频基础考点',
    '408 高频基础考点',
    '408 高频基础考点',
    '408 高频基础考点',
    '408 高频基础考点',
    '408 高频基础考点',
    '阶段小测与错题回看',
  ]);
});

function createReadOnlyPrisma(readCalls, writeCalls, options = {}) {
  const write = (name) => async () => {
    writeCalls.push(name);
    throw new Error(`${name} must not be called`);
  };
  const read = (name, result) => async (query) => {
    readCalls.push({ name, query });
    return result;
  };
  return {
    studyPlan: {
      findFirst: read('studyPlan.findFirst', options.activePlan ?? {
        tasks: [
          {
            id: 'task-graph',
            title: '图的遍历专项',
            scheduledDate: '2026-08-24',
            status: 'pending',
          },
          {
            id: 'task-sort',
            title: '排序算法查漏',
            scheduledDate: '2026-08-25',
            status: 'pending',
          },
        ],
      }),
      create: write('studyPlan.create'),
      update: write('studyPlan.update'),
      upsert: write('studyPlan.upsert'),
      delete: write('studyPlan.delete'),
    },
    systemConfig: {
      findFirst: read('systemConfig.findFirst', options.systemConfig ?? {
        recommendation: {
          dailyTargetQuestionCount: 36,
          stageAssessmentQuestionLimit: 12,
          speedRiskMultiplier: 1.4,
        },
      }),
      create: write('systemConfig.create'),
      update: write('systemConfig.update'),
      upsert: write('systemConfig.upsert'),
      delete: write('systemConfig.delete'),
    },
    practiceRecord: {
      findMany: read('practiceRecord.findMany', options.practiceRecords ?? [
        { correct: false, submittedAt: new Date('2026-08-24T02:00:00.000Z') },
        { correct: false, submittedAt: new Date('2026-08-23T02:00:00.000Z') },
        { correct: true, submittedAt: new Date('2026-08-22T02:00:00.000Z') },
      ]),
      create: write('practiceRecord.create'),
      update: write('practiceRecord.update'),
      upsert: write('practiceRecord.upsert'),
      delete: write('practiceRecord.delete'),
    },
    $transaction: write('$transaction'),
  };
}

async function withDatabaseUrl(run) {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://unit-test/student-state-sprint-plan-query';
  try {
    return await run();
  } finally {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
}

async function withoutDatabaseUrl(run) {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    return await run();
  } finally {
    if (originalDatabaseUrl !== undefined) process.env.DATABASE_URL = originalDatabaseUrl;
  }
}

function sprintSnapshot(overrides = {}) {
  return {
    userId: 'u-1',
    asOf: '2026-08-24T08:30:00.000Z',
    goal: {
      targetSchool: '北京邮电大学',
      targetScore: 110,
      currentScore: 82,
      dailyHours: 3,
      remainingDays: 70,
      stage: '强化',
      weakestSubject: '数据结构',
      diagnosis: '图与排序薄弱',
      examYear: 2027,
      onboardingCompletedAt: '2026-08-20T00:00:00.000Z',
    },
    mastery: {
      source: 'user_knowledge_mastery',
      nodeCount: 2,
      practicedNodeCount: 2,
      averageMastery: 60,
      weakCount: 0,
      reviewCount: 0,
      masteredCount: 1,
      lastUpdatedAt: '2026-08-23T09:00:00.000Z',
    },
    weakPoints: [],
    wrongQuestionSummary: {
      source: 'practice_record_wrong_question_review',
      total: 2,
      unresolved: 2,
      reviewed: 0,
      resolved: 0,
      latestWrongAt: '2026-08-23T10:00:00.000Z',
    },
    reviewDue: {
      dueCount: 0,
      overdueCount: 0,
      nextReviewAt: null,
      items: [],
    },
    studyTasks: {
      today: [],
      counts: {
        pending: 0,
        inProgress: 0,
        postponed: 0,
        completed: 0,
      },
    },
    assessmentSummary: {
      attemptCount: 1,
      bestScore: 82,
      latestAccuracyRate: 76,
      improvementText: '继续保持。',
    },
    ...overrides,
  };
}
