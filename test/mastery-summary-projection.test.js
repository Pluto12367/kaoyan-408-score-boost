import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

test('MasterySummaryProjectionService normalizes subject and chapter from KnowledgeNode rows', async () => {
  const service = createService([
    masteryRow({
      knowledgeNodeId: 'node-os-sync',
      mastery: 0.38,
      attempts: 4,
      correctCount: 1,
      wrongCount: 3,
      knowledgeNode: nodeRow({
        subject: 'OS',
        name: '进程同步',
        importance: 5,
        parent: { name: '同步互斥', parent: { name: '进程管理' } },
        frequency: [{ recent3Frequency: 4 }],
      }),
    }),
  ]);

  const projection = await withDatabaseUrl(() => service.getProjection('u-projection', new Date('2026-08-24T00:00:00.000Z')));
  const os = projection.subjects.find((subject) => subject.subject === '操作系统');

  assert.equal(projection.userId, 'u-projection');
  assert.equal(projection.generatedAt, '2026-08-24T00:00:00.000Z');
  assert.equal(projection.source, 'user_knowledge_mastery');
  assert.equal(os.points[0].subject, '操作系统');
  assert.equal(os.points[0].chapter, '进程管理');
  assert.equal(os.points[0].frequency, 4);
});

test('MasterySummaryProjectionService averages only practiced nodes', async () => {
  const service = createService([
    masteryRow({
      knowledgeNodeId: 'node-os-weak',
      mastery: 0.4,
      attempts: 2,
      correctCount: 1,
      wrongCount: 1,
      knowledgeNode: nodeRow({ subject: 'OS', name: '进程调度' }),
    }),
    masteryRow({
      knowledgeNodeId: 'node-ds-mastered',
      mastery: 0.8,
      attempts: 5,
      correctCount: 4,
      wrongCount: 1,
      knowledgeNode: nodeRow({ subject: 'DS', name: '二叉树遍历' }),
    }),
    masteryRow({
      knowledgeNodeId: 'node-cn-untouched',
      mastery: 0.1,
      attempts: 0,
      correctCount: 0,
      wrongCount: 0,
      knowledgeNode: nodeRow({ subject: 'CN', name: 'HTTP' }),
    }),
  ]);

  const projection = await withDatabaseUrl(() => service.getProjection('u-average'));

  assert.equal(projection.nodeCount, 3);
  assert.equal(projection.practicedNodeCount, 2);
  assert.equal(projection.averageMastery, 60);
  assert.equal(projection.weakCount, 1);
  assert.equal(projection.masteredCount, 1);
  assert.equal(projection.subjects.find((subject) => subject.subject === '计算机网络').points.length, 0);
});

test('MasterySummaryProjectionService sorts weakPoints by weakest mastery, wrong count, then node id', async () => {
  const service = createService([
    masteryRow({
      knowledgeNodeId: 'node-weak-b',
      mastery: 0.35,
      attempts: 4,
      correctCount: 2,
      wrongCount: 2,
      knowledgeNode: nodeRow({ subject: 'DS', name: '栈' }),
    }),
    masteryRow({
      knowledgeNodeId: 'node-review',
      mastery: 0.55,
      attempts: 5,
      correctCount: 3,
      wrongCount: 2,
      knowledgeNode: nodeRow({ subject: 'DS', name: '队列' }),
    }),
    masteryRow({
      knowledgeNodeId: 'node-weak-a',
      mastery: 0.35,
      attempts: 4,
      correctCount: 1,
      wrongCount: 3,
      knowledgeNode: nodeRow({ subject: 'OS', name: '信号量' }),
    }),
    masteryRow({
      knowledgeNodeId: 'node-weak-c',
      mastery: 0.2,
      attempts: 5,
      correctCount: 1,
      wrongCount: 4,
      knowledgeNode: nodeRow({ subject: 'CN', name: '拥塞控制' }),
    }),
  ]);

  const projection = await withDatabaseUrl(() => service.getProjection('u-weak-sort'));

  assert.deepEqual(
    projection.weakPoints.map((point) => point.knowledgeNodeId),
    ['node-weak-c', 'node-weak-a', 'node-weak-b'],
  );
  assert.equal(projection.weakPoints[0].masteryRate, 20);
  assert.equal(projection.weakPoints[0].weaknessScore, 80);
  assert.equal(projection.weakPoints[0].practiceCount, 5);
});

