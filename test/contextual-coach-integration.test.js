import test from 'node:test';
import assert from 'node:assert/strict';

import { StudyController } from '../apps/api/dist/study/study.controller.js';
import { AiTutorService } from '../apps/api/dist/study/ai-tutor.service.js';
import { ContextualCoachService } from '../apps/api/dist/study/contextual-coach.service.js';
import { ContextualCoachContextAssembler } from '../apps/api/dist/study/contextual-coach-context-assembler.service.js';

const user = { id: 'user-primary', role: 'student' };

function createController(options = {}) {
  const calls = {
    state: [],
    questions: [],
    wrongQuestions: [],
    assessments: [],
    records: [],
    knowledge: [],
  };
  const assembler = new ContextualCoachContextAssembler(
    { getSnapshot: async (userId) => { calls.state.push(userId); return stateSnapshot(); } },
    { findQuestionById: async (questionId) => { calls.questions.push(questionId); return question(questionId); } },
    { getSnapshot: async (userId) => { calls.wrongQuestions.push(userId); return wrongSnapshot(); } },
    { getSnapshot: async (userId) => { calls.assessments.push(userId); return { items: options.assessments ?? assessments() }; } },
    { listByUser: async (userId) => { calls.records.push(userId); return practiceRecords(); } },
    { getKnowledgeDetail: async (userId, nodeId) => { calls.knowledge.push([userId, nodeId]); return knowledgeDetail(nodeId); } },
  );
  const previousKey = process.env.AI_API_KEY;
  delete process.env.AI_API_KEY;
  const aiTutor = new AiTutorService({ create: async () => undefined });
  if (previousKey !== undefined) process.env.AI_API_KEY = previousKey;
  const coach = new ContextualCoachService(assembler, aiTutor);
  const controller = new StudyController(...Array.from({ length: 13 }, () => ({})), coach);
  return { controller, calls };
}

function stateSnapshot() {
  return {
    goal: { targetScore: 120, currentScore: 80, dailyHours: 2, remainingDays: 100, stage: '强化', weakestSubject: '操作系统' },
    mastery: { source: 'user_knowledge_mastery', averageMastery: 62, weakCount: 1, reviewCount: 1, masteredCount: 2, lastUpdatedAt: null },
    weakPoints: [
      { knowledgeNodeId: 'node-1', title: '进程同步', masteryRate: 42 },
      { knowledgeNodeId: 'node-2', title: '分页', masteryRate: 45 },
      { knowledgeNodeId: 'node-3', title: 'TCP', masteryRate: 48 },
      { knowledgeNodeId: 'node-4', title: '文件系统', masteryRate: 50 },
    ],
    studyTasks: { today: [
      { id: 'task-1', title: '复习进程同步', status: 'pending', scheduledDate: '2026-08-30', completed: false, mode: 'review', questionCount: 5 },
      { id: 'task-2', title: '练习分页', status: 'pending', scheduledDate: '2026-08-30', completed: false, mode: 'practice', questionCount: 5 },
      { id: 'task-3', title: '练习 TCP', status: 'pending', scheduledDate: '2026-08-30', completed: false, mode: 'practice', questionCount: 5 },
      { id: 'task-4', title: '练习文件系统', status: 'pending', scheduledDate: '2026-08-30', completed: false, mode: 'practice', questionCount: 5 },
      { id: 'task-5', title: '阶段复盘', status: 'pending', scheduledDate: '2026-08-30', completed: false, mode: 'assessment', questionCount: 5 },
      { id: 'task-6', title: '不应进入上下文', status: 'pending', scheduledDate: '2026-08-30', completed: false, mode: 'practice', questionCount: 5 },
    ] },
  };
}

function question(id) {
  return { id, stem: '进程同步题', options: ['A', 'B'], answer: 'A', analysis: '标准解析', knowledgePointIds: ['node-1'] };
}

