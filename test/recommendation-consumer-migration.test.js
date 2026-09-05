import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
require('ts-node').register({ project: fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url)) });

const { RecommendationActionAdapterService } = require('../apps/api/src/study/recommendation-action-adapter.service.ts');
const { RecommendationFeedbackService } = require('../apps/api/src/study/recommendation-feedback.service.ts');
const { toRecommendationTaskCompat } = require('../apps/api/src/study/recommendation-task.adapter.ts');
const { RecommendationService } = require('../apps/api/src/study/recommendation.service.ts');

const draft = (overrides = {}) => ({
  userId: 'u-1',
  scheduledDate: '2026-09-02',
  actionType: 'PRACTICE',
  targetType: 'KNOWLEDGE_NODE',
  targetId: 'node-1',
  reason: 'LOW_MASTERY',
  evidenceRefs: [{ kind: 'recommendation', id: 'rec-1' }],
  ...overrides,
});

class ActionDelegate {
  constructor() { this.rows = new Map(); this.next = 1; }
  async upsert({ where, create }) {
    const key = `${where.userId_creationKey.userId}:${where.userId_creationKey.creationKey}`;
    const existing = this.rows.get(key);
    if (existing) return { ...existing };
    const row = { id: `action-${this.next++}`, ...create, studyTaskId: null };
    this.rows.set(key, row);
    return { ...row };
  }
  async updateMany({ where, data }) {
    let count = 0;
    for (const row of this.rows.values()) {
      if (row.id === where.id && row.studyTaskId === where.studyTaskId) {
        row.studyTaskId = data.studyTaskId;
        count += 1;
      }
    }
    return { count };
  }
  async findUnique({ where, select }) {
    const row = [...this.rows.values()].find((candidate) => candidate.id === where.id);
    if (!row) return null;
    return select?.studyTaskId ? { studyTaskId: row.studyTaskId } : { ...row };
  }
}

function adapterHarness() {
  const recommendationAction = new ActionDelegate();
  const adapter = new RecommendationActionAdapterService({ recommendationAction });
  return { adapter, recommendationAction, tx: { recommendationAction } };
}

test('creation key is stable and scoped to user, date, action, target type, and target', () => {
  assert.equal(
    RecommendationActionAdapterService.creationKey(draft()),
    'u-1:2026-09-02:PRACTICE:KNOWLEDGE_NODE:node-1',
  );
  assert.notEqual(
    RecommendationActionAdapterService.creationKey(draft()),
    RecommendationActionAdapterService.creationKey(draft({ userId: 'u-2' })),
  );
});

test('recommendation creates one action for a repeated creation key', async () => {
  const { adapter, tx } = adapterHarness();
  const first = await adapter.createOrGetAction(draft(), tx);
  const second = await adapter.createOrGetAction(draft({ reason: 'retry' }), tx);
  assert.equal(first.id, second.id);
});

test('different users do not share recommendation actions', async () => {
  const { adapter, tx } = adapterHarness();
  const first = await adapter.createOrGetAction(draft(), tx);
  const second = await adapter.createOrGetAction(draft({ userId: 'u-2' }), tx);
  assert.notEqual(first.id, second.id);
});

test('action binds to StudyTask through RecommendationAction.studyTaskId', async () => {
  const { adapter, tx } = adapterHarness();
  const action = await adapter.createOrGetAction(draft(), tx);
  assert.equal(await adapter.bindStudyTask(action.id, 'task-1', tx), true);
  assert.equal(await adapter.bindStudyTask(action.id, 'task-2', tx), false);
});

test('concurrent action creation converges on one action identity', async () => {
  const { adapter, tx } = adapterHarness();
  const rows = await Promise.all(Array.from({ length: 8 }, () => adapter.createOrGetAction(draft(), tx)));
  assert.equal(new Set(rows.map((row) => row.id)).size, 1);
});

class RecommendationDatabase {
  constructor() {
    this.actions = new Map();
    this.plans = new Map();
    this.tasks = new Map();
    this.actionNumber = 1;
    this.planNumber = 1;
    this.taskNumber = 1;
    this.recommendationAction = {
      upsert: async ({ where, create }) => {
        const key = `${where.userId_creationKey.userId}:${where.userId_creationKey.creationKey}`;
        if (this.actions.has(key)) return { ...this.actions.get(key) };
        const row = { id: `action-${this.actionNumber++}`, ...create, studyTaskId: null };
        this.actions.set(key, row);
        return { ...row };
      },
      findUnique: async ({ where, select }) => {
        const row = [...this.actions.values()].find((candidate) => candidate.id === where.id);
        if (!row) return null;
        if (select?.studyTaskId) return { studyTaskId: row.studyTaskId };
        return { ...row };
      },
      findMany: async ({ where }) => [...this.actions.values()]
        .filter((row) => where.userId === row.userId && where.id.in.includes(row.id))
        .map((row) => ({
          id: row.id,
          studyTaskId: row.studyTaskId,
          studyTask: row.studyTaskId
            ? {
                planId: this.tasks.get(row.studyTaskId).planId,
                plan: this.plans.get(this.tasks.get(row.studyTaskId).planId),
              }
            : null,
        })),
      updateMany: async ({ where, data }) => {
        const row = [...this.actions.values()].find((candidate) => candidate.id === where.id);
        if (!row || row.studyTaskId !== where.studyTaskId) return { count: 0 };
        row.studyTaskId = data.studyTaskId;
        return { count: 1 };
      },
    };
    this.studyPlan = {
      updateMany: async ({ where, data }) => {
        for (const plan of this.plans.values()) {
          if (plan.userId === where.userId && plan.source === where.source && plan.status === where.status) plan.status = data.status;
        }
        return { count: 0 };
      },
      create: async ({ data }) => {
        const plan = { id: `plan-${this.planNumber++}`, createdAt: new Date('2026-09-02T08:00:00.000Z'), ...data, tasks: [] };
        this.plans.set(plan.id, plan);
        return plan;
      },
    };
    this.studyTask = {
      create: async ({ data }) => {
        const task = { id: `task-${this.taskNumber++}`, ...data };
        this.tasks.set(task.id, task);
        this.plans.get(task.planId).tasks.push(task);
        return task;
      },
    };
  }