test('MasterySummaryProjectionService reads only UserKnowledgeMastery rows', async () => {
  const readCalls = [];
  const service = createService([
    masteryRow({ knowledgeNode: nodeRow({ subject: 'DATA_STRUCTURE', name: '链表' }) }),
  ], readCalls);

  await withDatabaseUrl(() => service.getProjection('u-read-only'));

  assert.deepEqual(readCalls.map((call) => call.model), ['userKnowledgeMastery']);
  assert.deepEqual(readCalls[0].query.where, { userId: 'u-read-only' });
});

test('toMasteryMapDto preserves the legacy mastery-map response contract', async () => {
  const { toMasteryMapDto } = require('../apps/api/src/study/mastery-summary-projection.service.ts');
  const service = createService([
    masteryRow({
      knowledgeNodeId: 'node-os-sync',
      mastery: 0.38,
      attempts: 4,
      correctCount: 1,
      wrongCount: 3,
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
      knowledgeNode: nodeRow({
        subject: 'CN',
        name: 'HTTP',
        importance: 3,
        parent: { name: '应用层协议', parent: { name: '应用层' } },
        frequency: [{ recent3Frequency: 2 }],
      }),
    }),
  ]);

  const projection = await withDatabaseUrl(() => service.getProjection('u-contract', new Date('2026-08-24T00:00:00.000Z')));
  const masteryMap = toMasteryMapDto(projection);

  assert.deepEqual(masteryMap, {
    userId: 'u-contract',
    title: '408 掌握度地图',
    generatedAt: '2026-08-24T00:00:00.000Z',
    subjects: [
      {
        subject: '数据结构',
        averageMastery: 82,
        weakCount: 0,
        reviewCount: 0,
        masteredCount: 1,
        points: [
          {
            knowledgePointId: 'node-ds-tree',
            title: '二叉树遍历',
            chapter: '树与二叉树',
            importance: 4,
            frequency: 3,
            masteryRate: 82,
            accuracyRate: 100,
            practiceCount: 5,
            wrongCount: 0,
            status: 'mastered',
            nextAction: '建议保持节奏，定期温习',
            actionAnchor: '#question',
          },
        ],
      },
      {
        subject: '计算机组成原理',
        averageMastery: 0,
        weakCount: 0,
        reviewCount: 0,
        masteredCount: 0,
        points: [],
      },
      {
        subject: '操作系统',
        averageMastery: 38,
        weakCount: 1,
        reviewCount: 0,
        masteredCount: 0,
        points: [
          {
            knowledgePointId: 'node-os-sync',
            title: '进程同步',
            chapter: '进程管理',
            importance: 5,
            frequency: 4,
            masteryRate: 38,
            accuracyRate: 25,
            practiceCount: 4,
            wrongCount: 3,
            status: 'weak',
            nextAction: '建议回归基础，先看教材再刷题',
            actionAnchor: '#wrong-book',
          },
        ],
      },
      {
        subject: '计算机网络',
        averageMastery: 0,
        weakCount: 0,
        reviewCount: 0,
        masteredCount: 0,
        points: [],
      },
    ],
    weakestPoints: [
      {
        knowledgePointId: 'node-os-sync',
        title: '进程同步',
        chapter: '进程管理',
        importance: 5,
        frequency: 4,
        masteryRate: 38,
        accuracyRate: 25,
        practiceCount: 4,
        wrongCount: 3,
        status: 'weak',
        nextAction: '建议回归基础，先看教材再刷题',
        actionAnchor: '#wrong-book',
        subject: '操作系统',
      },
      {
        knowledgePointId: 'node-ds-tree',
        title: '二叉树遍历',
        chapter: '树与二叉树',
        importance: 4,
        frequency: 3,
        masteryRate: 82,
        accuracyRate: 100,
        practiceCount: 5,
        wrongCount: 0,
        status: 'mastered',
        nextAction: '建议保持节奏，定期温习',
        actionAnchor: '#question',
        subject: '数据结构',
      },
    ],
  });
});

function createService(rows, readCalls = []) {
  const { MasterySummaryProjectionService } = require('../apps/api/src/study/mastery-summary-projection.service.ts');
  return new MasterySummaryProjectionService({
    userKnowledgeMastery: {
      async findMany(query) {
        readCalls.push({ model: 'userKnowledgeMastery', query });
        return rows;
      },
    },
  });
}

async function withDatabaseUrl(run) {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://unit-test/mastery-summary-projection';
  try {
    return await run();
  } finally {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
}

function masteryRow(overrides = {}) {
  return {
    knowledgeNodeId: 'node-default',
    mastery: 0.5,
    attempts: 1,
    correctCount: 1,
    wrongCount: 0,
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
