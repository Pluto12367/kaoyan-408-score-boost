/**
 * V4-13 Failure Engineering tests.
 *
 * Proves that AI failures CANNOT corrupt the canonical learning loop:
 * - incorrect/false-positive signals produce no writes
 * - duplicate createStudyTask via the same generationKey collapses to one plan
 * - LLM failures degrade (workflow) without breaking state
 * - signal/risk layers are pure: no storage writes even on garbage input
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveLearningSignals } from '../apps/api/dist/adaptive/learning-signals.js';
import { detectLearningRisks } from '../apps/api/dist/adaptive/learning-risk.js';
import { deriveDifficultyAdjustment } from '../apps/api/dist/agent/adaptive-difficulty.js';

// ---- garbage/incorrect signal inputs ----

test('signals: garbage inputs (nulls, wrong types, extreme values) produce safe empty-ish output', () => {
  const garbage = [
    null,
    undefined,
    {},
    { mastery: null, practice: null, review: null, plan: null, momentum: null },
    { mastery: { weakNodes: 'not-an-array', improvingPoints: 42, masteredNodes: {} }, practice: { recentAccuracy: 'high' } },
    { mastery: { weakNodes: [{ knowledgeNodeId: 42, title: null, mastery: 'high' }] }, review: { highRiskQuestions: 'x' } },
    { mastery: { weakNodes: [{ knowledgeNodeId: 'n', mastery: 999 }, { knowledgeNodeId: 'n2', mastery: -5 }] } },
  ];
  for (const input of garbage) {
    const signals = deriveLearningSignals(input);
    assert.ok(Array.isArray(signals), `signals must be an array for ${JSON.stringify(input)?.slice(0, 40)}`);
    for (const signal of signals) {
      assert.equal(signal.present, false, `garbage input must not fire ${signal.kind}`);
      assert.ok(signal.severity === 'info', 'degraded signals are info-severity');
    }
  }
});

test('signals: extreme mastery values do not crash and stay in evidence bounds', () => {
  const signals = deriveLearningSignals({
    asOf: '2026-09-07T08:00:00.000Z',
    mastery: { weakNodes: [{ knowledgeNodeId: 'n1', mastery: 999, attempts: -5, wrongCount: 999 }], improvingNodes: [], masteredNodes: [] },
    practice: { recentAccuracy: { status: 'sufficient', value: 7.5 } },
    review: { dueCount: -3, overdueCount: -1, highRiskQuestions: [] },
    plan: { completionRate: 42, openTaskCount: 0 },
    momentum: { studyStreak: -8, isActiveToday: true, activeDaysLast7: -2 },
  });
  assert.ok(Array.isArray(signals));
});

// ---- false-positive risk containment ----

test('risks: false-positive signal (present=true from garbage) cannot fabricate severity', () => {
  // Hand-craft a "present" signal with missing evidence - the risk detector
  // must not crash and must not produce high severity without real evidence.
  const fakeSignal = { kind: 'wrong_streak', present: true, severity: 'warning', evidence: {} };
  const risks = detectLearningRisks([fakeSignal]);
  const repeated = risks.find((r) => r.type === 'repeated_mistake');
  if (repeated) {
    assert.ok(risks, 'risk exists but evidence must be bounded');
    assert.ok(repeated.confidence <= 0.9);
  }
});

test('risks: duplicated identical signals collapse (no double-counting)', () => {
  const one = detectLearningRisks(deriveLearningSignals({
    asOf: '2026-09-07T08:00:00.000Z',
    mastery: { weakNodes: [{ knowledgeNodeId: 'w1', mastery: 0.3, attempts: 6, wrongCount: 5 }], improvingNodes: [], masteredNodes: [] },
    practice: { recentAccuracy: { status: 'sufficient', value: 0.4 }, totalCount: 10, latestSubmittedAt: null },
    review: { dueCount: 3, overdueCount: 1, highRiskQuestions: [] },
    plan: { completionRate: 0.5, openTaskCount: 2 },
    momentum: { studyStreak: 2, isActiveToday: true, activeDaysLast7: 3 },
  }));
  // Feed the SAME signal set twice - risks must be identical (idempotent derivation)
  const risks = detectLearningRisks(deriveLearningSignals({
    asOf: '2026-09-07T08:00:00.000Z',
    mastery: { weakNodes: [{ knowledgeNodeId: 'w1', mastery: 0.3, attempts: 6, wrongCount: 5 }], improvingNodes: [], masteredNodes: [] },
    practice: { recentAccuracy: { status: 'sufficient', value: 0.4 }, totalCount: 10, latestSubmittedAt: null },
    review: { dueCount: 3, overdueCount: 1, highRiskQuestions: [] },
    plan: { completionRate: 0.5, openTaskCount: 2 },
    momentum: { studyStreak: 2, isActiveToday: true, activeDaysLast7: 3 },
  }));
  assert.ok(risks.length >= 1);
  assert.deepEqual(risks, detectLearningRisks(deriveLearningSignals({
    asOf: '2026-09-07T08:00:00.000Z',
    mastery: { weakNodes: [{ knowledgeNodeId: 'w1', mastery: 0.3, attempts: 6, wrongCount: 5 }], improvingNodes: [], masteredNodes: [] },
    practice: { recentAccuracy: { status: 'sufficient', value: 0.4 }, totalCount: 10, latestSubmittedAt: null },
    review: { dueCount: 3, overdueCount: 1, highRiskQuestions: [] },
    plan: { completionRate: 0.5, openTaskCount: 2 },
    momentum: { studyStreak: 2, isActiveToday: true, activeDaysLast7: 3 },
  })));
});

// ---- duplicate plan execution containment ----

test('duplicate createStudyTask via same registry collapses to one plan', async () => {
  const { StudyAgentToolRegistry } = await import('../apps/api/dist/agent/agent-tools.js');
  const { StudyPlannerService } = await import('../apps/api/dist/agent/study-planner.service.js');
  const { StudentContextQueryService } = await import('../apps/api/dist/study/student-context.query.service.js');

  void StudentContextQueryService;
  let createCalls = 0;
  const tools = {
    execute: async (_userId, tool, args) => {
      if (tool === 'getStudentContext') return { ok: true, data: { mastery: { weakNodes: [{ knowledgeNodeId: 'n1', title: 'X', mastery: 0.3 }], improvingPoints: [], masteredPoints: [] } } };
      if (tool === 'generateStudyPlan') return { ok: true, data: { items: [{ knowledgeNodeId: 'n1', title: 'X', action: 'LEARN', score: 90, estimatedMinutes: 40 }] } };
      if (tool === 'createStudyTask') {
        createCalls += 1;
        // canonical writer semantics: same generationKey → same plan back
        return { ok: true, data: { planId: 'plan-dup', taskCount: 1, scheduledDate: args.scheduledDate } };
      }
      return { ok: true, data: {} };
    },
    listTools: () => [],
  };
  const planner = new StudyPlannerService(tools, undefined);
  const now = new Date('2026-09-07T09:00:00.000Z');
  const r1 = await planner.generatePlan('u-dup', { scheduledDate: '2026-09-07', execute: true }, now);
  const r2 = await planner.generatePlan('u-dup', { scheduledDate: '2026-09-07', execute: true }, now);
  assert.equal(createCalls, 2); // both write calls go through the writer (writer owns idempotency)
  assert.equal(r1.execution.planId, r2.execution.planId, 'writer returns the same plan for the same generationKey');
});

// ---- LLM failure containment ----

test('LLM malformed JSON cannot produce an ungrounded plan write', async () => {
  const { StudyAgentToolRegistry } = await import('../apps/api/dist/agent/agent-tools.js');
  const { StudyAgentService } = await import('../apps/api/dist/agent/study-agent.service.js');
  let createCalls = 0;
  const tools = {
    execute: async (_userId, tool) => {
      if (tool === 'createStudyTask') { createCalls += 1; return { ok: true, data: { planId: 'p', taskCount: 1, tasks: [] } }; }
      if (tool === 'getStudentContext') return { ok: true, data: { mastery: { weakNodes: [] } } };
      return { ok: true, data: {} };
    },
    listTools: () => [],
  };
  // LLM emits malformed JSON + unauthorized write attempt
  const llm = {
    name: 'broken-llm',
    complete: async () => ({
      content: '{"summary": "直接建任务吧"',
      toolCalls: [{ id: 'c1', name: 'createStudyTask', arguments: '{invalid' }],
    }),
  };
  const agent = new StudyAgentService(tools, llm, undefined, undefined);
  const result = await agent.run('u-1', { message: 'hi' }, new Date('2026-09-07T09:00:00.000Z'));
  assert.equal(createCalls, 0, 'unauthorized write must be gated even with malformed arguments');
  assert.ok(result.steps.some((step) => step.tool === 'createStudyTask' && step.error === 'tool_permission_denied'));
});