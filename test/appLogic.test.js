import test from 'node:test';
import assert from 'node:assert/strict';
import shared from '../packages/shared/dist/index.js';
import {
  applyDiagnosticProfile,
  buildStudyPlan,
  classifyMistake,
  computeWeaknessReport,
  createPracticeRecord,
  createTeacherQuestion,
  generateTutorReply,
  gradePracticeSessionAnswers,
  isSlowAnswer,
  normalizeMistakeReason,
  recommendPracticeSet,
  requireQuestionKnowledgePoint,
} from '../packages/shared/dist/learning.js';

const { validateFeedbackDraft } = shared;

test('validateFeedbackDraft accepts supported scenes and trims the message', () => {
  for (const scene of ['diagnostic', 'today_plan', 'practice', 'mistakes', 'exam', 'overall']) {
    const result = validateFeedbackDraft({ rating: 5, scene, message: '  今天的学习建议很具体，能直接照着执行。  ' });

    assert.deepEqual(result, {
      valid: true,
      value: { rating: 5, scene, message: '今天的学习建议很具体，能直接照着执行。' },
    });
  }
});

test('validateFeedbackDraft rejects unsupported scenes and non-integer ratings outside 1-5', () => {
  assert.equal(validateFeedbackDraft({ rating: 4, scene: 'prototype', message: '这段反馈正文长度已经足够提交。' }).errors.scene, '请选择反馈场景');

  for (const rating of [0, 1.5, 6]) {
    assert.equal(validateFeedbackDraft({ rating, scene: 'practice', message: '这段反馈正文长度已经足够提交。' }).errors.rating, '请选择 1-5 分的整数评分');
  }
});

test('validateFeedbackDraft enforces a trimmed 10-1000 Unicode character message', () => {
  const tooShort = validateFeedbackDraft({ rating: 3, scene: 'overall', message: '  123456789  ' });
  const minimumWithEmoji = validateFeedbackDraft({ rating: 3, scene: 'overall', message: '😀123456789' });
  const maximumWithEmoji = validateFeedbackDraft({ rating: 3, scene: 'overall', message: `😀${'好'.repeat(999)}` });
  const tooLong = validateFeedbackDraft({ rating: 3, scene: 'overall', message: `😀${'好'.repeat(1000)}` });

  assert.equal(tooShort.errors.message, '反馈正文需为 10-1000 个字符');
  assert.equal(minimumWithEmoji.valid, true);
  assert.equal(maximumWithEmoji.valid, true);
  assert.equal(tooLong.errors.message, '反馈正文需为 10-1000 个字符');
});

test('gradePracticeSessionAnswers scores objective and self-scored questions', () => {
  const result = gradePracticeSessionAnswers({
    questions: [
      { id: 'q-objective', answer: 'B' },
      { id: 'q-subjective', answer: '', subjective: true },
      { id: 'q-unanswered', answer: 'A' },
    ],
    answers: {
      'q-objective': { selectedAnswer: 'B', timeSpentSec: 35 },
      'q-subjective': { selectedAnswer: 'process', timeSpentSec: 120, selfScore: 7, maxScore: 10 },
    },
  });

  assert.equal(result.correctCount, 2);
  assert.equal(result.accuracyRate, 66.7);
  assert.equal(result.records.length, 3);
  assert.equal(result.records[1].gradingMode, 'self_scored');
  assert.equal(result.records[2].correct, false);
});

test('gradePracticeSessionAnswers classifies mistake reasons like the backend', () => {
  const result = gradePracticeSessionAnswers({
    questions: [
      { id: 'q-slow-wrong', answer: 'C', expectedTimeSec: 90 },
      { id: 'q-fast-wrong', answer: 'C', expectedTimeSec: 90 },
      { id: 'q-slow-correct', answer: 'B', expectedTimeSec: 90 },
      { id: 'q-no-time', answer: 'A' },
      { id: 'q-unanswered', answer: 'A', expectedTimeSec: 90 },
    ],
    answers: {
      'q-slow-wrong': { selectedAnswer: 'A', timeSpentSec: 180 },
      'q-fast-wrong': { selectedAnswer: 'A', timeSpentSec: 45 },
      'q-slow-correct': { selectedAnswer: 'B', timeSpentSec: 160 },
      'q-no-time': { selectedAnswer: 'A', timeSpentSec: 100 },
    },
  });

  assert.equal(result.records[0].mistakeReason, '概念混淆');
  assert.equal(result.records[1].mistakeReason, '审题错误');
  assert.equal(result.records[2].mistakeReason, null);
  assert.equal(result.records[3].mistakeReason, null);
  assert.equal(result.records[4].mistakeReason, null);
});

