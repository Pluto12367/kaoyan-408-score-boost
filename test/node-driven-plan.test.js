import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNodeDrivenDailyTasks } from '@kaoyan408/shared';

const NODES = [
  { knowledgeNodeId: 'DS-C02-S01-P01', subject: '数据结构', chapter: '线性表', title: '线性表定义', importance: 5, difficulty: 3, recent3Frequency: 4, recent5Frequency: 4, allTimeEvidence: 4, primaryScore5y: 8, trendDirection: 'RISING', trendDelta: 0.3, evidenceConfidence: 'HIGH' },
  { knowledgeNodeId: 'OS-C02-S04-P20', subject: '操作系统', chapter: '同步与互斥', title: '信号量', importance: 5, difficulty: 3, recent3Frequency: 5, recent5Frequency: 5, allTimeEvidence: 5, primaryScore5y: 12, trendDirection: 'STABLE', trendDelta: 0, evidenceConfidence: 'HIGH' },
  { knowledgeNodeId: 'CN-C05-S03-P07', subject: '计算机网络', chapter: '传输层', title: 'TCP', importance: 4, difficulty: 4, recent3Frequency: 2, recent5Frequency: 2, allTimeEvidence: 3, primaryScore5y: 4, trendDirection: 'COLD', trendDelta: -0.2, evidenceConfidence: 'MEDIUM' },
];

const MASTERY_ROWS = [
  { knowledgeNodeId: 'DS-C02-S01-P01', subject: '数据结构', chapter: '线性表', title: '线性表定义', importance: 5, frequency: 4, mastery: 0.8, attempts: 6, correctCount: 5, wrongCount: 1, status: 'mastered' },
  { knowledgeNodeId: 'OS-C02-S04-P20', subject: '操作系统', chapter: '同步与互斥', title: '信号量', importance: 5, frequency: 5, mastery: 0.2, attempts: 8, correctCount: 2, wrongCount: 6, status: 'weak' },
  { knowledgeNodeId: 'CN-C05-S03-P07', subject: '计算机网络', chapter: '传输层', title: 'TCP', importance: 4, frequency: 2, mastery: 0.5, attempts: 0, correctCount: 0, wrongCount: 0, status: 'untouched' },
];

test('buildNodeDrivenDailyTasks prioritizes weak high-frequency nodes with node ids', async () => {
  const tasks = buildNodeDrivenDailyTasks({
    nodes: NODES,
    masteryRows: MASTERY_ROWS,
    targetScore: 115,
    remainingDays: 96,
    dailyHours: 3.5,
    stage: '强化',
  });
  assert(tasks.length > 0);
  assert.equal(tasks[0].knowledgePointId, 'OS-C02-S04-P20');
  assert.match(tasks[0].knowledgePointId, /^[A-Z]{2}-C\d/);
  assert(tasks.every((task) => /^[A-Z]{2}-C\d/.test(task.knowledgePointId)), 'every task should carry an atomic node id');
  assert(tasks.every((task) => typeof task.reason === 'string' && task.reason.length > 0), 'tasks should carry a readable reason');
  assert(tasks.every((task) => task.minutes > 0 && task.questionCount > 0), 'tasks should carry minutes and question counts');
  assert(tasks.every((task) => ['基础例题', '专项训练', '阶段巩固'].includes(task.mode)), 'tasks should use question-launchable modes');
  const totalMinutes = tasks.reduce((sum, task) => sum + task.minutes, 0);
  assert(totalMinutes <= 180, `daily plan minutes should fit the available budget, got ${totalMinutes}`);
});

test('buildNodeDrivenDailyTasks handles an empty catalog', async () => {
  const tasks = buildNodeDrivenDailyTasks({
    nodes: [],
    masteryRows: [],
    targetScore: 115,
    remainingDays: 96,
    dailyHours: 3.5,
    stage: '强化',
  });
  assert.deepEqual(tasks, []);
});
