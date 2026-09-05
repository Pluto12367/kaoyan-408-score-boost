import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

const { RecommendationActionAdapterService } = require('../apps/api/src/study/recommendation-action-adapter.service.ts');
const { RecommendationService } = require('../apps/api/src/study/recommendation.service.ts');
const { createRecommendationActionKey } = require('../apps/api/src/study/action-creation-key.ts');

const baseDraft = (overrides = {}) => ({
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
  constructor() {
    this.rows = new Map();
    this.nextId = 1;
  }

  async upsert({ where, create }) {
    const key = `${where.userId_creationKey.userId}:${where.userId_creationKey.creationKey}`;
    const existing = this.rows.get(key);
    if (existing) return existing;
    const row = { id: `action-${this.nextId++}`, ...create, studyTaskId: null };
    this.rows.set(key, row);
    return row;
  }
}

function adapterHarness() {
  const recommendationAction = new ActionDelegate();
  const adapter = new RecommendationActionAdapterService({ recommendationAction });
  return { adapter, recommendationAction, tx: { recommendationAction } };
}

test('same generation and target reuse one generation-scoped action', async () => {
  const { adapter, recommendationAction, tx } = adapterHarness();
  const input = baseDraft({ generationKey: 'LEARNING_LOOP:u-1:2026-09-02:v1' });

  const first = await adapter.createOrGetAction(input, tx);
  const second = await adapter.createOrGetAction({ ...input, reason: 'retry' }, tx);

  assert.equal(first.id, second.id);
  assert.equal(first.creationKey, createRecommendationActionKey(
    input.generationKey,
    input.actionType,
    input.targetType,
    input.targetId,
  ));
  assert.equal(recommendationAction.rows.size, 1);
});

test('different generations isolate the same action target', async () => {
  const { adapter, recommendationAction, tx } = adapterHarness();
  const first = await adapter.createOrGetAction(
    baseDraft({ generationKey: 'LEARNING_LOOP:u-1:2026-09-02:v1' }),
    tx,
  );
  const second = await adapter.createOrGetAction(
    baseDraft({ generationKey: 'LEARNING_LOOP:u-1:2026-09-02:v2' }),
    tx,
  );

  assert.notEqual(first.id, second.id);
  assert.equal(recommendationAction.rows.size, 2);
});

test('LearningLoop and Manual generations do not reuse an action', async () => {
  const { adapter, recommendationAction, tx } = adapterHarness();
  const learningLoop = await adapter.createOrGetAction(
    baseDraft({ generationKey: 'LEARNING_LOOP:u-1:2026-09-02:v1' }),
    tx,
  );
  const manual = await adapter.createOrGetAction(
    baseDraft({ generationKey: 'MANUAL:u-1:2026-09-02:req-1' }),
    tx,
  );

  assert.notEqual(learningLoop.id, manual.id);
  assert.equal(recommendationAction.rows.size, 2);
});

test('legacy action drafts retain the old creation key and remain readable', async () => {
  const { adapter, recommendationAction, tx } = adapterHarness();
  const legacy = baseDraft();
  const action = await adapter.createOrGetAction(legacy, tx);

  assert.equal(action.creationKey, 'u-1:2026-09-02:PRACTICE:KNOWLEDGE_NODE:node-1');
  assert.equal(recommendationAction.rows.size, 1);
});

test('RecommendationService propagates generationKey into action creation', async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://phase-3-6-4-b2-test';
  try {
    const captured = [];
    const actionAdapter = {
      async createOrGetAction(input) {
        captured.push(input);
        return { id: `action-${captured.length}`, studyTaskId: null };
      },
      async findBoundPlan() { return null; },
      async bindStudyTask() { return true; },
    };
    const database = {
      studyPlan: {
        updateMany: async () => ({ count: 0 }),
        create: async ({ data }) => ({ id: 'plan-1', ...data, tasks: [] }),
      },
      studyTask: {
        create: async ({ data }) => ({ id: 'task-1', ...data }),
      },
      async $transaction(callback) { return callback(this); },
    };
    const service = new RecommendationService(database, actionAdapter);
    service.runRecommendationForUser = async () => ({
      result: {
        items: [{
          kind: 'TASK_DRAFT',
          knowledgeNodeId: 'node-1',
          action: 'PRACTICE',
          score: 80,
          estimatedMinutes: 20,
          reasonCodes: ['LOW_MASTERY'],
        }],
      },
      nodeById: new Map([['node-1', { id: 'node-1', name: '树', subject: 'DS' }]]),
      breakdownByNode: new Map([['node-1', { mastery: 20 }]]),
      accuracyRateByNode: { 'node-1': 40 },
      overallAccuracyRate: 40,
      user: { targetScore: 115, currentScore: 70, remainingDays: 96, dailyHours: 3, stage: '强化' },
      daysToExam: 96,
    });

    await service.generateDailyPlanFromState('u-1', {
      targetExamDate: new Date('2027-01-15T00:00:00.000Z'),
      availableMinutes: 60,
      scheduledDate: '2026-09-02',
      generationKey: 'LEARNING_LOOP:u-1:2026-09-02:v1',
    });

    assert.equal(captured.length, 1);
    assert.equal(captured[0].generationKey, 'LEARNING_LOOP:u-1:2026-09-02:v1');
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});
