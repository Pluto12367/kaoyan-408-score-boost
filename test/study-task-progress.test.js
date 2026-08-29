import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

const { LearningProgressRepository } = require('../apps/api/src/study/learning-progress.repository.ts');
const { StudentStateProjectionService } = require('../apps/api/src/study/student-state-projection.service.ts');
const { StudyService } = require('../apps/api/src/study/study.service.ts');
const { computePracticeRecordRequestHash } = require('../apps/api/src/study/answer-request-hash.ts');
const { todayKey } = require('../apps/api/src/study/study-date.ts');

test('schema defines StudyTaskProgress as a persisted accumulator without deferred fields', async () => {
  const schema = await readFile('prisma/schema.prisma', 'utf8');
  const model = schema.match(/model\s+StudyTaskProgress\s+\{[\s\S]*?\n\}/)?.[0] ?? '';

  assert.match(schema, /studyTaskProgresses\s+StudyTaskProgress\[\]/);
  assert.match(model, /id\s+String\s+@id\s+@default\(cuid\(\)\)/);
  assert.match(model, /userId\s+String/);
  assert.match(model, /taskId\s+String/);
  assert.match(model, /completedQuestionCount\s+Int\s+@default\(0\)/);
  assert.match(model, /correctCount\s+Int\s+@default\(0\)/);
  assert.match(model, /minutesSpent\s+Int\s+@default\(0\)/);
  assert.match(model, /createdAt\s+DateTime\s+@default\(now\(\)\)/);
  assert.match(model, /updatedAt\s+DateTime\s+@updatedAt/);
  assert.match(model, /@@unique\(\[userId, taskId\]\)/);
  assert.match(model, /@@index\(\[userId\]\)/);
  assert.doesNotMatch(model, /version/);
  assert.doesNotMatch(model, /appliedPracticeRecordIds/);
  assert.doesNotMatch(model, /progressDate/);
  assert.doesNotMatch(schema.match(/model\s+PracticeRecord\s+\{[\s\S]*?\n\}/)?.[0] ?? '', /taskId/);
});

test('repository creates and atomically increments StudyTaskProgress rows', async () => {
  await withDatabaseUrl(async () => {
    const harness = createProgressRepositoryHarness();

    const first = await harness.repository.incrementStudyTaskProgress({
      userId: 'u-1',
      taskId: 'task-1',
      completedQuestionIncrement: 1,
      correctIncrement: 1,
      minutesIncrement: 2,
    });
    const second = await harness.repository.incrementStudyTaskProgress({
      userId: 'u-1',
      taskId: 'task-1',
      completedQuestionIncrement: 1,
      correctIncrement: 0,
      minutesIncrement: 1,
    });

    assert.equal(first.completedQuestionCount, 1);
    assert.equal(first.correctCount, 1);
    assert.equal(first.minutesSpent, 2);
    assert.equal(second.completedQuestionCount, 2);
    assert.equal(second.correctCount, 1);
    assert.equal(second.minutesSpent, 3);
    assert.deepEqual(harness.calls.map((call) => call.method), ['upsert', 'upsert']);
    assert.deepEqual(harness.calls[1].args.update.completedQuestionCount, { increment: 1 });
    assert.deepEqual(harness.calls[1].args.update.correctCount, { increment: 0 });
    assert.deepEqual(harness.calls[1].args.update.minutesSpent, { increment: 1 });
  });
});

test('repository loads persisted task progress by task id', async () => {
  await withDatabaseUrl(async () => {
    const harness = createProgressRepositoryHarness([
      progressRow({ userId: 'u-1', taskId: 'task-1', completedQuestionCount: 2, correctCount: 1, minutesSpent: 3 }),
      progressRow({ userId: 'u-1', taskId: 'task-2', completedQuestionCount: 4, correctCount: 4, minutesSpent: 8 }),
      progressRow({ userId: 'u-2', taskId: 'task-other', completedQuestionCount: 1, correctCount: 0, minutesSpent: 1 }),
    ]);

    const progress = await harness.repository.loadStudyTaskProgress('u-1');

    assert.deepEqual([...progress.keys()].sort(), ['task-1', 'task-2']);
    assert.deepEqual(progress.get('task-1'), {
      completedQuestionCount: 2,
      correctCount: 1,
      minutesSpent: 3,
    });
  });
});

