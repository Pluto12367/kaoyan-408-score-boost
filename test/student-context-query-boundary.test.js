import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

const { StudentContextQueryService } = require('../apps/api/src/study/student-context.query.service.ts');

const asOf = new Date('2026-09-05T08:00:00.000Z');

function recordingPrisma() {
  const calls = { user: [], mastery: [], sessions: [], completions: [], actions: [], points: [] };
  const row = { updatedAt: new Date('2026-09-01T00:00:00.000Z') };
  return {
    calls,
    db: {
      user: { findUnique: async (args) => { calls.user.push(args); return { name: '小明', role: 'STUDENT' }; } },
      userKnowledgeMastery: { findMany: async (args) => { calls.mastery.push(args); return [{ knowledgeNodeId: 'node-1', mastery: 0.4, attempts: 4, correctCount: 1, wrongCount: 3, updatedAt: row.updatedAt, knowledgeNode: { subject: '操作系统', name: '进程调度', parent: { name: '进程', parent: { name: '操作系统' } } } }]; } },
      learningSession: { findMany: async (args) => { calls.sessions.push(args); return []; } },
      studyTaskCompletion: { findMany: async (args) => { calls.completions.push(args); return []; } },
      recommendationAction: { findMany: async (args) => { calls.actions.push(args); return []; } },
      knowledgePoint: { findMany: async (args) => { calls.points.push(args); return [{ id: 'point-a', subject: '操作系统', chapter: '进程', title: '进程调度' }]; } },
    },
  };
}

function stubProjections() {
  return [
    { getSnapshot: async () => ({ goal: { targetScore: 120, currentScore: 80, remainingDays: 100, stage: '强化', weakestSubject: '操作系统', targetSchool: 'BUPT', diagnosis: null, examYear: 2027 }, mastery: {}, weakPoints: [], studyTasks: { today: [] } }) },
    { getFacts: async () => ({ records: [
      { id: 'p-1', knowledgePointId: 'point-a', submittedAt: '2026-09-04T00:00:00.000Z', correct: true, timeSpentSec: 60, mistakeReason: null },
      { id: 'p-2', knowledgePointId: 'point-b', submittedAt: '2026-09-03T00:00:00.000Z', correct: false, timeSpentSec: 90, mistakeReason: '概念不清' },
      { id: 'p-3', knowledgePointId: null, submittedAt: '2026-09-02T00:00:00.000Z', correct: true, timeSpentSec: 60, mistakeReason: null },
    ] }) },
    { getSnapshot: async () => ({ currentWrongItems: [], resolvedItems: [], dueItems: [] }) },
    { getSnapshot: async () => ({ planFacts: { planId: null }, taskFacts: { todayTasks: [] } }) },
    { getFacts: async () => ({}) },
  ];
}

async function buildContext() {
  const prisma = recordingPrisma();
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://test';
  try {
    const service = new StudentContextQueryService(...stubProjections(), prisma.db);
    const context = await service.getContext('u-1', asOf);
    return { context, calls: prisma.calls };
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
  }
}

test('Q6: knowledgePoint annotation query is scoped to the distinct practiced point ids', async () => {
  const { calls } = await buildContext();
  assert.equal(calls.points.length, 1);
  assert.deepEqual(calls.points[0].where, { id: { in: ['point-a', 'point-b'] } });
});

test('Q3: learning session query is bounded to the most recent 10 rows', async () => {
  const { calls } = await buildContext();
  assert.equal(calls.sessions.length, 1);
  assert.equal(calls.sessions[0].take, 10);
});

test('Q4: task completion query is bounded to the activity window (last ~8 days)', async () => {
  const { calls } = await buildContext();
  assert.equal(calls.completions.length, 1);
  const where = calls.completions[0].where;
  assert.ok(where.completedAt, 'completedAt bound missing');
  assert.ok(where.completedAt.lte, 'completedAt upper bound missing');
  const gte = new Date(where.completedAt.gte);
  const expected = new Date(asOf.getTime() - 8 * 86400000);
  assert.ok(Math.abs(gte.getTime() - expected.getTime()) < 1000, `gte should be asOf-8d, got ${gte.toISOString()}`);
});

test('Q5: recommendation action query is bounded to the most recent 200 rows', async () => {
  const { calls } = await buildContext();
  assert.equal(calls.actions.length, 1);
  assert.equal(calls.actions[0].take, 200);
});

test('context output is unchanged by the bounded reads (mastery/exam/profile still mapped)', async () => {
  const { context } = await buildContext();
  assert.equal(context.mastery.source, 'user_knowledge_mastery');
  assert.equal(context.mastery.weakNodes[0].knowledgeNodeId, 'node-1');
  assert.equal(context.exam.targetScore, 120);
  assert.equal(context.practice.totalCount, 3);
  assert.equal(context.profile.weakestSubject, '操作系统');
});
