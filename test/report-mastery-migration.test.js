import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

test('toReportMasteryDto overlays weakPoints and masterySummary without changing legacy fields', () => {
  const { toReportMasteryDto } = require('../apps/api/src/study/mastery-summary-projection.service.ts');
  const legacy = legacyReport();
  const migrated = toReportMasteryDto(projection(), legacy);

  assert.equal(migrated.accuracyRate, 25);
  assert.equal(migrated.completionRate, 50);
  assert.equal(migrated.speedRisks, legacy.speedRisks);
  assert.equal(migrated.mistakeReasons, legacy.mistakeReasons);
  assert.equal(migrated.estimatedGain, 12);
  assert.equal(migrated.summary, legacy.summary);
  assert.deepEqual(migrated.masterySummary, {
    source: 'user_knowledge_mastery',
    averageMastery: 60,
    nodeCount: 3,
    practicedNodeCount: 2,
    weakCount: 1,
    reviewCount: 0,
    masteredCount: 1,
  });
  assert.deepEqual(migrated.weakPoints, [
    {
      knowledgePointId: 'node-os-sync',
      knowledgeNodeId: 'node-os-sync',
      subject: '操作系统',
      chapter: '进程管理',
      title: '进程同步',
      attempts: 4,
      wrongCount: 3,
      slowCount: 0,
      accuracyRate: 25,
      topReason: null,
      suggestion: '建议回归基础概念，配合真题巩固该节点。',
      weaknessScore: 62,
    },
    {
      knowledgePointId: 'node-ds-stack',
      knowledgeNodeId: 'node-ds-stack',
      subject: '数据结构',
      chapter: '栈和队列',
      title: '栈的应用',
      attempts: 3,
      wrongCount: 2,
      slowCount: 0,
      accuracyRate: 33,
      topReason: null,
      suggestion: '先回到入栈出栈状态定义。',
      weaknessScore: 55,
    },
  ]);
});

test('toReportMasteryDto keeps the legacy report when projection is empty', () => {
  const { toReportMasteryDto } = require('../apps/api/src/study/mastery-summary-projection.service.ts');
  const legacy = legacyReport();
  const migrated = toReportMasteryDto({ ...projection(), source: 'empty', weakPoints: [] }, legacy);

  assert.equal(migrated, legacy);
});

test('StudyService report overview uses fake mastery projection for weakPoints without writes', () => {
  const { StudyService } = require('../apps/api/src/study/study.service.ts');
  const writeCalls = [];
  const projectionService = {
    getProjectionFromRows(userId) {
      assert.equal(userId, 'u-001');
      return projection();
    },
    create(...args) {
      writeCalls.push(['create', args]);
      throw new Error('projection must not write');
    },
    update(...args) {
      writeCalls.push(['update', args]);
      throw new Error('projection must not write');
    },
  };
  const service = createStudyService(projectionService);
  const baseline = createStudyService(undefined).getOverviewReport('u-001');

  const report = service.getOverviewReport('u-001');

  assert.deepEqual(report.weakPoints.map((point) => [point.knowledgePointId, point.knowledgeNodeId, point.attempts]), [
    ['node-os-sync', 'node-os-sync', 4],
    ['node-ds-stack', 'node-ds-stack', 3],
  ]);
  assert.equal(report.summary, baseline.summary);
  assert.deepEqual(report.speedRisks, baseline.speedRisks);
  assert.equal(report.accuracyRate, baseline.accuracyRate);
  assert.equal(report.completionRate, baseline.completionRate);
  assert.equal(report.estimatedGain, baseline.estimatedGain);
  assert.equal(report.masterySummary.averageMastery, 60);
  assert.deepEqual(writeCalls, []);
});

function projection() {
  return {
    userId: 'u-001',
    generatedAt: '2026-08-24T00:00:00.000Z',
    source: 'user_knowledge_mastery',
    nodeCount: 3,
    practicedNodeCount: 2,
    averageMastery: 60,
    weakCount: 1,
    reviewCount: 0,
    masteredCount: 1,
    subjects: [],
    weakPoints: [
      {
        knowledgeNodeId: 'node-os-sync',
        title: '进程同步',
        subject: '操作系统',
        chapter: '进程管理',
        importance: 5,
        frequency: 4,
        masteryRate: 38,
        accuracyRate: 25,
        practiceCount: 4,
        wrongCount: 3,
        status: 'weak',
        weaknessScore: 62,
        suggestion: '建议回归基础概念，配合真题巩固该节点。',
        topReason: null,
      },
      {
        knowledgeNodeId: 'node-ds-stack',
        title: '栈的应用',
        subject: '数据结构',
        chapter: '栈和队列',
        importance: 4,
        frequency: 3,
        masteryRate: 45,
        accuracyRate: 33,
        practiceCount: 3,
        wrongCount: 2,
        status: 'weak',
        weaknessScore: 55,
        suggestion: '先回到入栈出栈状态定义。',
        topReason: null,
      },
    ],
  };
}

function legacyReport() {
  return {
    accuracyRate: 25,
    completionRate: 50,
    weakPoints: [
      {
        knowledgePointId: 'legacy-weak',
        subject: '计算机组成原理',
        chapter: '存储系统',
        title: 'Cache',
        attempts: 2,
        wrongCount: 2,
        slowCount: 0,
        accuracyRate: 0,
        topReason: '概念混淆',
        suggestion: 'legacy suggestion',
        weaknessScore: 80,
      },
    ],
    speedRisks: [
      {
        knowledgePointId: 'legacy-speed',
        subject: '计算机网络',
        chapter: '传输层',
        title: 'TCP',
        attempts: 1,
        wrongCount: 0,
        slowCount: 1,
        accuracyRate: 100,
        topReason: null,
        suggestion: 'legacy speed suggestion',
        weaknessScore: 30,
      },
    ],
    mistakeReasons: { '概念混淆': 2 },
    estimatedGain: 12,
    summary: 'legacy summary stays',
  };
}

function createStudyService(projectionService) {
  const { StudyService } = require('../apps/api/src/study/study.service.ts');
  const unavailable = { enabled: false };
  return new StudyService(
    {
      listQuestions: () => [],
    },
    unavailable,
    { enabled: false },
    unavailable,
    unavailable,
    unavailable,
    unavailable,
    unavailable,
    unavailable,
    unavailable,
    unavailable,
    unavailable,
    unavailable,
    unavailable,
    { get: () => null },
    unavailable,
    unavailable,
    unavailable,
    { record: async () => {} },
    undefined,
    undefined,
    undefined,
    projectionService,
  );
}
