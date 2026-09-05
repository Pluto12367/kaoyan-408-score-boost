import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

const { RecommendationService } = require('../apps/api/src/study/recommendation.service.ts');

class GenerationRepositorySpy {
  constructor() {
    this.calls = [];
    this.rows = new Map();
    this.nextId = 1;
  }

  async findByGenerationKey(userId, generationKey) {
    return this.rows.get(`${userId}:${generationKey}`) ?? null;
  }

  async createOrGetByGenerationKey(input) {
    this.calls.push(input);
    const key = `${input.userId}:${input.generationKey}`;
    const existing = this.rows.get(key);
    if (existing) return existing;
    const plan = {
      id: `generation-plan-${this.nextId++}`,
      ...input,
      tasks: (input.tasks ?? []).map((task, index) => ({
        id: `generation-task-${index + 1}`,
        planId: `generation-plan-${this.nextId}`,
        ...task,
      })),
    };
    this.rows.set(key, plan);
    return plan;
  }
}

function createHarness() {
  const database = {
    studyPlan: {
      updateMany: async () => ({ count: 0 }),
    },
    async $transaction(callback) {
      return callback(this);
    },
  };
  const generationRepository = new GenerationRepositorySpy();
  const service = new RecommendationService(database, undefined, generationRepository);
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
    nodeById: new Map([['node-1', {
      id: 'node-1', name: '树', subject: 'DS', importance: 5, difficulty: 3,
    }]]),
    breakdownByNode: new Map([['node-1', { mastery: 20 }]]),
    accuracyRateByNode: { 'node-1': 40 },
    overallAccuracyRate: 40,
    user: { targetScore: 115, currentScore: 70, remainingDays: 96, dailyHours: 3, stage: '强化' },
    daysToExam: 96,
  });
  return { database, generationRepository, service };
}

test('LearningLoop generation context uses the StudyPlan generation repository', async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://phase-3-6-4-b1-test';
  try {
    const { generationRepository, service } = createHarness();
    const input = {
      targetExamDate: new Date('2027-01-15T00:00:00.000Z'),
      availableMinutes: 60,
      scheduledDate: '2026-09-03',
      generationKey: 'LEARNING_LOOP:u-1:2026-09-03:v1',
      source: 'score-center',
      version: 'score-center-v1',
    };

    const first = await service.generateDailyPlanFromState('u-1', input);
    const second = await service.generateDailyPlanFromState('u-1', input);

    assert.equal(first.id, second.id);
    assert.equal(generationRepository.calls.length, 1);
    assert.equal(generationRepository.calls[0].generationKey, input.generationKey);
    assert.equal(generationRepository.calls[0].source, input.source);
    assert.equal(generationRepository.calls[0].modelVersion, input.version);
    assert.equal(generationRepository.rows.size, 1);
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});

test('different generation keys remain isolated at the StudyPlan boundary', async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://phase-3-6-4-b1-test';
  try {
    const { generationRepository, service } = createHarness();
    const base = {
      targetExamDate: new Date('2027-01-15T00:00:00.000Z'),
      availableMinutes: 60,
      scheduledDate: '2026-09-03',
      source: 'score-center',
      version: 'score-center-v1',
    };

    const first = await service.generateDailyPlanFromState('u-1', {
      ...base,
      generationKey: 'LEARNING_LOOP:u-1:2026-09-03:v1',
    });
    const second = await service.generateDailyPlanFromState('u-1', {
      ...base,
      generationKey: 'LEARNING_LOOP:u-1:2026-09-03:v2',
    });

    assert.notEqual(first.id, second.id);
    assert.equal(generationRepository.rows.size, 2);
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});