test('two concurrent repository increments both accumulate', async () => {
  await withDatabaseUrl(async () => {
    const harness = createProgressRepositoryHarness();

    await Promise.all([
      harness.repository.incrementStudyTaskProgress({
        userId: 'u-1',
        taskId: 'task-1',
        completedQuestionIncrement: 1,
        correctIncrement: 1,
        minutesIncrement: 1,
      }),
      harness.repository.incrementStudyTaskProgress({
        userId: 'u-1',
        taskId: 'task-1',
        completedQuestionIncrement: 1,
        correctIncrement: 0,
        minutesIncrement: 2,
      }),
    ]);

    const stored = harness.rows.get('u-1:task-1');
    assert.equal(stored.completedQuestionCount, 2);
    assert.equal(stored.correctCount, 1);
    assert.equal(stored.minutesSpent, 3);
  });
});

test('service persists progress instead of using memory when DATABASE_URL is configured', async () => {
  await withDatabaseUrl(async () => {
    const harness = createStudyTaskHarness({ questionCount: 3 });

    await harness.service.applyPracticeProgressToTasks('u-task', practiceRecord({ correct: true, timeSpentSec: 90 }));
    await harness.service.applyPracticeProgressToTasks('u-task', practiceRecord({ correct: false, timeSpentSec: 30 }));

    assert.deepEqual(harness.learningProgress.progress.get('u-task:task-kp-a'), {
      completedQuestionCount: 2,
      correctCount: 1,
      minutesSpent: 3,
    });
    assert.equal(harness.learningProgress.memoryProgressFor('u-task', 'task-kp-a'), undefined);
    assert.equal(harness.learningProgress.completions.size, 0);
  });
});

test('service auto-completes a task when persisted progress reaches target', async () => {
  await withDatabaseUrl(async () => {
    const harness = createStudyTaskHarness({ questionCount: 2 });

    await harness.service.applyPracticeProgressToTasks('u-task', practiceRecord({ correct: true, timeSpentSec: 60 }));
    await harness.service.applyPracticeProgressToTasks('u-task', practiceRecord({ correct: true, timeSpentSec: 60 }));

    assert.equal(harness.learningProgress.completions.size, 1);
    assert.equal(harness.onboarding.completedTaskCalls, 1);
    const completion = [...harness.learningProgress.completions.values()][0];
    assert.equal(completion.completedQuestionCount, 2);
    assert.equal(completion.correctCount, 2);
    assert.equal(completion.minutesSpent, 2);
  });
});

test('concurrent target-reaching progress still produces one completion record', async () => {
  await withDatabaseUrl(async () => {
    const harness = createStudyTaskHarness({ questionCount: 1 });

    await Promise.all([
      harness.service.applyPracticeProgressToTasks('u-task', practiceRecord({ correct: true, timeSpentSec: 60 })),
      harness.service.applyPracticeProgressToTasks('u-task', practiceRecord({ correct: false, timeSpentSec: 60 })),
    ]);

    assert.equal(harness.learningProgress.progress.get('u-task:task-kp-a').completedQuestionCount, 2);
    assert.equal(harness.learningProgress.completions.size, 1);
  });
});

test('persisted progress survives service restart and is preferred by getTodayPlan', async () => {
  await withDatabaseUrl(async () => {
    const learningProgress = createLearningProgressFake();
    learningProgress.progress.set('u-task:task-kp-a', {
      completedQuestionCount: 2,
      correctCount: 1,
      minutesSpent: 4,
    });
    const first = createStudyTaskHarness({ learningProgress, questionCount: 5 });
    first.service.taskProgressByUser.set('u-task', new Map([[
      'task-kp-a',
      { completedQuestionCount: 99, correctCount: 99, minutesSpent: 99 },
    ]]));
    const second = createStudyTaskHarness({ learningProgress, questionCount: 5 });

    const plan = await second.service.getTodayPlan('u-task');
    const progress = plan.priorityTasks.find((task) => task.id === 'task-kp-a').progress;

    assert.deepEqual(progress, {
      completedQuestionCount: 2,
      correctCount: 1,
      minutesSpent: 4,
      reachedTarget: false,
    });
  });
});

