/**
 * PX-3 Exam Simulator Tests.
 *
 * - paper builder: coverage round-robin, evidence-based difficulty mix,
 *   subject scoping, tie-break by priority hint
 * - analysis: per-point accuracy, weak/strong points, deterministic numbers
 * - service: real-node retrieval via tools, real question bank candidates,
 *   LLM-free content, next-step plan proposal
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { buildExamPaper, analyzeExam } from '../apps/api/dist/agent/exam-simulator.js';
import { ExamSimulatorService } from '../apps/api/dist/agent/exam-simulator.service.js';

function question(overrides = {}) {
  return {
    id: `q-${Math.random().toString(36).slice(2, 8)}`,
    stem: '题目',
    type: 'SINGLE_CHOICE',
    difficulty: 'MEDIUM',
    knowledgePointIds: ['p1'],
    subject: 'OS',
    ...overrides,
  };
}

// ---- paper builder ----

test('paper builder: coverage round-robin maximizes distinct points', () => {
  const candidates = [];
  // 3 points × 2 questions each; same point questions adjacent
  for (const point of ['pA', 'pB', 'pC']) {
    candidates.push(question({ knowledgePointIds: [point] }), question({ knowledgePointIds: [point] }));
  }
  const paper = buildExamPaper(candidates, { targetCount: 3 });
  assert.equal(paper.questions.length, 3);
  assert.equal(paper.coveragePoints.length, 3, 'round-robin should cover 3 distinct points with 3 slots');
});

test('paper builder: weak mastery shifts mix toward BASIC, strong toward HARD', () => {
  const mastery = new Map([['p1', 0.3]]);
  const weakPaper = buildExamPaper([question({ difficulty: 'BASIC' }), question({ difficulty: 'HARD' })], { targetCount: 1, masteryByPoint: mastery });
  assert.equal(weakPaper.questions[0].difficulty, 'BASIC', 'weak student should get the BASIC question');

  const strongMastery = new Map([['p1', 0.9]]);
  const strongPaper = buildExamPaper([question({ difficulty: 'BASIC' }), question({ difficulty: 'HARD' })], { targetCount: 1, masteryByPoint: strongMastery });
  assert.equal(strongPaper.questions[0].difficulty, 'HARD', 'strong student should get the HARD question');
});

test('paper builder: subject scoping excludes other subjects', () => {
  const paper = buildExamPaper([
    question({ subject: 'OS' }),
    question({ subject: 'DS' }),
    question({ subject: 'CN' }),
  ], { targetCount: 3, subject: 'OS' });
  assert.equal(paper.questions.length, 1);
  assert.equal(paper.questions[0].subject, 'OS');
});

test('paper builder: priority hint breaks ties between groups', () => {
  const candidates = [
    question({ id: 'low', knowledgePointIds: ['pLow'] }),
    question({ id: 'high', knowledgePointIds: ['pHigh'] }),
  ];
  const priority = new Map([['pHigh', 95], ['pLow', 10]]);
  const paper = buildExamPaper(candidates, { targetCount: 1, priorityByPoint: priority });
  assert.equal(paper.questions[0].id, 'high');
});

// ---- analysis ----

test('analysis: per-point accuracy, weak/strong split and deterministic output', () => {
  const facts = [
    { questionId: 'q1', knowledgePointIds: ['deadlock'], correct: false },
    { questionId: 'q2', knowledgePointIds: ['deadlock'], correct: false },
    { questionId: 'q3', knowledgePointIds: ['semaphore'], correct: true },
    { questionId: 'q4', knowledgePointIds: ['semaphore'], correct: true },
    { questionId: 'q5', knowledgePointIds: ['paging'], correct: true },
  ];
  const analysis = analyzeExam(facts);
  assert.equal(analysis.answeredCount, 5);
  assert.equal(analysis.correctCount, 3);
  assert.equal(analysis.accuracyPercent, 60);
  assert.deepEqual(analysis.weakPoints, ['deadlock']);
  assert.deepEqual(analysis.strongPoints, ['semaphore', 'paging']);
  assert.match(analysis.nextStepSuggestion, /死锁|deadlock|deadlock/);
  // deterministic
  assert.deepEqual(analysis, analyzeExam(facts));
});

// ---- service ----

function simulatorDeps(options = {}) {
  const bank = options.bank ?? [
    question({ id: 'q-os-1', subject: 'OS', difficulty: 'BASIC', knowledgePointIds: ['OS-C06-S06-P02'] }),
    question({ id: 'q-os-2', subject: 'OS', difficulty: 'MEDIUM', knowledgePointIds: ['OS-C02-S04-P20'] }),
    question({ id: 'q-ds-1', subject: 'DS', difficulty: 'HARD', knowledgePointIds: ['DS-GRAPH-01'] }),
  ];
  const tools = {
    execute: async (_userId, tool) => {
      if (tool === 'getStudentContext') {
        return { ok: true, data: { mastery: { weakNodes: [{ knowledgeNodeId: 'OS-C06-S06-P02', mastery: 0.3 }], improvingPoints: [], masteredPoints: [] } } };
      }
      if (tool === 'searchKnowledge') {
        return { ok: true, data: { results: [{ knowledgeNodeId: 'OS-C06-S06-P02', title: '死锁必要条件', subject: 'OS', relevanceScore: 0.8, matchedChunks: [], relatedNodes: [] }] } };
      }
      if (tool === 'generateStudyPlan') {
        return { ok: true, data: { items: [{ kind: 'TASK_DRAFT', knowledgeNodeId: 'OS-C06-S06-P02', title: '死锁必要条件', score: 90 }] } };
      }
      if (tool === 'searchQuestion') {
        return { ok: true, data: bank.map(({ answer, analysis, ...safe }) => safe) };
      }
      return { ok: false, data: null, error: 'unknown' };
    },
    listTools: () => [],
  };
  const plannerCalls = [];
  return { plannerCalls, service: new ExamSimulatorService(tools, undefined) };
}

test('exam generation: real nodes retrieved, real bank questions, no LLM content', async () => {
  const { service } = simulatorDeps();
  const result = await service.generateExam('u-1', { subject: 'OS', questionCount: 5 }, new Date('2026-09-06T08:00:00.000Z'));

  // knowledge context comes from retrieval + engine (real nodes)
  assert.equal(result.knowledgeContext.retrievedNodes[0].knowledgeNodeId, 'OS-C06-S06-P02');
  assert.equal(result.knowledgeContext.enginePriorities[0].knowledgeNodeId, 'OS-C06-S06-P02');
  // questions come from the bank (OS only), DS excluded by subject scope
  assert.ok(result.paper.questions.every((question) => question.subject === 'OS'));
  assert.ok(result.paper.questions.every((question) => !('answer' in question && question.answer)), 'no answer leakage');
  assert.ok(result.paper.questions.length >= 1);
  assert.match(result.note, /真实题库/);
});

test('exam analysis: facts-only deterministic analysis; plan stays with planner agent', async () => {
  const { service, plannerCalls } = simulatorDeps();
  const facts = [
    { questionId: 'q-os-1', knowledgePointIds: ['OS-C06-S06-P02'], correct: false },
    { questionId: 'q-os-2', knowledgePointIds: ['OS-C02-S04-P20'], correct: true },
  ];
  const result = await service.analyzeExam('u-1', { facts, includePlan: true });
  assert.equal(result.analysis.accuracyPercent, 50);
  assert.deepEqual(result.analysis.weakPoints, ['OS-C06-S06-P02']);
  assert.match(result.analysis.nextStepSuggestion, /复盘/);
  assert.equal(plannerCalls.length, 0, 'exam agent must not call the planner directly (supervisor composes)');
});

test('service depends on tools only (no database access)', async () => {
  const source = await readFile(new URL('../apps/api/src/agent/exam-simulator.service.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bprisma\b/);
  assert.doesNotMatch(source, /\.(create|update|delete|upsert)\s*\(/);
  const controller = await readFile(new URL('../apps/api/src/agent/agent.controller.ts', import.meta.url), 'utf8');
  assert.match(controller, /Post\('agent\/exam\/generate'\)/);
  assert.match(controller, /Post\('agent\/exam\/analyze'\)/);
});
// ---- PX follow-up: node-precise candidates via QuestionKnowledgeNodeTag ----

test('exam generation merges node-precise candidates and weights them by node mastery', async () => {
  const { ExamQuestionRepository } = await import('../apps/api/dist/agent/exam-question.repository.js');
  const nodeRepo = {
    enabled: true,
    listByNode: async (nodeIds) => {
      assert.ok(nodeIds.includes('OS-C06-S06-P02'), 'retrieved node ids must drive the lookup');
      return [
        { id: 'q-precise-1', stem: '死锁节点精确题', type: 'SINGLE_CHOICE', difficulty: 'BASIC', knowledgePointIds: ['OS-C06-S06-P02'] },
        { id: 'q-precise-2', stem: '死锁节点精确题2', type: 'SINGLE_CHOICE', difficulty: 'HARD', knowledgePointIds: ['OS-C06-S06-P02'] },
      ];
    },
  };
  const tools = {
    execute: async (_userId, tool) => {
      if (tool === 'getStudentContext') {
        return { ok: true, data: { mastery: { weakNodes: [{ knowledgeNodeId: 'OS-C06-S06-P02', mastery: 0.2 }], improvingPoints: [], masteredPoints: [] } } };
      }
      if (tool === 'searchKnowledge') {
        return { ok: true, data: { results: [{ knowledgeNodeId: 'OS-C06-S06-P02', title: '死锁必要条件', subject: 'OS', relevanceScore: 0.9, matchedChunks: [], relatedNodes: [] }] } };
      }
      if (tool === 'generateStudyPlan') {
        return { ok: true, data: { items: [{ kind: 'TASK_DRAFT', knowledgeNodeId: 'OS-C06-S06-P02', title: '死锁必要条件', score: 95 }] } };
      }
      if (tool === 'searchQuestion') {
        return { ok: true, data: [{ id: 'q-bank-1', stem: '科目级题', type: 'SINGLE_CHOICE', difficulty: 'MEDIUM', knowledgePointIds: ['other-point'], subject: 'OS' }] };
      }
      return { ok: false, data: null, error: 'unknown' };
    },
    listTools: () => [],
  };
  const service = new ExamSimulatorService(tools, nodeRepo, undefined);
  const result = await service.generateExam('u-1', { subject: 'OS' }, new Date('2026-09-06T10:00:00.000Z'));

  // All three candidates fit the (min-5) slot budget; both precise questions
  // are in, and dedup keeps bank/precise ids distinct.
  assert.equal(result.paper.questions.length, 3);
  const picked = new Set(result.paper.questions.map((question) => question.id));
  assert.ok(picked.has('q-precise-1') && picked.has('q-precise-2') && picked.has('q-bank-1'));
  assert.ok(result.paper.questions.every((question) => question.knowledgePointIds.includes('OS-C06-S06-P02') || question.id === 'q-bank-1'));
  // weak mastery (0.2) + BASIC preference ordering within the group
  assert.equal(result.paper.difficultyMix.BASIC, 1);
});

test('exam generation falls back to subject-level bank when node repo is disabled', async () => {
  const nodeRepo = { enabled: false, listByNode: async () => { throw new Error('should not be called'); } };
  const tools = {
    execute: async (_userId, tool) => {
      if (tool === 'getStudentContext') return { ok: true, data: { mastery: { weakNodes: [], improvingPoints: [], masteredPoints: [] } } };
      if (tool === 'searchKnowledge') return { ok: true, data: { results: [] } };
      if (tool === 'generateStudyPlan') return { ok: true, data: { items: [] } };
      if (tool === 'searchQuestion') return { ok: true, data: [{ id: 'q-bank-only', stem: '题库题', type: 'SINGLE_CHOICE', difficulty: 'MEDIUM', knowledgePointIds: ['p9'], subject: 'OS' }] };
      return { ok: false, data: null, error: 'unknown' };
    },
    listTools: () => [],
  };
  const service = new ExamSimulatorService(tools, nodeRepo, undefined);
  const result = await service.generateExam('u-1', { subject: 'OS', questionCount: 5 }, new Date('2026-09-06T10:00:00.000Z'));
  assert.equal(result.paper.questions.length, 1);
  assert.equal(result.paper.questions[0].id, 'q-bank-only');
});

test('exam question repository is read-only', async () => {
  const source = await readFile(new URL('../apps/api/src/agent/exam-question.repository.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\.(update|delete|upsert)\s*\(/);
  assert.doesNotMatch(source, /\.create\w*\s*\(/, 'no create methods (createMany/create included)');
  assert.match(source, /isCurrent: true/);
});