  async $transaction(callback) { return callback(this); }
}

test('RecommendationService persists Action before Task and reuses the bound plan on retry', async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://phase-3-3-test';
  try {
    const db = new RecommendationDatabase();
    const adapter = new RecommendationActionAdapterService(db);
    const service = new RecommendationService(db, adapter);
    service.runRecommendationForUser = async () => ({
      result: { items: [{ kind: 'TASK_DRAFT', knowledgeNodeId: 'node-1', action: 'PRACTICE', score: 80, estimatedMinutes: 20, reasonCodes: ['LOW_MASTERY'] }] },
      nodeById: new Map([['node-1', { id: 'node-1', name: '树', subject: 'DS', importance: 5, difficulty: 3 }]]),
      breakdownByNode: new Map([['node-1', { mastery: 20 }]]),
      accuracyRateByNode: { 'node-1': 40 },
      overallAccuracyRate: 40,
      user: { targetScore: 115, currentScore: 70, remainingDays: 96, dailyHours: 3, stage: '强化' },
      daysToExam: 96,
    });
    const input = { targetExamDate: new Date('2027-01-15T00:00:00.000Z'), availableMinutes: 60, scheduledDate: '2026-09-02' };
    const first = await service.generateDailyPlanFromState('u-1', input);
    const second = await service.generateDailyPlanFromState('u-1', input);
    assert.equal(first.tasks[0].planId, second.tasks[0].planId);
    assert.equal(db.actions.size, 1);
    assert.equal(db.tasks.size, 1);
    assert.equal([...db.actions.values()][0].studyTaskId, [...db.tasks.keys()][0]);
    assert.notEqual([...db.actions.values()][0].id, [...db.tasks.values()][0].id);
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});

test('task consumer compatibility reads task.action.id and does not equate task and action ids', () => {
  const task = toRecommendationTaskCompat({ id: 'task-1', title: '练习', action: { id: 'action-1' } });
  assert.equal(task.actionId, 'action-1');
  assert.notEqual(task.id, task.actionId);
  assert.equal(toRecommendationTaskCompat({ id: 'task-2', action: null }).actionId, null);
});

test('recommendation service is wired with the action adapter without changing scoring ownership', () => {
  const source = fs.readFileSync(new URL('../apps/api/src/study/recommendation.service.ts', import.meta.url), 'utf8');
  assert.match(source, /RecommendationActionAdapterService/);
  assert.match(source, /createOrGetAction/);
  assert.match(source, /bindStudyTask/);
  assert.doesNotMatch(source, /calculatePriority\s*=|function\s+calculatePriority/);
});

test('learning session integration continues to use Action identity', () => {
  const source = fs.readFileSync(new URL('../apps/api/src/study/learning-session-action.service.ts', import.meta.url), 'utf8');
  assert.match(source, /actionId/);
  assert.doesNotMatch(source, /studyTaskId/);
});

test('feedback maps successful action signal without recomputing recommendation', async () => {
  const signals = { buildSignal: async () => ({ outcomeStatus: 'SUCCESS', confidence: 1, evidenceRefs: ['practice-record:p-1'] }) };
  const feedback = new RecommendationFeedbackService(signals);
  const result = await feedback.getFeedback('u-1', 'action-1');
  assert.deepEqual(result, {
    actionId: 'action-1',
    success: true,
    confidence: 1,
    outcomeCount: 1,
    feedbackType: 'SUCCESSFUL_ACTION',
  });
  assert.equal(result.lastOutcomeAt, undefined);
});

for (const [outcomeStatus, feedbackType, success, confidence] of [
  ['SUCCESS', 'SUCCESSFUL_ACTION', true, 1],
  ['PARTIAL', 'PARTIAL_ACTION', false, 0.5],
  ['FAILED', 'FAILED_ACTION', false, 0.2],
  ['NO_OUTCOME', 'NO_SIGNAL', false, 0],
]) {
  test(`feedback maps ${outcomeStatus} to ${feedbackType}`, async () => {
    const feedback = new RecommendationFeedbackService({
      buildSignal: async () => ({ outcomeStatus, confidence, evidenceRefs: [] }),
    });
    const result = await feedback.getFeedback('u-1', 'action-1');
    assert.equal(result.feedbackType, feedbackType);
    assert.equal(result.success, success);
    assert.equal(result.confidence, confidence);
  });
}

test('feedback propagates user-scoped action not-found and forbidden failures', async () => {
  for (const code of ['ACTION_NOT_FOUND', 'ACTION_FORBIDDEN']) {
    const feedback = new RecommendationFeedbackService({ buildSignal: async () => { throw Object.assign(new Error(code), { code }); } });
    await assert.rejects(() => feedback.getFeedback('u-1', 'action-1'), (error) => error.code === code);
  }
});

test('feedback route is exposed as a user-scoped read endpoint', () => {
  const source = fs.readFileSync(new URL('../apps/api/src/study/study.controller.ts', import.meta.url), 'utf8');
  assert.match(source, /@Get\('recommendation-actions\/:id\/feedback'\)/);
  assert.match(source, /RecommendationFeedbackService/);
  assert.doesNotMatch(source, /@Query\('userId'\).*feedback/);
});
