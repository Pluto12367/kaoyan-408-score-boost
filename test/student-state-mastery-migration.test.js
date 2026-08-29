import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

test('StudentStateProjectionService maps mastery and weakPoints through MasterySummaryProjection', async () => {
  const { StudentStateProjectionService } = require('../apps/api/src/study/student-state-projection.service.ts');
  const { MasterySummaryProjectionService, toStudentStateMasteryDto } = require('../apps/api/src/study/mastery-summary-projection.service.ts');
  const masteryRows = [
    masteryRow({
      knowledgeNodeId: 'node-os-sync',
      mastery: 0.38,
      attempts: 4,
      correctCount: 1,
      wrongCount: 3,
      updatedAt: new Date('2026-08-23T09:00:00.000Z'),
      knowledgeNode: nodeRow({
        subject: 'OS',
        name: '进程同步',
        importance: 5,
        parent: { name: '同步互斥', parent: { name: '进程管理' } },
        frequency: [{ recent3Frequency: 4 }],
      }),
    }),
    masteryRow({
      knowledgeNodeId: 'node-ds-tree',
      mastery: 0.82,
      attempts: 5,
      correctCount: 5,
      wrongCount: 0,
      updatedAt: new Date('2026-08-22T09:00:00.000Z'),
      knowledgeNode: nodeRow({
        subject: 'DS',
        name: '二叉树遍历',
        importance: 4,
        parent: { name: '遍历', parent: { name: '树与二叉树' } },
        frequency: [{ recent3Frequency: 3 }],
      }),
    }),
    masteryRow({
      knowledgeNodeId: 'node-cn-http',
      mastery: 0.1,
      attempts: 0,
      correctCount: 0,
      wrongCount: 0,
      updatedAt: new Date('2026-08-21T09:00:00.000Z'),
      knowledgeNode: nodeRow({
        subject: 'CN',
        name: 'HTTP',
        importance: 3,
        parent: { name: '应用层协议', parent: { name: '应用层' } },
        frequency: [{ recent3Frequency: 2 }],
      }),
    }),
  ];
  const calls = [];
  const prisma = createPrisma(masteryRows, calls);
  const projectionService = new MasterySummaryProjectionService(prisma);
  const service = new StudentStateProjectionService(prisma, projectionService);

  const snapshot = await withDatabaseUrl(() => service.getSnapshot('u-state', new Date('2026-08-24T00:00:00.000Z')));
  const expectedProjection = projectionService.getProjectionFromRows('u-state', projectionRows(masteryRows), new Date('2026-08-24T00:00:00.000Z'));
  const expected = toStudentStateMasteryDto(expectedProjection, '2026-08-23T09:00:00.000Z');

  assert.equal(calls.filter((call) => call === 'userKnowledgeMastery.findMany').length, 1);
  assert.deepEqual(snapshot.mastery, expected.mastery);
  assert.deepEqual(snapshot.weakPoints, expected.weakPoints);
  assert.equal(snapshot.mastery.averageMastery, 60);
  assert.equal(snapshot.mastery.practicedNodeCount, 2);
  assert.equal(snapshot.mastery.nodeCount, 3);
  assert.equal(snapshot.mastery.lastUpdatedAt, '2026-08-23T09:00:00.000Z');
  assert.equal(snapshot.weakPoints[0].subject, '操作系统');
  assert.equal(snapshot.weakPoints[0].chapter, '进程管理');
});

test('StudentStateProjectionService returns an empty mastery state without a second mastery query', async () => {
  const { StudentStateProjectionService } = require('../apps/api/src/study/student-state-projection.service.ts');
  const { MasterySummaryProjectionService } = require('../apps/api/src/study/mastery-summary-projection.service.ts');
  const calls = [];
  const prisma = createPrisma([], calls);
  const service = new StudentStateProjectionService(prisma, new MasterySummaryProjectionService(prisma));

  const snapshot = await withDatabaseUrl(() => service.getSnapshot('u-empty', new Date('2026-08-24T00:00:00.000Z')));

  assert.equal(calls.filter((call) => call === 'userKnowledgeMastery.findMany').length, 1);
  assert.deepEqual(snapshot.mastery, {
    source: 'empty',
    nodeCount: 0,
    practicedNodeCount: 0,
    averageMastery: 0,
    weakCount: 0,
    reviewCount: 0,
    masteredCount: 0,
    lastUpdatedAt: null,
  });
  assert.deepEqual(snapshot.weakPoints, []);
});

function createPrisma(masteryRows, calls) {
  return {
    user: { findUnique: async () => null },
    userKnowledgeMastery: {
      findMany: async () => {
        calls.push('userKnowledgeMastery.findMany');
        return masteryRows;
      },
    },
    practiceRecord: { findMany: async () => [] },
    wrongQuestionReview: { findMany: async () => [] },
    reviewSchedule: { findMany: async () => [] },
    studyTask: { findMany: async () => [] },
    studyTaskProgress: { findMany: async () => [] },
    assessmentHistoryItem: { findMany: async () => [] },
  };
}

async function withDatabaseUrl(run) {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://unit-test/student-state-mastery-migration';
  try {
    return await run();
  } finally {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
}

function projectionRows(rows) {
  return rows.map((row) => ({
    knowledgeNodeId: row.knowledgeNodeId,
    subject: { DS: '数据结构', OS: '操作系统', CN: '计算机网络' }[row.knowledgeNode.subject] ?? '未分类',
    chapter: row.knowledgeNode.parent?.parent?.name ?? row.knowledgeNode.parent?.name ?? '',
    title: row.knowledgeNode.name,
    importance: row.knowledgeNode.importance,
    frequency: row.knowledgeNode.frequency?.[0]?.recent3Frequency ?? row.knowledgeNode.importance,
    mastery: row.mastery,
    attempts: row.attempts,
    correctCount: row.correctCount,
    wrongCount: row.wrongCount,
    status: row.attempts === 0 ? 'untouched' : row.mastery < 0.45 ? 'weak' : row.mastery < 0.75 ? 'review' : 'mastered',
  }));
}

function masteryRow(overrides = {}) {
  return {
    knowledgeNodeId: 'node-default',
    mastery: 0.5,
    attempts: 1,
    correctCount: 1,
    wrongCount: 0,
    updatedAt: new Date('2026-08-20T09:00:00.000Z'),
    knowledgeNode: nodeRow(),
    ...overrides,
  };
}

function nodeRow(overrides = {}) {
  return {
    subject: 'DS',
    name: '线性表',
    importance: 3,
    parent: { name: '线性结构', parent: { name: '线性表' } },
    frequency: [{ recent3Frequency: 3 }],
    ...overrides,
  };
}