const knowledgePoints = [
  { id: 'ds-tree', subject: '数据结构', chapter: '树与二叉树', title: '树的遍历应用', importance: 5, frequency: 5 },
  { id: 'co-cache', subject: '计算机组成原理', chapter: '存储系统', title: 'Cache映射与替换', importance: 5, frequency: 5 },
  { id: 'os-sync', subject: '操作系统', chapter: '进程管理', title: '进程同步与互斥', importance: 5, frequency: 5 },
  { id: 'net-tcp', subject: '计算机网络', chapter: '传输层', title: 'TCP可靠传输', importance: 4, frequency: 5 },
];

const records = [
  { knowledgePointId: 'ds-tree', correct: true, timeSpentSec: 100, expectedTimeSec: 90, mistakeReason: null },
  { knowledgePointId: 'ds-tree', correct: false, timeSpentSec: 160, expectedTimeSec: 90, mistakeReason: '概念混淆' },
  { knowledgePointId: 'co-cache', correct: false, timeSpentSec: 180, expectedTimeSec: 100, mistakeReason: '概念混淆' },
  { knowledgePointId: 'co-cache', correct: false, timeSpentSec: 120, expectedTimeSec: 100, mistakeReason: '概念混淆' },
  { knowledgePointId: 'os-sync', correct: false, timeSpentSec: 80, expectedTimeSec: 100, mistakeReason: '审题错误' },
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
  assert.equal(report.weakPoints[0].suggestion, '建立相邻考点对比表，逐项写清区别');
  assert.equal(report.speedRisks[0].knowledgePointId, 'net-tcp');
  assert.match(report.summary, /预计提分空间/);
});

test('classifyMistake maps behavior to review-friendly reasons', () => {
  assert.equal(classifyMistake({ correct: false, selectedAnswer: 'A', correctAnswer: 'C', timeSpentSec: 45, expectedTimeSec: 90 }), '审题错误');
  assert.equal(classifyMistake({ correct: false, selectedAnswer: 'A', correctAnswer: 'C', timeSpentSec: 180, expectedTimeSec: 90 }), '概念混淆');
  assert.equal(classifyMistake({ correct: true, selectedAnswer: 'C', correctAnswer: 'C', timeSpentSec: 160, expectedTimeSec: 90 }), null);
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
  assert.equal(record.mistakeReason, '概念混淆');
  assert.equal(record.knowledgePointId, 'os-sync');
  assert.equal(record.submittedAt, '2026-06-28');
});

