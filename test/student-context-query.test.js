import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

function loadQueryService() {
  try {
    return require('../apps/api/src/study/student-context.query.service.ts');
  } catch (_error) {
    return null;
  }
}

const asOf = new Date('2026-08-24T08:00:00.000Z');

function createDependencies() {
  const calls = { state: [], practice: [], wrong: [], plan: [], assessment: [] };
  return {
    calls,
    state: {
      getSnapshot: async (...args) => {
        calls.state.push(args);
        return {
          userId: 'u-1',
          asOf: asOf.toISOString(),
          goal: { targetSchool: 'BUPT', targetScore: 120, currentScore: 80, dailyHours: 4, remainingDays: 100, stage: '强化', weakestSubject: '操作系统', diagnosis: '进程薄弱', examYear: 2027, onboardingCompletedAt: null },
          mastery: { source: 'user_knowledge_mastery', nodeCount: 1, practicedNodeCount: 1, averageMastery: 40, weakCount: 1, reviewCount: 0, masteredCount: 0, lastUpdatedAt: '2026-08-23T01:00:00.000Z' },
          weakPoints: [{ knowledgeNodeId: 'node-1', subject: '操作系统', chapter: '进程', title: '调度', masteryRate: 40, accuracyRate: 50, attempts: 2, wrongCount: 1 }],
          wrongQuestionSummary: { total: 1, unresolved: 1, reviewed: 0, resolved: 0, latestWrongAt: '2026-08-23T01:00:00.000Z' },
          reviewDue: { dueCount: 1, overdueCount: 1, nextReviewAt: '2026-08-23T00:00:00.000Z', items: [{ questionId: 'q-1', nextReviewAt: '2026-08-23T00:00:00.000Z', reviewCount: 1, stability: 'learning', overdue: true }] },
          studyTasks: { today: [], counts: { pending: 0, inProgress: 0, postponed: 0, completed: 0 } },
          assessmentSummary: { attemptCount: 0, bestScore: 0, latestAccuracyRate: 0, improvementText: '' },
        };
      },
    },
    practice: {
      getFacts: async (...args) => {
        calls.practice.push(args);
        return { source: 'practice_record', totalCount: 1, todayCount: 1, correctCount: 1, accuracy: 1, lastPracticeAt: '2026-08-23T01:00:00.000Z', studyDuration: 120, latestSubmittedAt: '2026-08-23T01:00:00.000Z', records: [{ id: 'p-1', userId: 'u-1', questionId: 'q-1', knowledgePointId: 'point-1', correct: true, timeSpentSec: 30, mistakeReason: null, submittedAt: '2026-08-23T01:00:00.000Z', variantQuestionId: null }] };
      },
    },
    wrong: {
      getSnapshot: async (...args) => {
        calls.wrong.push(args);
        return { dueItems: [{ questionId: 'q-1', knowledgePointId: 'point-1', nextReviewAt: '2026-08-23T00:00:00.000Z', stability: 'learning', reviewCount: 1, consecutiveCorrect: 0 }], currentWrongItems: [], resolvedItems: [] };
      },
    },
    plan: {
      getSnapshot: async (...args) => {
        calls.plan.push(args);
        return { planFacts: { planId: 'plan-1', phase: '强化', status: 'ACTIVE' }, taskFacts: { todayTasks: [{ id: 'task-1', title: '进程训练', status: 'pending', scheduledDate: '2026-08-24', completed: false, completedAt: null, knowledgePointId: 'point-1', minutes: 30, questionCount: 10 }], counts: { pending: 1, inProgress: 0, postponed: 0, completed: 0 } } };
      },
    },
    assessment: {
      getFacts: async (...args) => {
        calls.assessment.push(args);
        return { source: 'empty', attemptCount: 0, bestScore: null, latestScore: null, lastAssessmentAt: null, latestAccuracyRate: null, latestSubmittedAt: null, history: [] };
      },
    },
  };
}

test('StudentContextQueryService composes read sources with one explicit asOf', async () => {
  const query = loadQueryService();
  assert.ok(query, 'StudentContext query service module must exist');
  const dependencies = createDependencies();
  const service = new query.StudentContextQueryService(
    dependencies.state,
    dependencies.practice,
    dependencies.wrong,
    dependencies.plan,
    dependencies.assessment,
  );

  const context = await service.getContext('u-1', asOf);
  assert.equal(context.userId, 'u-1');
  assert.equal(context.asOf, asOf.toISOString());
  assert.equal(context.mastery.weakNodes[0].knowledgeNodeId, 'node-1');
  assert.equal(context.practice.totalCount, 1);
  assert.equal(context.review.dueCount, 1);
  assert.equal(context.plan.todayTasks[0].studyTaskId, 'task-1');
  assert.equal(context.plan.todayTasks[0].actionId, null);
  for (const key of Object.keys(dependencies.calls)) {
    assert.equal(dependencies.calls[key].length, 1, `${key} source should be read once`);
    assert.equal(dependencies.calls[key][0][0], 'u-1');
    assert.equal(dependencies.calls[key][0][1].toISOString(), asOf.toISOString());
  }
});

test('StudentContextQueryService exposes an equivalent read alias and rejects invalid asOf', async () => {
  const query = loadQueryService();
  assert.ok(query, 'StudentContext query service module must exist');
  const dependencies = createDependencies();
  const service = new query.StudentContextQueryService(dependencies.state, dependencies.practice, dependencies.wrong, dependencies.plan, dependencies.assessment);
  const first = await service.getStudentContext('u-1', asOf.toISOString());
  const second = await service.getContext('u-1', asOf.toISOString());
  assert.deepEqual(first, second);
  await assert.rejects(() => service.getContext('u-1', 'not-a-date'), /asOf/i);
});

test('StudentContextQueryService has no persistence or recommendation mutation boundary', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../apps/api/src/study/student-context.query.service.ts', import.meta.url), 'utf8').catch(() => '');
  assert.doesNotMatch(source, /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/);
  assert.doesNotMatch(source, /RecommendationService/);
  assert.doesNotMatch(source, /StudyService/);
  assert.doesNotMatch(source, /\$transaction/);
});