test('different tasks keep isolated progress rows', async () => {
  await withDatabaseUrl(async () => {
    const harness = createStudyTaskHarness({
      tasks: [
        taskState({ id: 'task-kp-a', knowledgePointId: 'kp-a' }),
        taskState({ id: 'task-kp-b', knowledgePointId: 'kp-b' }),
      ],
    });

    await harness.service.applyPracticeProgressToTasks('u-task', practiceRecord({ knowledgePointId: 'kp-a', correct: true }));
    await harness.service.applyPracticeProgressToTasks('u-task', practiceRecord({ knowledgePointId: 'kp-b', correct: false }));

    assert.equal(harness.learningProgress.progress.get('u-task:task-kp-a').completedQuestionCount, 1);
    assert.equal(harness.learningProgress.progress.get('u-task:task-kp-b').completedQuestionCount, 1);
    assert.equal(harness.learningProgress.progress.get('u-task:task-kp-a').correctCount, 1);
    assert.equal(harness.learningProgress.progress.get('u-task:task-kp-b').correctCount, 0);
  });
});

test('AnswerReceipt replay does not advance persisted task progress again', async () => {
  await withDatabaseUrl(async () => {
    const harness = createStudyTaskHarness({ withAnswerReceipts: true, questionCount: 5 });

    await harness.service.createPracticeRecord(answerInput(), { idempotencyKey: 'task-progress-key' });
    await harness.service.createPracticeRecord(answerInput(), { idempotencyKey: 'task-progress-key' });

    assert.equal(harness.practiceRecords.length, 1);
    assert.equal(harness.learningProgress.incrementCalls, 1);
    assert.equal(harness.learningProgress.progress.get('u-task:task-kp-a').completedQuestionCount, 1);
  });
});

test('student state projection merges StudyTaskProgress into snapshot tasks', async () => {
  await withDatabaseUrl(async () => {
    const service = new StudentStateProjectionService({
      user: { findUnique: async () => null },
      userKnowledgeMastery: { findMany: async () => [] },
      practiceRecord: { findMany: async () => [] },
      wrongQuestionReview: { findMany: async () => [] },
      reviewSchedule: { findMany: async () => [] },
      studyTask: {
        findMany: async () => [{
          id: 'task-kp-a',
          title: '链表专项',
          status: 'in_progress',
          scheduledDate: todayKey(),
          completed: false,
          completedAt: null,
          priority: '高',
          mode: '专项训练',
          questionCount: 5,
          minutes: 20,
        }],
      },
      studyTaskProgress: {
        findMany: async () => [{
          taskId: 'task-kp-a',
          completedQuestionCount: 3,
          correctCount: 2,
          minutesSpent: 6,
        }],
      },
      assessmentHistoryItem: { findMany: async () => [] },
    });

    const snapshot = await service.getSnapshot('u-task', new Date());
    assert.equal(snapshot.studyTasks.today[0].completedQuestionCount, 3);
    assert.equal(snapshot.studyTasks.today[0].correctCount, 2);
    assert.equal(snapshot.studyTasks.today[0].minutesSpent, 6);
    assert.equal(snapshot.studyTasks.today[0].reachedTarget, false);
  });
});

test('no DATABASE_URL keeps the existing in-memory demo fallback', async () => {
  await withoutDatabaseUrl(async () => {
    const harness = createStudyTaskHarness({ dbEnabled: false, questionCount: 3 });

    await harness.service.applyPracticeProgressToTasks('u-task', practiceRecord({ correct: true, timeSpentSec: 60 }));
    const plan = await harness.service.getTodayPlan('u-task');
    const progress = plan.priorityTasks.find((task) => task.id === 'task-kp-a').progress;

    assert.deepEqual(progress, {
      completedQuestionCount: 1,
      correctCount: 1,
      minutesSpent: 1,
      reachedTarget: false,
    });
    assert.equal(harness.learningProgress.incrementCalls, 0);
  });
});

async function withDatabaseUrl(work) {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://unit.test/study-task-progress';
  try {
    return await work();
  } finally {
    restoreEnv('DATABASE_URL', previous);
  }
}

async function withoutDatabaseUrl(work) {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    return await work();
  } finally {
    restoreEnv('DATABASE_URL', previous);
  }
}

