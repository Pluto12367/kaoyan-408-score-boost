import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLearningProfile } from '../packages/shared/dist/learningProfile.js';

function weakPoint(overrides = {}) {
  return {
    knowledgePointId: 'co-cache',
    subject: '计算机组成原理',
    chapter: '存储系统',
    title: 'Cache 映射与替换',
    attempts: 4,
    wrongCount: 3,
    slowCount: 1,
    accuracyRate: 25,
    topReason: '概念混淆',
    suggestion: '先对比直接映射与组相联映射。',
    weaknessScore: 92,
    ...overrides,
  };
}

function baseInput(overrides = {}) {
  return {
    userId: 'student-001',
    summary: {
      name: '张三',
      currentStage: '强化',
      targetScore: 110,
      currentScore: 72,
      weakestSubject: '计算机组成原理',
      accuracyRate: 42.9,
      streakDays: 1,
    },
    loopStats: {
      diagnosticCompleted: true,
      practiceSetCount: 2,
      stageAssessmentCount: 1,
      reviewedWrongQuestionCount: 1,
      wrongQuestionCount: 3,
    },
    timeline: [
      { id: 't1', type: 'diagnostic', title: '入学诊断完成', date: '2026-06-30', summary: '生成了基础计划。' },
    ],
    weakPoints: [weakPoint()],
    speedRisks: [],
    mistakeReasons: { '概念混淆': 3, '审题错误': 1 },
    ...overrides,
  };
}

test('buildLearningProfile marks a risky learner with weak points and hints', () => {
  const profile = buildLearningProfile(baseInput());
  assert.equal(profile.userId, 'student-001');
  assert.equal(profile.insights.learningState, 'risky');
  assert.equal(profile.insights.weakPoints[0].knowledgePointId, 'co-cache');
  assert.match(profile.insights.stateReason, /薄弱|错点/);
  assert.ok(profile.insights.focusHints.some((hint) => hint.includes('Cache 映射与替换')));
  assert.equal(profile.nextMilestone, '继续完成推荐题组，并复盘本组错因。');
});

test('buildLearningProfile recognizes a rising learner when the loop is stable', () => {
  const profile = buildLearningProfile(baseInput({
    summary: {
      name: '张三',
      currentStage: '冲刺',
      targetScore: 115,
      currentScore: 88,
      weakestSubject: '操作系统',
      accuracyRate: 82,
      streakDays: 5,
    },
    loopStats: {
      diagnosticCompleted: true,
      practiceSetCount: 6,
      stageAssessmentCount: 2,
      reviewedWrongQuestionCount: 4,
      wrongQuestionCount: 0,
    },
    weakPoints: [],
    speedRisks: [weakPoint({ knowledgePointId: 'os-sync', title: '进程同步与互斥', subject: '操作系统', wrongCount: 0, slowCount: 2, accuracyRate: 100, weaknessScore: 44 })],
    mistakeReasons: { '时间不足': 2 },
  }));
  assert.equal(profile.insights.learningState, 'rising');
  assert.ok(profile.insights.focusHints.some((hint) => hint.includes('保持错题复盘闭环')));
});

test('buildLearningProfile falls back safely with minimal data', () => {
  const profile = buildLearningProfile(baseInput({
    loopStats: {
      diagnosticCompleted: false,
      practiceSetCount: 0,
      stageAssessmentCount: 0,
      reviewedWrongQuestionCount: 0,
      wrongQuestionCount: 0,
    },
    weakPoints: undefined,
    speedRisks: undefined,
    mistakeReasons: undefined,
  }));
  assert.equal(profile.insights.learningState, 'risky');
  assert.equal(profile.insights.weakPoints.length, 0);
  assert.equal(profile.insights.speedRisks.length, 0);
  assert.deepEqual(profile.insights.mistakeReasons, []);
});
