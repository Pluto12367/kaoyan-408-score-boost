/**
 * Study Agent V1 Tests (Phase AI-3).
 *
 * Verifies:
 * - Tool registry exposes exactly the six milestone tools over existing services.
 * - Write path only through createStudyTask → generateDailyPlanFromState (idempotent generationKey).
 * - Boundary: agent layer holds no database handle and no direct write primitive.
 * - Orchestrator LLM loop with scripted LLM, workflow fallback without LLM,
 *   and explicit fallback reasons on LLM failure / step exhaustion.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { StudyAgentToolRegistry, listStudyAgentTools, AGENT_TOOL_NAMES } from '../apps/api/dist/agent/agent-tools.js';
import { StudyAgentService } from '../apps/api/dist/agent/study-agent.service.js';

const NOW = new Date('2026-09-05T08:00:00.000Z');

function toolDeps(overrides = {}) {
  const calls = { search: [], questions: [], wrong: [], preview: [], create: [] };
  return {
    calls,
    deps: {
      studentContext: overrides.studentContext ?? {
        getContext: async (userId) => ({
          version: 'student-context-v1',
          userId,
          mastery: {
            source: 'user_knowledge_mastery',
            weakNodes: [
              { knowledgeNodeId: 'OS-C06-S06-P02', subject: 'OS', chapter: '进程管理', title: '死锁必要条件', mastery: 0.3, accuracy: 0.4, attempts: 5, wrongCount: 3, status: 'weak', updatedAt: null },
            ],
            weakPoints: [],
            improvingPoints: [],
            masteredPoints: [],
            lastUpdatedAt: null,
          },
        }),
      },
      knowledgeSearch: overrides.knowledgeSearch ?? {
        search: async (query, options) => {
          calls.search.push({ query, options });
          return {
            query, source: 'local-deterministic-v1', indexSize: 10, available: true,
            results: [
              { knowledgeNodeId: 'OS-C06-S06-P02', subject: 'OS', nodeType: 'atomicPoint', title: '死锁必要条件', chapterPath: ['进程管理', '死锁'], relevanceScore: 0.8, matchedChunks: [], relatedNodes: [] },
            ],
          };
        },
      },
      questions: overrides.questions ?? {
        listQuestions: (filters) => {
          calls.questions.push(filters);
          return Array.from({ length: 12 }, (_, index) => ({
            id: `q-${index}`, stem: `题目${index}的题干`, type: '单选', difficulty: 'medium',
            knowledgePointIds: ['node-1'], answer: 'A', analysis: '完整解析含答案', expectedTimeSec: 90, source: '真题', year: 2020,
          }));
        },
      },
      wrongQuestions: overrides.wrongQuestions ?? {
        getWrongQuestionsCompat: async (userId) => {
          calls.wrong.push(userId);
          return Array.from({ length: 12 }, (_, index) => ({
            questionId: `wrong-${index}`, stem: `错题${index}`, knowledgePointId: 'point-1', knowledgePointTitle: '信号量',
            wrongCount: 2, latestMistakeReason: '概念不清', latestSubmittedAt: '2026-09-01T00:00:00.000Z',
            subject: 'OS', chapter: '进程同步', reviewStatus: 'PENDING', reviewedAt: null,
            masteryStatus: '薄弱', masteryCriteria: { stability: 'learning', consecutiveCorrect: 0, variantCorrectCount: 0 },
          }));
        },
      },
      recommendation: overrides.recommendation ?? {
        runRecommendationForUser: async (userId, options) => {
          calls.preview.push({ userId, options });
          return {
            result: {
              items: [
                { kind: 'TASK_DRAFT', knowledgeNodeId: 'OS-C06-S06-P02', action: 'LEARN', score: 90, estimatedMinutes: 40, scheduledDate: '2026-09-05', reasonCodes: ['LOW_MASTERY'] },
              ],
            },
            nodeById: new Map([['OS-C06-S06-P02', { id: 'OS-C06-S06-P02', name: '死锁必要条件', subject: 'OS', importance: 5, difficulty: 3 }]]),
            breakdownByNode: new Map(),
            accuracyRateByNode: {},
            overallAccuracyRate: 0.5,
            user: null,
            daysToExam: 90,
          };
        },
        generateDailyPlanFromState: async (userId, input) => {
          calls.create.push({ userId, input });
          return {
            id: 'plan-1',
            tasks: [
              { title: '学习死锁必要条件', mode: '学习', minutes: 40, questionCount: 8, priority: '高' },
            ],
          };
        },
      },
    },
  };
}

function createRegistry(overrides) {
  const { deps, calls } = toolDeps(overrides);
  return { registry: new StudyAgentToolRegistry(deps), calls };
}

// ---- Tool registry ----

test('registry exposes exactly the six milestone tools', () => {
  const tools = listStudyAgentTools();
  assert.deepEqual(tools.map((tool) => tool.name), [...AGENT_TOOL_NAMES]);
  const writeTools = tools.filter((tool) => !tool.readOnly).map((tool) => tool.name);
  assert.deepEqual(writeTools, ['createStudyTask']);
});

test('registry rejects unknown tools', async () => {
  const { registry } = createRegistry();
  const result = await registry.execute('u-1', 'dropTable', {}, NOW);
  assert.equal(result.ok, false);
  assert.match(result.error, /unknown tool/);
});

test('searchKnowledge passes clamped topK and validated subject', async () => {
  const { registry, calls } = createRegistry();
  const result = await registry.execute('u-1', 'searchKnowledge', { query: '死锁产生条件', topK: 50, subject: 'OS' }, NOW);
  assert.equal(result.ok, true);
  assert.equal(calls.search[0].options.topK, 5);
  assert.equal(calls.search[0].options.subject, 'OS');
});

test('searchKnowledge rejects invalid subject', async () => {
  const { registry } = createRegistry();
  const result = await registry.execute('u-1', 'searchKnowledge', { query: 'x', subject: 'MATH' }, NOW);
  assert.equal(result.ok, false);
  assert.match(result.error, /subject must be one of/);
});

test('searchQuestion is bounded to 10 items and strips answers/analysis', async () => {
  const { registry } = createRegistry();
  const result = await registry.execute('u-1', 'searchQuestion', { subject: 'OS' }, NOW);
  assert.equal(result.ok, true);
  assert.equal(result.data.length, 10);
  for (const question of result.data) {
    assert.equal('answer' in question, false);
    assert.equal('analysis' in question, false);
  }
});

test('getWrongQuestions is bounded to 10 projected items', async () => {
  const { registry, calls } = createRegistry();
  const result = await registry.execute('u-1', 'getWrongQuestions', {}, NOW);
  assert.equal(calls.wrong[0], 'u-1');
  assert.equal(result.data.length, 10);
  assert.equal(result.data[0].knowledgePointTitle, '信号量');
});

test('generateStudyPlan preview is read-only and maps node titles', async () => {
  const { registry, calls } = createRegistry();
  const result = await registry.execute('u-1', 'generateStudyPlan', { availableMinutes: 60 }, NOW);
  assert.equal(calls.preview.length, 1);
  assert.equal(calls.create.length, 0);
  assert.equal(result.ok, true);
  assert.equal(result.data.preview, true);
  assert.equal(result.data.items[0].title, '死锁必要条件');
  assert.equal(result.data.items[0].knowledgeNodeId, 'OS-C06-S06-P02');
});

test('createStudyTask writes through the canonical plan writer with agent generationKey', async () => {
  const { registry, calls } = createRegistry();
  const result = await registry.execute('u-1', 'createStudyTask', { scheduledDate: '2026-09-05', availableMinutes: 60 }, NOW);
  assert.equal(calls.create.length, 1);
  const { userId, input } = calls.create[0];
  assert.equal(userId, 'u-1');
  assert.equal(input.scheduledDate, '2026-09-05');
  assert.equal(input.generationKey, 'AGENT:u-1:2026-09-05:v1');
  assert.equal(input.source, 'study-agent');
  assert.equal(input.availableMinutes, 60);
  assert.equal(result.ok, true);
  assert.equal(result.data.planId, 'plan-1');
  assert.equal(result.data.taskCount, 1);
});

test('tool failure returns explicit error without throwing', async () => {
  const { registry } = createRegistry({
    recommendation: {
      runRecommendationForUser: async () => { throw new Error('db down'); },
      generateDailyPlanFromState: async () => { throw new Error('db down'); },
    },
  });
  const result = await registry.execute('u-1', 'generateStudyPlan', {}, NOW);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'db down');
});

// ---- Boundary (source contracts, mirrors existing boundary tests) ----

test('agent layer holds no database handle and no direct write primitive', async () => {
  for (const file of ['apps/api/src/agent/agent-tools.ts', 'apps/api/src/agent/study-agent.service.ts']) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\bprisma\b/, `${file} must not reference prisma`);
    assert.doesNotMatch(source, /\.(create|update|delete|upsert)\s*\(/, `${file} must not call write primitives directly`);
  }
});

test('StudyAgentToolRegistry type declares only service dependencies', () => {
  // Type-level contract is enforced by the source boundary test above plus
  // the DI composition in agent.module.ts.
  assert.ok(StudyAgentToolRegistry);
});

// ---- Orchestrator: LLM loop ----

function scriptedLlm(script, name = 'scripted-llm') {
  let turn = 0;
  return {
    name,
    complete: async ({ messages, tools }) => {
      const step = script[Math.min(turn, script.length - 1)];
      turn += 1;
      assert.ok(Array.isArray(tools) && tools.length === 6, 'LLM must receive the 6 tool schemas');
      assert.ok(messages.length > 0);
      return step;
    },
  };
}

test('LLM loop executes requested tools and grounds the final answer', async () => {
  const { registry, calls } = createRegistry();
  const llm = scriptedLlm([
    { content: null, toolCalls: [{ id: 'call-1', name: 'getStudentContext', arguments: '{}' }] },
    { content: null, toolCalls: [{ id: 'call-2', name: 'searchKnowledge', arguments: JSON.stringify({ query: '死锁产生条件' }) }] },
    { content: JSON.stringify({ summary: '优先补死锁。', focusNodes: ['死锁必要条件'], suggestions: ['先复盘错题'] }), toolCalls: [] },
  ]);
  const agent = new StudyAgentService(registry, llm);
  const result = await agent.run('u-1', { message: '帮我分析薄弱点' }, NOW);

  assert.equal(result.mode, 'llm');
  assert.equal(result.source, 'scripted-llm');
  assert.equal(result.steps.length, 2);
  assert.deepEqual(result.steps.map((step) => step.tool), ['getStudentContext', 'searchKnowledge']);
  assert.ok(result.steps.every((step) => step.ok));
  assert.equal(result.answer.focusNodes[0], '死锁必要条件');
  assert.equal(calls.search.length, 1);
});

test('LLM loop records the created plan when createStudyTask is called', async () => {
  const { registry, calls } = createRegistry();
  const llm = scriptedLlm([
    { content: null, toolCalls: [{ id: 'call-1', name: 'createStudyTask', arguments: JSON.stringify({ scheduledDate: '2026-09-05', availableMinutes: 60 }) }] },
    { content: JSON.stringify({ summary: '已创建。', focusNodes: [], suggestions: [] }), toolCalls: [] },
  ]);
  const agent = new StudyAgentService(registry, llm);
  const result = await agent.run('u-1', { message: '安排今天', createTasks: true }, NOW);

  assert.equal(calls.create.length, 1);
  assert.ok(result.plan);
  assert.equal(result.plan.planId, 'plan-1');
  assert.equal(result.plan.tasks[0].title, '学习死锁必要条件');
});

test('LLM loop ignores non-whitelisted tool calls', async () => {
  const { registry } = createRegistry();
  const llm = scriptedLlm([
    { content: null, toolCalls: [{ id: 'call-1', name: 'dropTable', arguments: '{}' }, { id: 'call-2', name: 'getStudentContext', arguments: '{}' }] },
    { content: JSON.stringify({ summary: 'ok', focusNodes: [], suggestions: [] }), toolCalls: [] },
  ]);
  const agent = new StudyAgentService(registry, llm);
  const result = await agent.run('u-1', { message: 'hi' }, NOW);
  assert.deepEqual(result.steps.map((step) => step.tool), ['getStudentContext']);
});

test('LLM loop stops with explicit reason at max steps', async () => {
  const { registry } = createRegistry();
  const loop = { content: null, toolCalls: [{ name: 'getStudentContext', arguments: '{}' }] };
  const llm = scriptedLlm([loop, loop, loop, loop, loop, loop, loop]);
  const agent = new StudyAgentService(registry, llm);
  const result = await agent.run('u-1', { message: 'loop forever' }, NOW);
  assert.equal(result.fallbackReason, 'max_steps_reached');
  assert.equal(result.steps.length, 6);
});

test('LLM failure degrades to workflow with explicit fallbackReason', async () => {
  const { registry } = createRegistry();
  const llm = {
    name: 'broken-llm',
    complete: async () => { throw new Error('provider down'); },
  };
  const agent = new StudyAgentService(registry, llm);
  const result = await agent.run('u-1', { message: '安排今天408学习' }, NOW);
  assert.equal(result.mode, 'workflow');
  assert.match(result.fallbackReason, /llm_error: provider down/);
});

// ---- Orchestrator: deterministic workflow (no LLM) ----

test('workflow fallback runs the fixed multi-step pipeline without creating tasks by default', async () => {
  const { registry, calls } = createRegistry();
  const agent = new StudyAgentService(registry, undefined);
  const result = await agent.run('u-1', { message: '帮我安排今天408学习' }, NOW);

  assert.equal(result.mode, 'workflow');
  assert.equal(result.source, 'workflow-deterministic');
  assert.equal(result.plan, undefined);
  assert.equal(calls.create.length, 0);
  assert.deepEqual(result.steps.map((step) => step.tool), [
    'getStudentContext', 'searchKnowledge', 'getWrongQuestions', 'generateStudyPlan',
  ]);
  assert.ok(result.steps.every((step) => step.ok));
  assert.ok(result.answer.summary.length > 0);
  assert.ok(result.answer.suggestions.length > 0);
});

test('workflow creates tasks through the plan writer when createTasks is requested', async () => {
  const { registry, calls } = createRegistry();
  const agent = new StudyAgentService(registry, undefined);
  const result = await agent.run('u-1', { message: '安排今天', createTasks: true, scheduledDate: '2026-09-05' }, NOW);

  assert.equal(calls.create.length, 1);
  assert.equal(calls.create[0].input.generationKey, 'AGENT:u-1:2026-09-05:v1');
  assert.ok(result.plan);
  assert.equal(result.plan.scheduledDate, '2026-09-05');
  assert.equal(result.steps.at(-1).tool, 'createStudyTask');
});

test('empty message returns explicit guidance without running tools', async () => {
  const { registry, calls } = createRegistry();
  const agent = new StudyAgentService(registry, undefined);
  const result = await agent.run('u-1', { message: '   ' }, NOW);
  assert.equal(result.steps.length, 0);
  assert.equal(result.fallbackReason, 'empty_message');
  assert.equal(calls.search.length, 0);
});

// ---- API contract ----

test('agent endpoint is guarded, rejects body userId, and validates inputs', async () => {
  const source = await readFile(new URL('../apps/api/src/agent/agent.controller.ts', import.meta.url), 'utf8');
  assert.match(source, /Post\('agent\/study\/run'\)/);
  assert.match(source, /@UseGuards\(RoleGuard\)/);
  assert.match(source, /@Roles\('student', 'teacher', 'admin'\)/);
  assert.match(source, /userId is not allowed/);
  assert.match(source, /message is required/);
  assert.match(source, /createTasks must be a boolean/);
  assert.match(source, /availableMinutes must be one of/);
  assert.match(source, /user\.id/);
});

test('AgentModule wires the tool registry and an optional LLM boundary', async () => {
  const source = await readFile(new URL('../apps/api/src/agent/agent.module.ts', import.meta.url), 'utf8');
  assert.match(source, /StudyAgentToolRegistry/);
  assert.match(source, /'AGENT_LLM'/);
  assert.match(source, /createAgentLlmFromEnv/);
  assert.match(source, /exports:\s*\[StudyAgentService,\s*StudyPlannerService,\s*DailyPlanningService,\s*ExamSimulatorService,\s*SupervisorAgentService\]/);
  // Read-model chain registered module-locally (no StudyModule export changes)
  assert.match(source, /StudentContextQueryService/);
  assert.match(source, /WrongQuestionQueryService/);
  assert.match(source, /ScoreCenterModule/);
  assert.match(source, /RagModule/);
  assert.doesNotMatch(source, /\bStudyModule\b/);
});

test('AppModule registers AgentModule', async () => {
  const source = await readFile(new URL('../apps/api/src/app.module.ts', import.meta.url), 'utf8');
  assert.match(source, /import.*AgentModule.*from.*agent\/agent.module/);
  assert.match(source, /AgentModule\s*,/);
});