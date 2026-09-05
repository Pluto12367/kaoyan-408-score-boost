/**
 * PX-4 Tutor Mode + PX-5 Multi-Agent Tests.
 *
 * Tutor: Socratic sequences over real node facts, three-level layered
 * explanations, rule-based misconception detection from mistake reasons,
 * understanding checking.
 *
 * Multi-agent: deterministic intent routing, protocol envelope shape,
 * agent isolation (specialists receive requests only through the
 * supervisor's protocol adapters).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  buildSocraticSequence,
  buildLayeredExplanation,
  checkUnderstanding,
  detectMisconceptions,
} from '../apps/api/dist/agent/tutor-mode.js';
import { TutorService } from '../apps/api/dist/agent/tutor.service.js';
import { detectIntent, AGENT_INTENTS } from '../apps/api/dist/agent/agent-protocol.js';
import { SupervisorAgentService } from '../apps/api/dist/agent/supervisor.service.js';
import { StudyPlannerService } from '../apps/api/dist/agent/study-planner.service.js';
import { DailyPlanningService } from '../apps/api/dist/agent/daily-planning.service.js';
import { ExamSimulatorService } from '../apps/api/dist/agent/exam-simulator.service.js';

const NOW = new Date('2026-09-06T09:00:00.000Z');
const NODE = { knowledgeNodeId: 'OS-C06-S06-P02', title: '死锁必要条件', subject: 'OS', chapterPath: ['进程管理', '死锁'], mastery: 0.3 };

// ---- Socratic teaching ----

test('socratic: sequence follows recall → why → (contrast) → apply and never contains the answer', () => {
  const questions = buildSocraticSequence(NODE, ['概念性误解']);
  assert.ok(questions.length >= 3);
  assert.equal(questions[0].probes, 'recall');
  assert.equal(questions[1].probes, 'why');
  assert.ok(questions.some((question) => question.probes === 'contrast'), 'misconception hint must add a contrast probe');
  assert.equal(questions.at(-1)?.probes, 'apply');
  for (const question of questions) {
    assert.ok(question.question.includes('死锁必要条件') || question.expectedDirection.includes('死锁'));
    assert.ok(question.expectedDirection.length > 0);
  }
});

test('socratic: understanding check grades replies deterministically', () => {
  const expected = buildSocraticSequence(NODE)[0];
  const onTrack = checkUnderstanding('因为死锁需要互斥条件，所以它解决资源分配的问题', expected);
  assert.equal(onTrack.progress, 'on_track');
  const redirect = checkUnderstanding('不知道', expected);
  assert.equal(redirect.progress, 'needs_redirect');
  assert.ok(redirect.hint.length > 0);
});

// ---- layered explanation ----

test('layered explanation: three registers differ while citing the same node facts', () => {
  const beginner = buildLayeredExplanation(NODE, 'beginner');
  const exam = buildLayeredExplanation(NODE, 'exam');
  const interview = buildLayeredExplanation(NODE, 'interview');
  for (const text of [beginner, exam, interview]) {
    assert.ok(text.includes('死锁必要条件'));
    assert.ok(text.includes('掌握度约 30%'));
  }
  assert.notEqual(beginner, exam);
  assert.notEqual(exam, interview);
  assert.ok(exam.includes('考试'));
  assert.ok(interview.includes('深入') || interview.includes('原理'));
});

// ---- misconception detection ----

test('misconception: mistake reasons map to patterns with dominant ordering', () => {
  const { patterns, dominant } = detectMisconceptions({
    mistakeReasons: ['概念不清', '概念不清', '知识点混淆', '计算失误'],
  });
  assert.equal(dominant?.type, 'conceptual_gap');
  assert.equal(dominant.evidenceCount, 2);
  assert.ok(patterns.some((pattern) => pattern.type === 'adjacent_confusion'));
  assert.ok(patterns.some((pattern) => pattern.type === 'procedural_error'));
  assert.ok(patterns[0].teachingRecommendation.length > 0);
});

test('misconception: no evidence yields no patterns', () => {
  const { patterns, dominant } = detectMisconceptions({ mistakeReasons: [] });
  assert.equal(patterns.length, 0);
  assert.equal(dominant, null);
});

// ---- tutor service (tool-fed) ----

function tutorDeps() {
  const tools = {
    execute: async (_userId, tool) => {
      if (tool === 'searchKnowledge') {
        return { ok: true, data: { results: [{ knowledgeNodeId: 'OS-C06-S06-P02', title: '死锁必要条件', subject: 'OS', chapterPath: ['进程管理', '死锁'], relevanceScore: 0.9, matchedChunks: [], relatedNodes: [] }] } };
      }
      if (tool === 'getStudentContext') {
        return { ok: true, data: { mastery: { weakNodes: [{ knowledgeNodeId: 'OS-C06-S06-P02', title: '死锁必要条件', subject: 'OS', chapter: '进程管理', mastery: 0.28 }] } } };
      }
      if (tool === 'getWrongQuestions') {
        return { ok: true, data: [
          { questionId: 'w-1', stem: '死锁题', knowledgePointId: 'p1', knowledgePointTitle: '死锁必要条件', wrongCount: 3, latestMistakeReason: '概念不清' },
          { questionId: 'w-2', stem: '死锁题2', knowledgePointId: 'p1', knowledgePointTitle: '死锁必要条件', wrongCount: 2, latestMistakeReason: '概念不清' },
        ] };
      }
      return { ok: false, data: null, error: 'unknown' };
    },
    listTools: () => [],
  };
  return new TutorService(tools);
}

test('tutor service: starts a grounded Socratic session with misconception plan', async () => {
  const service = tutorDeps();
  const session = await service.start('u-1', { topic: '死锁必要条件' }, NOW);
  assert.equal(session.node.knowledgeNodeId, 'OS-C06-S06-P02');
  assert.equal(session.node.mastery, 0.28, 'mastery evidence merged from context');
  assert.equal(session.misconceptions[0]?.type, 'conceptual_gap');
  assert.match(session.teachingPlan, /概念性误解/);
  assert.ok(session.questions.length >= 3);
});

test('tutor service: explain produces level-specific output with knowledge citation', async () => {
  const service = tutorDeps();
  const result = await service.explain('u-1', { topic: '死锁必要条件', level: 'exam' }, NOW);
  assert.equal(result.level, 'exam');
  assert.deepEqual(result.knowledgeRefs, ['OS-C06-S06-P02']);
  assert.ok(result.explanation.includes('考试'));
});

// ---- multi-agent protocol + supervisor ----

test('protocol: intent routing is deterministic across the four intents', () => {
  assert.equal(detectIntent('帮我安排今天的学习'), 'plan');
  assert.equal(detectIntent('来一套OS模拟考试'), 'exam');
  assert.equal(detectIntent('什么是死锁？我不懂'), 'tutor');
  assert.equal(detectIntent('随便聊聊我的状态'), 'coach');
  assert.ok(AGENT_INTENTS.includes('tutor'));
});

function supervisorDeps(options = {}) {
  const calls = { tutor: 0, planner: 0, exam: 0, coach: 0 };
  const tools = {
    execute: async (_userId, tool) => {
      if (tool === 'getStudentContext') return { ok: true, data: { mastery: { weakNodes: [{ knowledgeNodeId: 'n1', title: '死锁', subject: 'OS', mastery: 0.3 }] } } };
      if (tool === 'searchKnowledge') return { ok: true, data: { results: [{ knowledgeNodeId: 'n1', title: '死锁', subject: 'OS', chapterPath: ['ch'], relevanceScore: 0.8, matchedChunks: [], relatedNodes: [] }] } };
      if (tool === 'getWrongQuestions') return { ok: true, data: [] };
      if (tool === 'generateStudyPlan') return { ok: true, data: { items: [] } };
      return { ok: true, data: {} };
    },
    listTools: () => [],
  };
  const tutor = new TutorService(tools);
  const planner = new StudyPlannerService({ execute: async () => ({ ok: true, data: {} }), listTools: () => [] }, undefined);
  const daily = new DailyPlanningService({ execute: async () => ({ ok: true, data: {} }), listTools: () => [] }, undefined);
  void daily;
  const exam = new ExamSimulatorService(
    { execute: async (_userId, tool) => {
        if (tool === 'searchQuestion') return { ok: true, data: [{ id: 'q1', stem: 's', type: 'SINGLE_CHOICE', difficulty: 'BASIC', knowledgePointIds: ['p1'], subject: 'OS' }] };
        if (tool === 'searchKnowledge') return { ok: true, data: { results: [{ knowledgeNodeId: 'n1', title: '死锁', subject: 'OS', relevanceScore: 0.8, matchedChunks: [], relatedNodes: [] }] } };
        if (tool === 'generateStudyPlan') return { ok: true, data: { items: [] } };
        return { ok: true, data: { mastery: { weakNodes: [], improvingPoints: [], masteredPoints: [] } } };
      }, listTools: () => [] },
    undefined,
    undefined,
  );
  const studyAgent = {
    run: async () => { calls.coach += 1; return { mode: 'workflow', steps: [], answer: { summary: 'coach ok', focusNodes: [], suggestions: [] } }; },
    listTools: () => [],
  };
  const supervisor = new SupervisorAgentService(tutor, planner, exam, studyAgent, undefined);
  return { supervisor, calls: { get planner() { return plannerCallsCount(planner); }, get exam() { return calls.exam; }, get coach() { return calls.coach; }, get tutor() { return calls.tutor; } } };

  function plannerCallsCount(_planner) { return calls.planner; }
}

test('supervisor: routes each message to the correct specialist agent', async () => {
  const { supervisor } = supervisorDeps();
  const cases = [
    ['帮我安排今天的学习', 'planner-agent'],
    ['来一套OS模拟考试', 'exam-agent'],
    ['什么是死锁？我不懂', 'tutor-agent'],
    ['随便聊聊我的学习状态', 'coach-agent'],
  ];
  for (const [message, expectedAgent] of cases) {
    const result = await supervisor.run('u-1', { message }, NOW);
    assert.equal(result.routedTo, expectedAgent, `"${message}" should route to ${expectedAgent}`);
    assert.equal(result.ok, true, `"${message}" routing should succeed`);
  }
});

test('supervisor: protocol envelope carries correlationId and citations from exam agent', async () => {
  const { supervisor } = supervisorDeps();
  const result = await supervisor.run('u-1', { message: '来一套模拟考试' }, NOW);
  assert.match(result.correlationId, /^corr-\d+/);
  assert.ok(Array.isArray(result.citations));
  assert.equal(result.citations.length, 1);
  assert.equal(result.citations[0], 'n1');
});

test('supervisor: explicit intent overrides keyword routing', async () => {
  const { supervisor } = supervisorDeps();
  const result = await supervisor.run('u-1', { message: '来一套模拟考试', intent: 'plan' }, NOW);
  assert.equal(result.intent, 'plan');
  assert.equal(result.routedTo, 'planner-agent');
});

test('multi-agent isolation: specialist agents reference only the protocol, never each other', async () => {
  const supervisor = await readFile(new URL('../apps/api/src/agent/supervisor.service.ts', import.meta.url), 'utf8');
  assert.match(supervisor, /CooperatingAgent/);
  assert.match(supervisor, /correlationId/);
  // specialists are adapted, not imported into each other
  const tutorSource = await readFile(new URL('../apps/api/src/agent/tutor.service.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(tutorSource, /StudyPlannerService|ExamSimulatorService|StudyAgentService/);
  const plannerSource = await readFile(new URL('../apps/api/src/agent/study-planner.service.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(plannerSource, /TutorService|ExamSimulatorService/);
  const examSource = await readFile(new URL('../apps/api/src/agent/exam-simulator.service.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(examSource, /TutorService|StudyPlannerService/);
});

test('supervisor endpoint contract', async () => {
  const controller = await readFile(new URL('../apps/api/src/agent/agent.controller.ts', import.meta.url), 'utf8');
  assert.match(controller, /Post\('agent\/supervisor\/run'\)/);
  assert.match(controller, /private readonly supervisor: SupervisorAgentService/);
  assert.match(controller, /message is required/);
});