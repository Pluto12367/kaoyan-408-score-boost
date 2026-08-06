import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMasteryReport,
  computeWeaknessReport,
  estimatePredictedScore,
} from '../packages/shared/dist/learning.js';

const knowledgePoints = [
  { id: 'ds-list', subject: '数据结构', chapter: '线性表', title: '顺序表与链表', importance: 5, frequency: 5, prerequisites: [] },
  { id: 'ds-tree', subject: '数据结构', chapter: '树与二叉树', title: '树的遍历应用', importance: 5, frequency: 5, prerequisites: [] },
  { id: 'ds-graph', subject: '数据结构', chapter: '图', title: '图的遍历与最短路', importance: 4, frequency: 4, prerequisites: [] },
  { id: 'ds-sort', subject: '数据结构', chapter: '排序', title: '排序算法比较', importance: 4, frequency: 5, prerequisites: [] },
  { id: 'co-data', subject: '计算机组成原理', chapter: '数据的表示与运算', title: '原反补码与运算', importance: 5, frequency: 5, prerequisites: [] },
  { id: 'co-cache', subject: '计算机组成原理', chapter: '存储系统', title: 'Cache 映射与替换', importance: 5, frequency: 5, prerequisites: [] },
  { id: 'co-instruction', subject: '计算机组成原理', chapter: '指令系统', title: '指令格式与寻址', importance: 4, frequency: 4, prerequisites: [] },
  { id: 'co-cpu', subject: '计算机组成原理', chapter: '中央处理器', title: '数据通路与控制', importance: 4, frequency: 4, prerequisites: [] },
  { id: 'os-process', subject: '操作系统', chapter: '进程管理', title: '进程与线程', importance: 5, frequency: 5, prerequisites: [] },
  { id: 'os-sync', subject: '操作系统', chapter: '进程管理', title: '进程同步与互斥', importance: 5, frequency: 5, prerequisites: [] },
  { id: 'os-memory', subject: '操作系统', chapter: '内存管理', title: '分页与虚拟内存', importance: 5, frequency: 5, prerequisites: [] },
  { id: 'os-file', subject: '操作系统', chapter: '文件管理', title: '文件系统结构', importance: 3, frequency: 4, prerequisites: [] },
  { id: 'net-link', subject: '计算机网络', chapter: '数据链路层', title: '差错控制与 MAC', importance: 4, frequency: 4, prerequisites: [] },
  { id: 'net-ip', subject: '计算机网络', chapter: '网络层', title: 'IP 地址与路由', importance: 5, frequency: 5, prerequisites: [] },
  { id: 'net-tcp', subject: '计算机网络', chapter: '传输层', title: 'TCP 可靠传输', importance: 4, frequency: 5, prerequisites: [] },
  { id: 'net-app', subject: '计算机网络', chapter: '应用层', title: 'HTTP 与 DNS', importance: 3, frequency: 4, prerequisites: [] },
];

function record(knowledgePointId, correct, overrides = {}) {
  return {
    knowledgePointId,
    correct,
    timeSpentSec: 90,
    expectedTimeSec: 90,
    mistakeReason: correct ? null : '概念混淆',
    submittedAt: '2026-08-01',
    ...overrides,
  };
}

test('stage 5: imported 16-point catalog produces a full mastery map', () => {
  const records = [
    record('co-cache', false),
    record('co-cache', false),
    record('net-tcp', true),
    record('os-sync', false),
  ];
  const model = computeMasteryReport({ knowledgePoints, records, targetScore: 115 });
  assert.ok(model.points.length >= 16, `expected >=16 points, got ${model.points.length}`);
  assert.ok(model.points.every((point) => point.masteryRate >= 0 && point.masteryRate <= 100));
  assert.ok(model.points.every((point) => ['weak', 'review', 'mastered'].includes(point.status)));
  const cache = model.points.find((point) => point.knowledgePointId === 'co-cache');
  assert.equal(cache.status, 'weak');
  assert.equal(cache.wrongCount, 2);
});

test('stage 5: mastery map and weakness report share the same per-point conclusion', () => {
  const records = [
    record('co-cache', false),
    record('co-cache', false),
    record('net-tcp', true),
    record('os-sync', false),
  ];
  const model = computeMasteryReport({ knowledgePoints, records, targetScore: 115 });
  const report = computeWeaknessReport({ knowledgePoints, records, targetScore: 115 });
  const reportWeakIds = new Set(report.weakPoints.map((point) => point.knowledgePointId));
  for (const point of model.points.filter((item) => item.wrongCount > 0)) {
    assert.equal(point.status, 'weak', `${point.knowledgePointId} should be weak`);
    assert.ok(reportWeakIds.has(point.knowledgePointId), `${point.knowledgePointId} should appear in weakness report`);
  }
  assert.equal(report.weakPoints[0].knowledgePointId, 'co-cache');
  assert.equal(report.accuracyRate, 25);
});

test('stage 5: extras from task completion and wrong book merge into the same model', () => {
  const extrasByPoint = new Map([
    ['co-cache', { practiceCount: 2, correctCount: 1, wrongCount: 1 }],
  ]);
  const records = [record('co-cache', false)];
  const model = computeMasteryReport({ knowledgePoints, records, targetScore: 115, extrasByPoint });
  const cache = model.points.find((point) => point.knowledgePointId === 'co-cache');
  assert.equal(cache.attempts, 3);
  assert.equal(cache.correctCount, 1);
  assert.equal(cache.wrongCount, 2);
  assert.equal(cache.status, 'weak');
});

test('stage 5: estimatePredictedScore returns a bounded range with disclaimer', () => {
  const estimate = estimatePredictedScore({ currentScore: 72, targetScore: 115, accuracyRate: 60, averageMastery: 55, remainingDays: 90 });
  assert.ok(estimate.minScore <= estimate.bestEstimate);
  assert.ok(estimate.bestEstimate <= estimate.maxScore);
  assert.ok(estimate.minScore >= 0);
  assert.ok(estimate.maxScore <= 150);
  assert.equal(estimate.disclaimer, '仅为估算');
  assert.match(estimate.basis, /正确率 60%/);
});

test('stage 5: higher mastery produces a higher predicted score', () => {
  const base = { currentScore: 60, targetScore: 120, accuracyRate: 50, remainingDays: 100 };
  const low = estimatePredictedScore({ ...base, averageMastery: 30 });
  const high = estimatePredictedScore({ ...base, averageMastery: 85 });
  assert.ok(high.bestEstimate > low.bestEstimate);
  assert.ok(high.minScore > low.minScore);
});

test('stage 5: estimatePredictedScore handles an empty baseline without crashing', () => {
  const estimate = estimatePredictedScore({ currentScore: 0, targetScore: 100, accuracyRate: 0, averageMastery: 0, remainingDays: 0 });
  assert.ok(Number.isFinite(estimate.bestEstimate));
  assert.ok(estimate.minScore <= estimate.bestEstimate);
  assert.ok(estimate.bestEstimate <= estimate.maxScore);
});