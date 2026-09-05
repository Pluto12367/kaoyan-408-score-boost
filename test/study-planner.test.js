/**
 * Study Planner + Plan Validation Tests (Phase AI-9).
 *
 * Covers the four validation rules, the planner pipeline
 * (analyze → draft → validate → optional execute), and the run-level
 * deadline guard (TD-P1).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

import { validatePlan } from '../apps/api/dist/agent/plan-validator.js';
import { StudyPlannerService } from '../apps/api/dist/agent/study-planner.service.js';
import { StudyAgentService } from '../apps/api/dist/agent/study-agent.service.js';
import { StudyAgentToolRegistry } from '../apps/api/dist/agent/agent-tools.js';

const NOW = new Date('2026-09-05T10:00:00.000Z');

function draft(overrides = {}) {
  return { knowledgeNodeId: 'node-a', title: '节点A', action: 'LEARN', score: 80, estimatedMinutes: 30, ...overrides };
}

// ---- Validator pure functions ----

test('validator removes already-mastered nodes', () => {
  const result = validatePlan({
    items: [draft(), draft({ knowledgeNodeId: 'mastered-x', title: '已掌握点' })],
    availableMinutes: 120,
    masteredNodeIds: ['mastered-x'],
  });
  assert.equal(result.validItems.length, 1);
  assert.equal(result.removed[0].reason, 'already_mastered');
  assert.equal(result.removed[0].item.knowledgeNodeId, 'mastered-x');
});

test('validator dedupes node+action keeping the higher score', () => {
  const result = validatePlan({
    items: [draft({ score: 70 }), draft({ score: 90 })],
    availableMinutes: 120,
    masteredNodeIds: [],
  });
  assert.equal(result.validItems.length, 1);
  assert.equal(result.validItems[0].score, 90);
  assert.equal(result.removed[0].reason, 'duplicate');
});

test('validator enforces the budget by dropping lowest-scored items', () => {
  const result = validatePlan({
    items: [
      draft({ knowledgeNodeId: 'n1', score: 95, estimatedMinutes: 50 }),
      draft({ knowledgeNodeId: 'n2', score: 85, estimatedMinutes: 50 }),
      draft({ knowledgeNodeId: 'n3', score: 60, estimatedMinutes: 50 }),
    ],
    availableMinutes: 100,
    masteredNodeIds: [],
  });
  assert.equal(result.validItems.length, 2);
  assert.equal(result.totalMinutes, 100);
  assert.ok(result.removed.every((entry) => entry.reason === 'over_capacity'));
  // lowest scored dropped
  assert.ok(!result.validItems.some((item) => item.knowledgeNodeId === 'n3'));
});

test('validator caps LEARN items at 3 (cognitive load)', () => {
  const result = validatePlan({
    items: [
      draft({ knowledgeNodeId: 'l1', action: 'LEARN', score: 95 }),
      draft({ knowledgeNodeId: 'l2', action: 'LEARN', score: 90 }),
      draft({ knowledgeNodeId: 'l3', action: 'LEARN', score: 85 }),
      draft({ knowledgeNodeId: 'l4', action: 'LEARN', score: 70 }),
      draft({ knowledgeNodeId: 'p1', action: 'PRACTICE', score: 80 }),
    ],
    availableMinutes: 600,
    masteredNodeIds: [],
  });
  assert.equal(result.validItems.filter((item) => item.action === 'LEARN').length, 3);
  assert.ok(result.removed.some((entry) => entry.reason === 'learn_limit' && entry.item.knowledgeNodeId === 'l4'));
  // non-LEARN items unaffected
  assert.ok(result.validItems.some((item) => item.action === 'PRACTICE'));
});

test('validator flags empty and fully-filtered plans', () => {
  const empty = validatePlan({ items: [], availableMinutes: 60, masteredNodeIds: [] });
  assert.ok(empty.violations.includes('empty_plan'));
  const allMastered = validatePlan({
    items: [draft()],
    availableMinutes: 60,
    masteredNodeIds: ['node-a'],
  });
  assert.ok(allMastered.violations.includes('nothing_left_after_validation'));
});

// ---- Planner pipeline ----

function plannerDeps(options = {}) {
  const calls = { context: 0, preview: 0, create: 0 };
  const previewItems = options.previewItems ?? [
    draft({ knowledgeNodeId: 'n1', title: '死锁必要条件', action: 'LEARN', score: 95, estimatedMinutes: 40 }),
    draft({ knowledgeNodeId: 'n2', title: '信号量', action: 'WRONG_QUESTION', score: 88, estimatedMinutes: 30 }),
  ];
  const tools = {
    execute: async (_userId, tool, args) => {
      if (tool === 'getStudentContext') {
        calls.context += 1;
        return {
          ok: true,
          data: { mastery: { masteredPoints: [{ knowledgeNodeId: 'n2', mastery: 0.9 }] } },
        };
      }
      if (tool === 'generateStudyPlan') {
        calls.preview += 1;
        return { ok: true, data: { preview: true, items: previewItems } };
      }
      if (tool === 'createStudyTask') {
        calls.create += 1;
        return { ok: true, data: { planId: 'plan-9', scheduledDate: args.scheduledDate, taskCount: 2, tasks: [] } };
      }
      return { ok: false, data: null, error: 'unknown' };
    },
    listTools: () => [],
  };
  const memory = options.memory === null ? undefined : {
    getLearningMemory: async () => ({ brief: '近期薄弱知识点：死锁必要条件' }),
  };
  return { planner: new StudyPlannerService(tools, memory), calls };
}

test('planner default is validate-only: analyzes, drafts, validates, never writes', async () => {
  const { planner, calls } = plannerDeps();
  const result = await planner.generatePlan('u-1', { availableMinutes: 60, scheduledDate: '2026-09-05' }, NOW);

  assert.equal(calls.create, 0);
  assert.equal(result.execution.executed, false);
  assert.equal(result.execution.reason, 'not_requested');
  assert.equal(result.draftItemCount, 2);
  // n2 (信号量) removed as mastered per student context
  assert.deepEqual(result.validation.removed.map((entry) => entry.knowledgeNodeId), ['n2']);
  assert.equal(result.validation.validItemCount, 1);
  assert.equal(result.validation.totalMinutes, 40);
  assert.ok(result.memoryBrief.includes('死锁必要条件'));
  assert.deepEqual(result.focusNodes, ['死锁必要条件']);
});

test('planner executes through the canonical writer only with execute=true', async () => {
  const { planner, calls } = plannerDeps();
  const result = await planner.generatePlan('u-1', { availableMinutes: 60, execute: true, scheduledDate: '2026-09-05' }, NOW);

  assert.equal(calls.create, 1);
  assert.equal(result.execution.executed, true);
  assert.equal(result.execution.planId, 'plan-9');
});

test('planner refused execution reports validation_left_no_items', async () => {
  const calls = { create: 0 };
  const tools = {
    execute: async (_userId, tool) => {
      if (tool === 'getStudentContext') {
        return { ok: true, data: { mastery: { masteredPoints: [{ knowledgeNodeId: 'n1', mastery: 0.95 }] } } };
      }
      if (tool === 'generateStudyPlan') {
        return { ok: true, data: { items: [draft({ knowledgeNodeId: 'n1' })] } };
      }
      if (tool === 'createStudyTask') { calls.create += 1; return { ok: true, data: {} }; }
      return { ok: false, data: null, error: 'unknown' };
    },
    listTools: () => [],
  };
  const planner = new StudyPlannerService(tools, undefined);
  const result = await planner.generatePlan('u-1', { execute: true }, NOW);
  assert.equal(calls.create, 0);
  assert.equal(result.execution.executed, false);
  assert.equal(result.execution.reason, 'validation_left_no_items');
});

test('planner works without memory wired (non-blocking optional)', async () => {
  const { planner } = plannerDeps({ memory: null });
  const result = await planner.generatePlan('u-1', {}, NOW);
  assert.equal(result.memoryBrief, null);
  assert.ok(result.validation.validItemCount >= 0);
});

// ---- Run deadline (TD-P1) ----

test('LLM loop returns collected steps with deadline_exceeded when time runs out', async () => {
  const slowTools = {
    execute: async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { ok: true, data: {} };
    },
    listTools: () => [],
  };
  const loop = { content: null, toolCalls: [{ name: 'getStudentContext', arguments: '{}' }] };
  const llm = {
    name: 'slow-llm',
    complete: async () => loop,
  };
  const previous = process.env.AGENT_RUN_DEADLINE_MS;
  process.env.AGENT_RUN_DEADLINE_MS = '40';
  try {
    const agent = new StudyAgentService(slowTools, llm);
    const result = await agent.run('u-1', { message: 'loop' }, NOW);
    assert.equal(result.fallbackReason, 'deadline_exceeded');
    assert.ok(result.steps.length < 6);
  } finally {
    if (previous === undefined) delete process.env.AGENT_RUN_DEADLINE_MS;
    else process.env.AGENT_RUN_DEADLINE_MS = previous;
  }
});

test('workflow skips the write step once past the deadline', async () => {
  const calls = { create: 0 };
  const slowTools = {
    execute: async (_userId, tool) => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      if (tool === 'createStudyTask') { calls.create += 1; return { ok: true, data: { planId: 'p', taskCount: 1, tasks: [] } }; }
      return { ok: true, data: tool === 'getStudentContext' ? { mastery: { weakNodes: [] } } : tool === 'searchKnowledge' ? { results: [] } : tool === 'getWrongQuestions' ? [] : { items: [] } };
    },
    listTools: () => [],
  };
  const agent = new StudyAgentService(slowTools, undefined);
  const previous = process.env.AGENT_RUN_DEADLINE_MS;
  process.env.AGENT_RUN_DEADLINE_MS = '60';
  try {
    const result = await agent.run('u-1', { message: '安排今天', createTasks: true }, NOW);
    assert.equal(calls.create, 0);
    const writeStep = result.steps.find((step) => step.tool === 'createStudyTask');
    assert.ok(writeStep);
    assert.equal(writeStep.ok, false);
    assert.equal(writeStep.error, 'deadline_exceeded');
  } finally {
    if (previous === undefined) delete process.env.AGENT_RUN_DEADLINE_MS;
    else process.env.AGENT_RUN_DEADLINE_MS = previous;
  }
});

// ---- Controller / module contracts ----

test('planner endpoint contract: guard, validation, explicit execute', async () => {
  const source = await readFile(new URL('../apps/api/src/agent/agent.controller.ts', import.meta.url), 'utf8');
  assert.match(source, /Post\('agent\/study\/plan'\)/);
  assert.match(source, /execute must be a boolean/);
  assert.match(source, /generatePlan\(user\.id/);
  assert.match(source, /private readonly studyPlanner: StudyPlannerService/);
});

test('planner adds no write primitive of its own', async () => {
  const source = await readFile(new URL('../apps/api/src/agent/study-planner.service.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bprisma\b/);
  assert.doesNotMatch(source, /\.(create|update|delete|upsert)\s*\(/);
  // writes only through the tool registry
  assert.match(source, /this\.tools\.execute\(userId, 'createStudyTask'/);
});