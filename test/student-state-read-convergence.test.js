import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

test('StudentStateQueryService builds the legacy mastery-map DTO from UserKnowledgeMastery rows', async () => {
  const { StudentStateQueryService } = require('../apps/api/src/study/student-state-query.service.ts');
  const { MasterySummaryProjectionService } = require('../apps/api/src/study/mastery-summary-projection.service.ts');
  const originalDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://unit-test/student-state-read-convergence';
  const readCalls = [];
  const writeCalls = [];
  const projectionService = new MasterySummaryProjectionService({
    userKnowledgeMastery: {
      async findMany(query) {
        readCalls.push(['userKnowledgeMastery.findMany', query]);
        return [
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
              parent: { name: '进程管理', parent: { name: '操作系统' } },
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
              parent: { name: '树与二叉树', parent: { name: '数据结构' } },
            }),
          }),
        ];
      },
      create(...args) {
        writeCalls.push(['create', args]);
        throw new Error('StudentStateQueryService must not write');
      },
      update(...args) {
        writeCalls.push(['update', args]);
        throw new Error('StudentStateQueryService must not write');
      },
      upsert(...args) {
        writeCalls.push(['upsert', args]);
        throw new Error('StudentStateQueryService must not write');
      },
      delete(...args) {
        writeCalls.push(['delete', args]);
        throw new Error('StudentStateQueryService must not write');
      },
    },
    $transaction(...args) {
      writeCalls.push(['$transaction', args]);
      throw new Error('StudentStateQueryService must not start write transactions');
    },
  });
  const service = new StudentStateQueryService(projectionService);

  try {
    const result = await service.getMasteryMapCompat('u-1', new Date('2026-08-24T00:00:00.000Z'));

    assert.equal(result.userId, 'u-1');
    assert.equal(result.title, '408 掌握度地图');
    assert.equal(result.generatedAt, '2026-08-24T00:00:00.000Z');
    assert.equal(result.subjects.length, 4);
    assert.equal(result.subjects.find((item) => item.subject === '操作系统')?.weakCount, 1);
    assert.equal(result.subjects.find((item) => item.subject === '数据结构')?.masteredCount, 1);
    assert.deepEqual(
      result.weakestPoints.map((point) => [point.knowledgePointId, point.title, point.subject]),
      [
        ['node-os-sync', '进程同步', '操作系统'],
        ['node-ds-tree', '二叉树遍历', '数据结构'],
      ],
    );
    assert.deepEqual(writeCalls, []);
    assert.equal(readCalls.length, 1);
    assert.deepEqual(readCalls[0][1].where, { userId: 'u-1' });
  } finally {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

test('StudentStateQueryService source stays read-only and delegates to mastery summary adapter', () => {
  const source = readFileSync('apps/api/src/study/student-state-query.service.ts', 'utf8');
  assert.match(source, /MasterySummaryProjectionService/);
  assert.match(source, /toMasteryMapDto/);
  assert.doesNotMatch(source, /buildNodeMasteryMap/);
  assert.doesNotMatch(source, /deriveNodeMasteryStatus/);
  assert.doesNotMatch(source, /\.create\s*\(/);
  assert.doesNotMatch(source, /\.update\s*\(/);
  assert.doesNotMatch(source, /\.upsert\s*\(/);
  assert.doesNotMatch(source, /\.delete\s*\(/);
  assert.doesNotMatch(source, /\$transaction\s*\(/);
  assert.doesNotMatch(source, /computeMasteryReport/);
  assert.doesNotMatch(source, /accumulateTaskProgress/);
});

test('mastery-map controller route delegates to StudentStateQueryService', () => {
  const controller = readFileSync('apps/api/src/study/study.controller.ts', 'utf8');
  assert.match(controller, /StudentStateQueryService/);
  assert.match(controller, /private readonly studentStateQuery/);
  assert.match(controller, /return this\.studentStateQuery\.getMasteryMapCompat\(this\.resolveUserId\(user, viewUserId\)\)/);
});

test('StudyModule registers StudentStateQueryService as a provider', () => {
  const moduleSource = readFileSync('apps/api/src/study/study.module.ts', 'utf8');
  assert.match(moduleSource, /StudentStateQueryService/);
  assert.match(moduleSource, /providers:\s*\[[\s\S]*StudentStateQueryService/);
});

function masteryRow(overrides = {}) {
  return {
    knowledgeNodeId: 'node-1',
    mastery: 0.5,
    attempts: 0,
    correctCount: 0,
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
    parent: { name: '线性表', parent: { name: '数据结构' } },
    ...overrides,
  };
}