function practiceRecords() {
  return Array.from({ length: 6 }, (_, index) => ({
    questionId: index === 5 ? 'other-user-question' : 'question-1',
    correct: index === 5,
    selectedAnswer: 'B',
    mistakeReason: '概念不清',
    submittedAt: `2026-08-2${index}T00:00:00.000Z`,
  }));
}

function wrongSnapshot() {
  return {
    currentWrongItems: [{ questionId: 'wrong-1', stem: '错题题干', answer: 'A', analysis: '错题解析', knowledgePointId: 'node-1', knowledgePointTitle: '进程同步', latestCorrect: false, latestMistakeReason: '知识点混淆', wrongCount: 2, attemptCount: 3, attemptHistory: Array(6).fill({ correct: false }), reviewHistory: Array(5).fill({ reviewedAt: '2026-08-30' }) }],
    resolvedItems: [],
  };
}

function assessments() {
  return [{ id: 'assessment-latest', score: 80 }, { id: 'assessment-old', score: 70 }];
}

function knowledgeDetail(nodeId) {
  return {
    knowledgePoint: { id: nodeId, title: '进程同步', subject: '操作系统' },
    userState: { masteryRate: 42, source: 'user_knowledge_mastery' },
    frequency: { score: 3 },
    relations: { prerequisites: [], related: [] },
    relatedQuestions: [],
    examQuestions: [],
  };
}

test('question context uses authenticated user and returns explicit template fallback', async () => {
  const { controller, calls } = createController();
  const response = await controller.createContextualCoach(user, { contextType: 'question', questionId: 'question-1' });
  assert.equal(response.contextType, 'question');
  assert.equal(response.contextId, 'question-1');
  assert.equal(response.source, 'contextual-coach-template');
  assert.equal(response.fallbackReason, 'AI unavailable');
  assert.deepEqual(calls.state, ['user-primary']);
  assert.deepEqual(calls.records, ['user-primary']);
});

test('wrong question context is user-scoped and bounded', async () => {
  const { controller, calls } = createController();
  const response = await controller.createContextualCoach(user, { contextType: 'wrong_question', questionId: 'wrong-1' });
  assert.equal(response.contextType, 'wrong_question');
  assert.deepEqual(calls.wrongQuestions, ['user-primary']);
  assert.equal(response.source, 'contextual-coach-template');
});

test('knowledge node context passes the requested node to the read projection', async () => {
  const { controller, calls } = createController();
  const response = await controller.createContextualCoach(user, { contextType: 'knowledge_node', knowledgeNodeId: 'node-9' });
  assert.equal(response.contextId, 'node-9');
  assert.deepEqual(calls.knowledge, [['user-primary', 'node-9']]);
});

test('assessment context selects an explicit history item and falls back to latest', async () => {
  const { controller } = createController();
  const selected = await controller.createContextualCoach(user, { contextType: 'assessment', assessmentId: 'assessment-old' });
  const latest = await controller.createContextualCoach(user, { contextType: 'assessment', assessmentId: 'not-persisted' });
  const noId = await controller.createContextualCoach(user, { contextType: 'assessment' });
  assert.equal(selected.contextId, 'assessment-old');
  assert.equal(latest.contextId, 'not-persisted');
  assert.equal(noId.contextId, 'assessment-latest');
});

test('assessment with no history remains available as an explicit empty context', async () => {
  const { controller } = createController({ assessments: [] });
  const response = await controller.createContextualCoach(user, { contextType: 'assessment' });
  assert.equal(response.contextType, 'assessment');
  assert.equal(response.contextId, null);
  assert.equal(response.source, 'contextual-coach-template');
});

test('controller rejects a forged body userId before entering the coach chain', () => {
  const { controller } = createController();
  assert.throws(
    () => controller.createContextualCoach(user, { contextType: 'question', questionId: 'question-1', userId: 'forged-user' }),
    /userId is not allowed/i,
  );
});
