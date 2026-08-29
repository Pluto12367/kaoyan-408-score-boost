import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Sandbox CommonJS loader: transpiles a TS source and evaluates it with stubbed
// dependencies. It never writes to the source tree (unlike an earlier write-back
// loader, which corrupted today-plan-projection.service.ts).
async function loadModule(path, dependencies = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)((specifier) => {
    const key = Object.keys(dependencies).find((candidate) => specifier.includes(candidate));
    if (key) return dependencies[key];
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
  return module.exports;
}

async function loadProjection() {
  const snapshotModule = await loadModule('apps/api/src/study/today-plan.snapshot.ts');
  return loadModule('apps/api/src/study/today-plan-projection.service.ts', {
    '@nestjs/common': {
      Injectable: () => (target) => target,
    },
    './today-plan.snapshot': snapshotModule,
    './student-state-projection.service': { StudentStateProjectionService: class StudentStateProjectionService {} },
    './wrong-question-projection.service': { WrongQuestionProjectionService: class WrongQuestionProjectionService {} },
    '../prisma/prisma.service': { PrismaService: class PrismaService {} },
  });
}

const asOf = new Date('2026-08-24T08:00:00.000Z');

function createStudentState() {
  return {
    userId: 'u-1',
    asOf: asOf.toISOString(),
    goal: {},
    mastery: { source: 'user_knowledge_mastery', averageMastery: 62, weakCount: 1, reviewCount: 2, masteredCount: 3, lastUpdatedAt: '2026-08-23T00:00:00.000Z' },
    weakPoints: [{ knowledgeNodeId: 'kp-1', subject: '操作系统', chapter: '内存管理', title: '页表', masteryRate: 35, accuracyRate: 40, attempts: 5, wrongCount: 3 }],
    wrongQuestionSummary: { source: 'practice_record_wrong_question_review', total: 2, unresolved: 2, reviewed: 1, resolved: 0, latestWrongAt: '2026-08-23T00:00:00.000Z' },
    reviewDue: { dueCount: 1, overdueCount: 1, nextReviewAt: '2026-08-23T00:00:00.000Z', items: [{ questionId: 'q-1', nextReviewAt: '2026-08-23T00:00:00.000Z', reviewCount: 1, stability: 'learning', overdue: true }] },
    studyTasks: { today: [], counts: { pending: 0, inProgress: 0, postponed: 0, completed: 0 } },
    assessmentSummary: { attemptCount: 0, bestScore: 0, latestAccuracyRate: 0, improvementText: '' },
  };
}

function createPrisma(plan = null) {
  return {
    studyPlan: {
      findFirst: async () => plan,
    },
  };
}

function createProjection(overrides = {}) {
  return {
    getSnapshot: async () => ({ ...createStudentState(), ...overrides }),
  };
}

function createWrongProjection() {
  return { getSnapshot: async () => ({ dueItems: [] }) };
}

function createPlan() {
  return {
    id: 'plan-1',
    phase: '强化',
    status: 'ACTIVE',
    startDate: new Date('2026-08-18T00:00:00.000Z'),
    endDate: new Date('2026-08-24T00:00:00.000Z'),
    createdAt: new Date('2026-08-18T00:00:00.000Z'),
    checkpoint: null,
    tasks: [{
      id: 'task-1', title: '页表专项', status: 'pending', scheduledDate: new Date('2026-08-24T00:00:00.000Z'),
      completed: false, completedAt: null, priority: '高', mode: '专项训练', questionCount: 10, minutes: 30,
    }],
  };
}

test('empty snapshot is returned without DATABASE_URL', async () => {
  const { TodayPlanProjectionService } = await loadProjection();
  const service = new TodayPlanProjectionService(createPrisma(), createProjection(), createWrongProjection());
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const snapshot = await service.getSnapshot('u-empty', asOf);
    assert.equal(snapshot.userId, 'u-empty');
    assert.equal(snapshot.asOf, asOf.toISOString());
    assert.deepEqual(snapshot.taskFacts.todayTasks, []);
    assert.equal(snapshot.reviewFacts.dueCount, 0);
    assert.equal(snapshot.masteryFacts.source, 'empty');
    assert.equal(snapshot.scoreFacts.available, false);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

test('task facts are projected from the active plan and StudentState progress', async () => {
  const { TodayPlanProjectionService } = await loadProjection();
  const service = new TodayPlanProjectionService(createPrisma(createPlan()), createProjection({
    studyTasks: {
      today: [{ id: 'task-1', title: '页表专项', status: 'pending', scheduledDate: '2026-08-24', completed: false, completedAt: null, priority: '高', mode: '专项训练', questionCount: 10, minutes: 30, completedQuestionCount: 2, correctCount: 1, minutesSpent: 6, reachedTarget: false }],
      counts: { pending: 1, inProgress: 0, postponed: 0, completed: 0 },
    },
  }), createWrongProjection());
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://test';
  try {
    const snapshot = await service.getSnapshot('u-1', asOf);
    assert.equal(snapshot.planFacts.phase, '强化');
    assert.equal(snapshot.taskFacts.todayTasks[0].id, 'task-1');
    assert.equal(snapshot.taskFacts.todayTasks[0].progress.completedQuestionCount, 2);
    assert.equal(snapshot.taskFacts.todayTasks[0].completed, false);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

test('activity and review facts are reused from StudentState projection', async () => {
  const { TodayPlanProjectionService } = await loadProjection();
  let calls = 0;
  const state = createProjection();
  const studentState = { getSnapshot: async (...args) => { calls += 1; return state.getSnapshot(...args); } };
  const service = new TodayPlanProjectionService(createPrisma(), studentState, createWrongProjection());
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://test';
  try {
    const snapshot = await service.getSnapshot('u-1', asOf);
    assert.equal(calls, 1);
    assert.equal(snapshot.reviewFacts.dueCount, 1);
    assert.equal(snapshot.reviewFacts.items[0].questionId, 'q-1');
    assert.equal(snapshot.activityFacts.streakDays, 0);
    assert.equal(snapshot.activityFacts.latestActivityAt, '2026-08-23T00:00:00.000Z');
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

test('projection snapshot does not expose legacy DTO fields', async () => {
  const { TodayPlanProjectionService } = await loadProjection();
  const service = new TodayPlanProjectionService(createPrisma(), createProjection(), createWrongProjection());
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://test';
  try {
    const snapshot = await service.getSnapshot('u-1', asOf);
    const json = JSON.stringify(snapshot);
    for (const key of ['nextAction', 'recommendation', 'priorityTasks', 'checkpointMessage', 'reason', 'actionText', 'actionAnchor']) {
      assert.equal(json.includes(`"${key}"`), false, `${key} must not be projected`);
    }
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});