test('generateTutorReply explains the question and recommends next actions', () => {
  const reply = generateTutorReply({
    question: {
      stem: '直接映射 Cache（共 8 行）中，主存块号 29 应映射到 Cache 的哪一行？',
      analysis: '直接映射行号 = 主存块号 mod Cache 行数 = 29 mod 8 = 5，映射到第 5 行。',
      answer: 'C',
      knowledgePointIds: ['co-cache'],
    },
    knowledgePoints,
    selectedAnswer: 'A',
  });

  assert.match(reply, /Cache映射与替换/);
  assert.match(reply, /正确答案是 C/);
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

// ---- Additional tests for edge cases ----

test('classifyMistake returns null for correct answers regardless of speed', () => {
  assert.equal(classifyMistake({ correct: true, selectedAnswer: 'B', correctAnswer: 'B', timeSpentSec: 80, expectedTimeSec: 100 }), null);
  assert.equal(classifyMistake({ correct: true, selectedAnswer: 'C', correctAnswer: 'C', timeSpentSec: 160, expectedTimeSec: 90 }), null);
});

test('classifyMistake returns 概念混淆 for wrong answers at normal speed', () => {
  assert.equal(classifyMistake({ correct: false, selectedAnswer: 'A', correctAnswer: 'C', timeSpentSec: 95, expectedTimeSec: 100 }), '概念混淆');
});

test('classifyMistake treats confident-but-wrong answers as 知识点没学过', () => {
  assert.equal(classifyMistake({ correct: false, selectedAnswer: 'A', correctAnswer: 'C', timeSpentSec: 95, expectedTimeSec: 100, confidence: '完全不会' }), '知识点没学过');
});

test('classifyMistake treats guessed-correct answers as 蒙题 instead of mastery', () => {
  assert.equal(classifyMistake({ correct: true, selectedAnswer: 'C', correctAnswer: 'C', timeSpentSec: 60, expectedTimeSec: 100, confidence: '完全不会' }), '蒙题');
});

test('classifyMistake returns 时间不足 only for unanswered answers', () => {
  assert.equal(classifyMistake({ correct: false, selectedAnswer: '', correctAnswer: 'C', timeSpentSec: 200, expectedTimeSec: 90 }), '时间不足');
});

test('isSlowAnswer flags answers over 145% of the expected time', () => {
  assert.equal(isSlowAnswer(160, 90), true);
  assert.equal(isSlowAnswer(100, 90), false);
  assert.equal(isSlowAnswer(130, 90), false);
});

test('classifyMistake returns 推理过程错误 when a wrong answer used a hint', () => {
  assert.equal(classifyMistake({ correct: false, selectedAnswer: 'A', correctAnswer: 'C', timeSpentSec: 95, expectedTimeSec: 100, usedHint: true }), '推理过程错误');
});

test('normalizeMistakeReason maps legacy labels into the 8-class set', () => {
  assert.equal(normalizeMistakeReason('概念不清'), '概念混淆');
  assert.equal(normalizeMistakeReason('知识点混淆'), '概念混淆');
  assert.equal(normalizeMistakeReason('审题问题'), '审题错误');
  assert.equal(normalizeMistakeReason('计算失误'), '计算错误');
  assert.equal(normalizeMistakeReason('速度偏慢'), '时间不足');
  assert.equal(normalizeMistakeReason('蒙题'), '蒙题');
  assert.equal(normalizeMistakeReason('不存在的错因'), null);
  assert.equal(normalizeMistakeReason(null), null);
});
test('applyDiagnosticProfile sets 冲刺 stage when remainingDays <= 45 with adequate score', () => {
  const profile = applyDiagnosticProfile({ targetScore: 120, currentScore: 85, remainingDays: 30, dailyHours: 4, weakestSubject: '计算机网络' });
  assert.equal(profile.stage, '冲刺');
  assert.match(profile.diagnosis, /真题.*错题.*限时/);
});

test('applyDiagnosticProfile sets 强化 stage when score >= 70 and days > 45', () => {
  const profile = applyDiagnosticProfile({ targetScore: 110, currentScore: 75, remainingDays: 80, dailyHours: 3, weakestSubject: '计算机组成原理' });
  assert.equal(profile.stage, '强化');
  assert.match(profile.diagnosis, /专题突破/);
});

test('computeWeaknessReport returns 0 accuracyRate for empty records', () => {
  const report = computeWeaknessReport({ knowledgePoints, records: [], targetScore: 100 });
  assert.equal(report.accuracyRate, 0);
  assert.equal(report.weakPoints.length, 0);
  assert.equal(report.speedRisks.length, 0);
});

test('computeWeaknessReport calculates estimated gain', () => {
  const report = computeWeaknessReport({ knowledgePoints, records, targetScore: 115 });
  assert.ok(report.estimatedGain >= 8);
  assert.ok(report.estimatedGain <= 50);
});

test('buildStudyPlan generates sprint phase with higher question count', () => {
  const plan = buildStudyPlan({ targetScore: 115, remainingDays: 30, dailyHours: 4, stage: '冲刺', knowledgePoints, records });
  assert.equal(plan.phase, '真题冲刺');
  assert.equal(plan.dailyTasks[0].questionCount, 18);
});

test('buildStudyPlan sets shorter checkpoint for sprint', () => {
  const plan = buildStudyPlan({ targetScore: 115, remainingDays: 30, dailyHours: 4, stage: '冲刺', knowledgePoints, records });
  assert.match(plan.checkpoint, /每 3 天/);
});

test('recommendPracticeSet returns basic mode for low accuracy', () => {
  const report = computeWeaknessReport({ knowledgePoints, records, targetScore: 100 });
  const rec = recommendPracticeSet({ stage: '强化', report });
  assert.equal(rec.title, '高频基础考点补强');
  assert.equal(rec.questionCount, 16);
});

test('createTeacherQuestion rejects questions with fewer than 2 options', () => {
  assert.throws(
    () => createTeacherQuestion({ stem: 'Test', options: ['A'], answer: 'A', analysis: 'Test', knowledgePointIds: ['ds-tree'], difficulty: '易', type: '选择题', source: 'test', existingCount: 10 }),
    /至少需要两个选项/,
  );
});

test('createPracticeRecord uses current date when submittedAt is not provided', () => {
  const question = { id: 'q-200', answer: 'C', knowledgePointIds: ['ds-tree'], expectedTimeSec: 90 };
  const record = createPracticeRecord({ userId: 'u-001', question, selectedAnswer: 'C', timeSpentSec: 80 });
  assert.match(record.submittedAt, /^\d{4}-\d{2}-\d{2}$/);
});

test('generateTutorReply works without matching knowledge point', () => {
  const reply = generateTutorReply({
    question: { stem: 'Test', analysis: 'Test analysis', answer: 'A', knowledgePointIds: ['unknown'] },
    knowledgePoints: [],
    selectedAnswer: undefined,
  });
  assert.match(reply, /408 高频考点/);
  assert.match(reply, /正确答案是 A/);
});