function restoreEnv(name, previous) {
  if (previous === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = previous;
  }
}

function createProgressRepositoryHarness(seedRows = []) {
  const rows = new Map(seedRows.map((row) => [`${row.userId}:${row.taskId}`, clone(row)]));
  const calls = [];
  const prisma = {
    studyTaskProgress: {
      async findMany(args) {
        calls.push({ method: 'findMany', args });
        return [...rows.values()]
          .filter((row) => row.userId === args.where.userId)
          .map(clone);
      },
      async upsert(args) {
        calls.push({ method: 'upsert', args });
        const key = `${args.create.userId}:${args.create.taskId}`;
        const existing = rows.get(key);
        const now = new Date();
        const row = existing
          ? {
              ...existing,
              completedQuestionCount: existing.completedQuestionCount + args.update.completedQuestionCount.increment,
              correctCount: existing.correctCount + args.update.correctCount.increment,
              minutesSpent: existing.minutesSpent + args.update.minutesSpent.increment,
              updatedAt: now,
            }
          : {
              id: `progress-${rows.size + 1}`,
              ...args.create,
              createdAt: now,
              updatedAt: now,
            };
        rows.set(key, row);
        return clone(row);
      },
      async findUnique() {
        throw new Error('read-modify-write is not allowed for StudyTaskProgress');
      },
      async update() {
        throw new Error('read-modify-write is not allowed for StudyTaskProgress');
      },
    },
  };
  return {
    repository: new LearningProgressRepository(prisma),
    rows,
    calls,
  };
}

function createStudyTaskHarness(options = {}) {
  const learningProgress = options.learningProgress ?? createLearningProgressFake();
  const onboarding = createOnboardingFake();
  const practiceRecords = [];
  const receipts = options.withAnswerReceipts ? new InMemoryReceipts() : undefined;
  const question = {
    id: 'q-kp-a',
    stem: 'Task progress question',
    options: ['A', 'B', 'C', 'D'],
    answer: 'B',
    analysis: 'analysis',
    difficulty: '中等',
    type: '选择题',
    source: 'unit',
    expectedTimeSec: 60,
    knowledgePointIds: ['kp-a'],
  };
  const unavailable = { enabled: false };
  const practiceRecordRepository = {
    enabled: true,
    save: async (record) => {
      practiceRecords.push(record);
      return record;
    },
  };
  const authenticatedUsers = {
    get: (id) => ({
      id,
      name: '408 学习者',
      role: 'student',
    }),
  };
  const scoreCenterService = {
    applyAttempts: async () => {},
    getTodayScoreCenterPlan: async () => null,
  };
  const prisma = options.withAnswerReceipts
    ? { $transaction: async (work) => work({}) }
    : undefined;
  const service = new StudyService(
    {
      listQuestions: () => [question],
      findQuestionById: async (id) => (id === question.id ? question : null),
    },
    unavailable,
    practiceRecordRepository,
    learningProgress,
    unavailable,
    unavailable,
    unavailable,
    unavailable,
    unavailable,
    unavailable,
    { enabled: false, saveSchedule: async () => {} },
    unavailable,
    onboarding,
    unavailable,
    authenticatedUsers,
    unavailable,
    unavailable,
    unavailable,
    { record: async () => {} },
    scoreCenterService,
    prisma,
    receipts,
  );
  const tasks = options.tasks ?? [
    taskState({ id: 'task-kp-a', knowledgePointId: 'kp-a', questionCount: options.questionCount ?? 5 }),
  ];
  service.sevenDayPlansByUser.set('u-task', {
    id: 'plan-1',
    userId: 'u-task',
    phase: '强化',
    targetScore: 120,
    remainingDays: 90,
    dailyHours: 4,
    checkpoint: '完成今日训练',
    startDate: todayKey(),
    tasks,
  });
  if (options.dbEnabled === false) learningProgress.enabled = false;
  return { service, learningProgress, onboarding, practiceRecords, receipts };
}

