import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDiagnosticProfile,
  buildStudyPlan,
  classifyMistake,
  computeWeaknessReport,
  createPracticeRecord,
  createTeacherQuestion,
  generateTutorReply,
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

test('applyDiagnosticProfile converts student input into a practical study stage', () => {
  const profile = applyDiagnosticProfile({
    targetScore: 120,
    currentScore: 62,
    remainingDays: 88,
    dailyHours: 2.5,
    weakestSubject: '操作系统',
  });

  assert.equal(profile.stage, '基础');
  assert.equal(profile.targetScore, 120);
  assert.equal(profile.remainingDays, 88);
  assert.equal(profile.dailyHours, 2.5);
  assert.equal(profile.weakestSubject, '操作系统');
  assert.match(profile.diagnosis, /先补高频基础/);
});

test('createPracticeRecord stores answer result with mistake reason and traceable timestamps', () => {
  const question = {
    id: 'q-100',
    answer: 'B',
    knowledgePointIds: ['os-sync'],
    expectedTimeSec: 100,
  };

  const record = createPracticeRecord({
    userId: 'u-001',
    question,
    selectedAnswer: 'A',
    timeSpentSec: 155,
    submittedAt: '2026-06-28',
  });

  assert.equal(record.correct, false);
  assert.equal(record.mistakeReason, '概念不清');
  assert.equal(record.knowledgePointId, 'os-sync');
  assert.equal(record.submittedAt, '2026-06-28');
});

test('generateTutorReply explains the question and recommends next actions', () => {
  const reply = generateTutorReply({
    question: {
      stem: '直接映射 Cache 中，主存块号 29 应映射到 Cache 的哪一行？',
      analysis: '直接映射行号等于主存块号对 Cache 行数取模。',
      answer: 'B',
      knowledgePointIds: ['co-cache'],
    },
    knowledgePoints,
    selectedAnswer: 'A',
  });

  assert.match(reply, /Cache映射与替换/);
  assert.match(reply, /正确答案是 B/);
  assert.match(reply, /相似题/);
});

test('createTeacherQuestion adds a valid question with generated id', () => {
  const question = createTeacherQuestion({
    stem: '页面置换算法中，LRU 的核心依据是什么？',
    options: ['未来访问', '最近最久未使用', '随机替换', '先进先出'],
    answer: 'B',
    analysis: 'LRU 根据最近最久未使用原则选择淘汰页。',
    knowledgePointIds: ['os-sync'],
    difficulty: '中',
    type: '选择题',
    source: '教研新增',
    year: 2026,
    existingCount: 4,
  });

  assert.equal(question.id, 'q-005');
  assert.equal(question.knowledgePointIds[0], 'os-sync');
});
