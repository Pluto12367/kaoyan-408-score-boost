import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStudyPlan,
  classifyMistake,
  computeWeaknessReport,
  recommendPracticeSet,
  requireQuestionKnowledgePoint,
} from '../src/appLogic.js';

const knowledgePoints = [
  { id: 'ds-tree', subject: '数据结构', chapter: '树与二叉树', title: '树的遍历应用', importance: 5, frequency: 5 },
  { id: 'co-cache', subject: '计算机组成原理', chapter: '存储系统', title: 'Cache映射与替换', importance: 5, frequency: 5 },
  { id: 'os-sync', subject: '操作系统', chapter: '进程管理', title: '进程同步与互斥', importance: 5, frequency: 5 },
  { id: 'net-tcp', subject: '计算机网络', chapter: '传输层', title: 'TCP可靠传输', importance: 4, frequency: 5 },
];

const records = [
  { knowledgePointId: 'ds-tree', correct: true, timeSpentSec: 100, expectedTimeSec: 90, mistakeReason: null },
  { knowledgePointId: 'ds-tree', correct: false, timeSpentSec: 160, expectedTimeSec: 90, mistakeReason: '知识点混淆' },
  { knowledgePointId: 'co-cache', correct: false, timeSpentSec: 180, expectedTimeSec: 100, mistakeReason: '概念不清' },
  { knowledgePointId: 'co-cache', correct: false, timeSpentSec: 120, expectedTimeSec: 100, mistakeReason: '概念不清' },
  { knowledgePointId: 'os-sync', correct: false, timeSpentSec: 80, expectedTimeSec: 100, mistakeReason: '审题问题' },
  { knowledgePointId: 'net-tcp', correct: true, timeSpentSec: 190, expectedTimeSec: 100, mistakeReason: null },
  { knowledgePointId: 'net-tcp', correct: true, timeSpentSec: 170, expectedTimeSec: 100, mistakeReason: null },
];

test('buildStudyPlan prioritizes high-frequency basics for beginner students', () => {
  const plan = buildStudyPlan({
    targetScore: 110,
    remainingDays: 120,
    dailyHours: 3,
    stage: '基础',
    knowledgePoints,
    records: [],
  });

  assert.equal(plan.phase, '基础补强');
  assert.equal(plan.dailyTasks.length, 4);
  assert.deepEqual(
    plan.dailyTasks.map((task) => task.knowledgePointId),
    ['ds-tree', 'co-cache', 'os-sync', 'net-tcp'],
  );
  assert.ok(plan.dailyTasks.every((task) => task.minutes >= 35));
});

test('computeWeaknessReport finds weak chapters and speed risk separately', () => {
  const report = computeWeaknessReport({ knowledgePoints, records, targetScore: 115 });

  assert.equal(report.accuracyRate, 42.9);
  assert.equal(report.weakPoints[0].knowledgePointId, 'co-cache');
  assert.equal(report.weakPoints[0].suggestion, '强化概念辨析与映射过程');
  assert.equal(report.speedRisks[0].knowledgePointId, 'net-tcp');
  assert.match(report.summary, /预计提分空间/);
});

test('classifyMistake maps behavior to review-friendly reasons', () => {
  assert.equal(classifyMistake({ correct: false, selectedAnswer: 'A', correctAnswer: 'C', timeSpentSec: 45, expectedTimeSec: 90 }), '审题问题');
  assert.equal(classifyMistake({ correct: false, selectedAnswer: 'A', correctAnswer: 'C', timeSpentSec: 180, expectedTimeSec: 90 }), '概念不清');
  assert.equal(classifyMistake({ correct: true, selectedAnswer: 'C', correctAnswer: 'C', timeSpentSec: 160, expectedTimeSec: 90 }), '速度偏慢');
});

test('recommendPracticeSet chooses sprint review from weak and wrong questions', () => {
  const report = computeWeaknessReport({ knowledgePoints, records, targetScore: 115 });
  const recommendation = recommendPracticeSet({ stage: '冲刺', report });

  assert.equal(recommendation.title, '真题错题回炉训练');
  assert.deepEqual(recommendation.knowledgePointIds.slice(0, 3), ['co-cache', 'os-sync', 'ds-tree']);
  assert.equal(recommendation.questionCount, 20);
});

test('requireQuestionKnowledgePoint rejects questions without knowledge binding', () => {
  assert.throws(
    () => requireQuestionKnowledgePoint({ stem: 'Cache 命中率计算', knowledgePointIds: [] }),
    /至少绑定一个知识点/,
  );
});