function createLearningProgressFake() {
  return {
    enabled: true,
    progress: new Map(),
    completions: new Map(),
    incrementCalls: 0,
    async loadStudyTaskProgress(userId) {
      const rows = new Map();
      for (const [key, value] of this.progress) {
        const [rowUserId, taskId] = key.split(':');
        if (rowUserId === userId) rows.set(taskId, { ...value });
      }
      return rows;
    },
    async incrementStudyTaskProgress(input) {
      this.incrementCalls += 1;
      const key = `${input.userId}:${input.taskId}`;
      const current = this.progress.get(key) ?? { completedQuestionCount: 0, correctCount: 0, minutesSpent: 0 };
      const next = {
        completedQuestionCount: current.completedQuestionCount + input.completedQuestionIncrement,
        correctCount: current.correctCount + input.correctIncrement,
        minutesSpent: current.minutesSpent + input.minutesIncrement,
      };
      this.progress.set(key, next);
      return { taskId: input.taskId, ...next };
    },
    async saveTaskCompletion(input) {
      this.completions.set(`${input.userId}:${input.taskId}:${input.completedDate}`, { ...input });
    },
    memoryProgressFor() {
      return undefined;
    },
  };
}

function createOnboardingFake() {
  return {
    enabled: true,
    completedTaskCalls: 0,
    async completeTask(userId, taskId, completedAt) {
      this.completedTaskCalls += 1;
      return {
        task: {
          ...taskState({ id: taskId }),
          status: 'completed',
          completedAt,
        },
        futureTask: null,
      };
    },
  };
}

function taskState(overrides = {}) {
  return {
    id: 'task-kp-a',
    knowledgePointId: 'kp-a',
    subject: '数据结构',
    chapter: '线性表',
    title: '链表专项',
    mode: '专项训练',
    minutes: 20,
    questionCount: 5,
    scheduledDate: todayKey(),
    priority: '高',
    reason: '薄弱点补强',
    nextAction: '完成 5 道题',
    status: 'pending',
    postponeCount: 0,
    ...overrides,
  };
}

function practiceRecord(overrides = {}) {
  return {
    id: `record-${Math.random()}`,
    userId: 'u-task',
    questionId: 'q-kp-a',
    knowledgePointId: 'kp-a',
    selectedAnswer: 'B',
    correct: true,
    timeSpentSec: 60,
    expectedTimeSec: 60,
    mistakeReason: null,
    submittedAt: new Date().toISOString(),
    ...overrides,
  };
}

function answerInput(overrides = {}) {
  return {
    userId: 'u-task',
    questionId: 'q-kp-a',
    knowledgePointId: 'kp-a',
    selectedAnswer: 'B',
    timeSpentSec: 60,
    ...overrides,
  };
}

function progressRow(overrides = {}) {
  return {
    id: 'progress-row',
    userId: 'u-1',
    taskId: 'task-1',
    completedQuestionCount: 0,
    correctCount: 0,
    minutesSpent: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class InMemoryReceipts {
  constructor() {
    this.rows = new Map();
    this.enabled = true;
  }

  key(userId, idempotencyKey) {
    return `${userId}:${idempotencyKey}`;
  }

  async findByKey(userId, idempotencyKey) {
    return this.rows.get(this.key(userId, idempotencyKey)) ?? null;
  }

  async createPending(input) {
    const key = this.key(input.userId, input.idempotencyKey);
    if (this.rows.has(key)) {
      const error = new Error('unique');
      error.code = 'P2002';
      throw error;
    }
    const row = {
      id: `receipt-${this.rows.size + 1}`,
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      hashVersion: input.hashVersion,
      status: 'PENDING',
      responseSnapshot: null,
      practiceRecordIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.set(key, row);
    return row;
  }

  async markSucceeded(_tx, input) {
    const row = [...this.rows.values()].find((candidate) => candidate.id === input.id);
    row.status = 'SUCCEEDED';
    row.responseSnapshot = input.responseSnapshot;
    row.practiceRecordIds = input.practiceRecordIds;
    row.requestHash = row.requestHash ?? computePracticeRecordRequestHash(answerInput());
    row.updatedAt = new Date();
    return row;
  }

  async markFailed(input) {
    const row = [...this.rows.values()].find((candidate) => candidate.id === input.id);
    if (!row || row.status === 'SUCCEEDED') return null;
    row.status = 'FAILED';
    row.responseSnapshot = input.responseSnapshot;
    row.updatedAt = new Date();
    return row;
  }

  async takeOverPending() {
    return false;
  }
}
