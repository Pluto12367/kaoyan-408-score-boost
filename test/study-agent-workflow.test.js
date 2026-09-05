/**
 * Study Agent Workflow Tests (Phase AI-4).
 *
 * Milestone acceptance scenario: "帮我安排今天408学习" must run the full
 * multi-step pipeline (context → mastery analysis → knowledge retrieval →
 * wrong questions → plan → optional write) and return a grounded answer.
 * Also covers the DeepSeek tool-calling adapter mapping.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { StudyAgentToolRegistry } from '../apps/api/dist/agent/agent-tools.js';
import { StudyAgentService } from '../apps/api/dist/agent/study-agent.service.js';
import { DeepSeekAgentLlm, createAgentLlmFromEnv } from '../apps/api/dist/agent/agent-llm.js';
import { DeepSeekClient } from '../apps/api/dist/study/deepseek-client.js';

const NOW = new Date('2026-09-05T09:00:00.000Z');

function acceptanceDeps() {
  const order = [];
  return {
    order,
    deps: {
      studentContext: {
        getContext: async () => {
          order.push('getStudentContext');
          return {
            version: 'student-context-v1',
            userId: 'u-1',
            mastery: {
              source: 'user_knowledge_mastery',
              weakNodes: [
                { knowledgeNodeId: 'OS-C06-S06-P02', subject: 'OS', chapter: '进程管理', title: '死锁必要条件', mastery: 0.3, accuracy: null, attempts: 6, wrongCount: 4, status: 'weak', updatedAt: null },
                { knowledgeNodeId: 'OS-C02-S04-P20', subject: 'OS', chapter: '进程同步', title: '信号量', mastery: 0.42, accuracy: 0.5, attempts: 10, wrongCount: 5, status: 'weak', updatedAt: null },
              ],
              weakPoints: [], improvingPoints: [], masteredPoints: [], lastUpdatedAt: null,
            },
            plan: { source: 'study_plan', planId: null, todayTasks: [], completion: { completedCount: 0, totalCount: 0, rate: { window: 'last7d', baseline: null, sampleSize: 0, status: 'insufficient_data', value: null } } },
          };
        },
      },
      knowledgeSearch: {
        search: async (query, options) => {
          order.push('searchKnowledge');
          assert.equal(options.topK, 3);
          return {
            query, source: 'local-deterministic-v1', indexSize: 1296, available: true,
            results: [
              { knowledgeNodeId: 'OS-C06-S06-P02', subject: 'OS', nodeType: 'atomicPoint', title: '死锁必要条件', chapterPath: ['进程管理', '死锁'], relevanceScore: 0.81, matchedChunks: [], relatedNodes: [{ knowledgeNodeId: 'OS-C06-S06-P01', title: '死锁定义', relationType: 'PREREQUISITE' }] },
              { knowledgeNodeId: 'OS-C02-S04-P20', subject: 'OS', nodeType: 'atomicPoint', title: '信号量', chapterPath: ['进程同步', '信号量'], relevanceScore: 0.74, matchedChunks: [], relatedNodes: [] },
            ],
          };
        },
      },
      questions: {
        listQuestions: () => { order.push('searchQuestion'); return []; },
      },
      wrongQuestions: {
        getWrongQuestionsCompat: async () => {
          order.push('getWrongQuestions');
          return [
            { questionId: 'w-1', stem: 'PV操作相关错题', knowledgePointId: 'point-pv', knowledgePointTitle: '信号量', wrongCount: 3, latestMistakeReason: '概念不清', latestSubmittedAt: '2026-09-04T00:00:00.000Z', subject: 'OS', chapter: '进程同步', reviewStatus: 'PENDING', reviewedAt: null, masteryStatus: '薄弱', masteryCriteria: { stability: 'learning', consecutiveCorrect: 0, variantCorrectCount: 0 } },
          ];
        },
      },
      recommendation: {
        runRecommendationForUser: async () => {
          order.push('generateStudyPlan');
          return {
            result: { items: [
              { kind: 'TASK_DRAFT', knowledgeNodeId: 'OS-C06-S06-P02', action: 'LEARN', score: 92, estimatedMinutes: 45, scheduledDate: '2026-09-05', reasonCodes: ['LOW_MASTERY', 'REPEATED_WRONG'] },
              { kind: 'TASK_DRAFT', knowledgeNodeId: 'OS-C02-S04-P20', action: 'WRONG_QUESTION', score: 88, estimatedMinutes: 30, scheduledDate: '2026-09-05', reasonCodes: ['REPEATED_WRONG'] },
            ] },
            nodeById: new Map([
              ['OS-C06-S06-P02', { id: 'OS-C06-S06-P02', name: '死锁必要条件', subject: 'OS', importance: 5, difficulty: 3 }],
              ['OS-C02-S04-P20', { id: 'OS-C02-S04-P20', name: '信号量', subject: 'OS', importance: 5, difficulty: 4 }],
            ]),
            breakdownByNode: new Map(), accuracyRateByNode: {}, overallAccuracyRate: 0.5, user: { targetScore: 120, remainingDays: 90 }, daysToExam: 90,
          };
        },
        generateDailyPlanFromState: async (userId, input) => {
          order.push('createStudyTask');
          return {
            id: 'plan-agent-1',
            tasks: [
              { title: '学习死锁必要条件', mode: '学习', minutes: 45, questionCount: 8, priority: '高' },
              { title: '错题重做：信号量', mode: '错题', minutes: 30, questionCount: 8, priority: '高' },
            ],
          };
        },
      },
    },
  };
}

test('acceptance: "帮我安排今天408学习" full pipeline without write by default', async () => {
  const { deps, order } = acceptanceDeps();
  const agent = new StudyAgentService(new StudyAgentToolRegistry(deps), undefined);
  const result = await agent.run('u-1', { message: '帮我安排今天408学习' }, NOW);

  // Read pipeline executed in order; write step NOT executed.
  assert.deepEqual(order, ['getStudentContext', 'searchKnowledge', 'getWrongQuestions', 'generateStudyPlan']);
  assert.equal(result.mode, 'workflow');
  assert.ok(result.steps.length >= 4);
  // Weak nodes feed the knowledge query (mastery analysis between step 1 and 2)
  const searchStep = result.steps.find((step) => step.tool === 'searchKnowledge');
  assert.match(searchStep.summary, /returned [1-9]/);
  // Answer grounded in retrieved data
  assert.ok(result.answer.focusNodes.includes('死锁必要条件'));
  assert.ok(result.answer.suggestions.some((item) => item.includes('信号量')));
  assert.match(result.answer.summary, /未创建任务/);
});

test('acceptance: createTasks=true runs the write step through the plan writer', async () => {
  const { deps, order } = acceptanceDeps();
  const agent = new StudyAgentService(new StudyAgentToolRegistry(deps), undefined);
  const result = await agent.run('u-1', { message: '帮我安排今天408学习', createTasks: true, scheduledDate: '2026-09-05', availableMinutes: 75 }, NOW);

  assert.deepEqual(order, ['getStudentContext', 'searchKnowledge', 'getWrongQuestions', 'generateStudyPlan', 'createStudyTask']);
  assert.ok(result.plan);
  assert.equal(result.plan.planId, 'plan-agent-1');
  assert.equal(result.plan.taskCount, 2);
  assert.equal(result.plan.tasks[0].title, '学习死锁必要条件');
  assert.match(result.answer.summary, /已通过计划写入路径创建/);
});

test('workflow degrades gracefully when tools fail (steps recorded, no throw)', async () => {
  const deps = {
    studentContext: { getContext: async () => { throw new Error('context unavailable'); } },
    knowledgeSearch: { search: async () => { throw new Error('index cold'); } },
    questions: { listQuestions: () => [] },
    wrongQuestions: { getWrongQuestionsCompat: async () => [] },
    recommendation: {
      runRecommendationForUser: async () => { throw new Error('no data'); },
      generateDailyPlanFromState: async () => { throw new Error('no data'); },
    },
  };
  const agent = new StudyAgentService(new StudyAgentToolRegistry(deps), undefined);
  const result = await agent.run('u-1', { message: '安排今天', createTasks: true }, NOW);

  assert.equal(result.mode, 'workflow');
  // Key data tools failed and are recorded with explicit errors; no throw.
  const failedSteps = result.steps.filter((step) => !step.ok);
  assert.ok(failedSteps.length >= 3, 'context/knowledge/plan steps should fail');
  for (const step of failedSteps) assert.ok(step.error);
  // getWrongQuestions legitimately succeeds with an empty list on empty deps
  const wrongStep = result.steps.find((step) => step.tool === 'getWrongQuestions');
  assert.ok(wrongStep.ok);
  // Write step still attempted through the writer (and failed there, not in agent code)
  const createStep = result.steps.find((step) => step.tool === 'createStudyTask');
  assert.ok(createStep && !createStep.ok);
  assert.ok(result.answer.suggestions.some((item) => item.includes('暂无足够数据')));
});

// ---- DeepSeekAgentLlm adapter mapping ----

test('DeepSeekAgentLlm maps agent turns to OpenAI tool protocol', async () => {
  const captured = [];
  const fakeClient = {
    chatCompletions: async (input) => {
      captured.push(input);
      return {
        content: '分析完成',
        model: 'test-model',
        toolCalls: [{ id: 'tc-1', name: 'getStudentContext', arguments: '{}' }],
      };
    },
  };
  const adapter = new DeepSeekAgentLlm(fakeClient);
  const response = await adapter.complete({
    tools: [{ type: 'function', function: { name: 'getStudentContext' } }],
    messages: [
      { role: 'system', content: 'sys' },
      { role: 'user', content: '安排今天' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'tc-1', name: 'getStudentContext', arguments: '{}' }] },
      { role: 'tool', content: '{"ok":true}', toolCallId: 'tc-1' },
    ],
  });

  assert.equal(captured.length, 1);
  const messages = captured[0].messages;
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[2].role, 'assistant');
  assert.equal(messages[2].tool_calls[0].function.name, 'getStudentContext');
  assert.equal(messages[3].role, 'tool');
  assert.equal(messages[3].tool_call_id, 'tc-1');
  assert.equal(captured[0].tools.length, 1);
  assert.equal(response.toolCalls[0].name, 'getStudentContext');
  assert.equal(response.content, '分析完成');
});

test('createAgentLlmFromEnv returns null without AI_API_KEY and an adapter with key', () => {
  const previous = process.env.AI_API_KEY;
  delete process.env.AI_API_KEY;
  try {
    assert.equal(createAgentLlmFromEnv(), null);
    process.env.AI_API_KEY = 'sk-test';
    const adapter = createAgentLlmFromEnv();
    assert.ok(adapter instanceof DeepSeekAgentLlm);
    assert.ok(adapter.name.startsWith('agent-llm:'));
  } finally {
    if (previous === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = previous;
  }
});

test('DeepSeekClient request body carries tools only when provided (backward compatible)', async () => {
  const bodies = [];
  const fakeFetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }], model: 'm' }),
    };
  };
  const client = new DeepSeekClient({ apiKey: 'sk-test', fetchImpl: fakeFetch });

  await client.chatCompletions({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal('tools' in bodies[0], false);

  await client.chatCompletions({
    messages: [{ role: 'user', content: 'hi' }],
    tools: [{ type: 'function', function: { name: 't' } }],
    toolChoice: 'auto',
  });
  assert.equal(bodies[1].tools.length, 1);
  assert.equal(bodies[1].tool_choice, 'auto');
});

test('agent controller and module source contracts (route, write authorization shape)', async () => {
  const controller = await readFile(new URL('../apps/api/src/agent/agent.controller.ts', import.meta.url), 'utf8');
  assert.match(controller, /createTasks/);
  assert.match(controller, /scheduledDate must be YYYY-MM-DD/);
  const service = await readFile(new URL('../apps/api/src/agent/study-agent.service.ts', import.meta.url), 'utf8');
  // createTasks gates the write tool in the deterministic workflow
  assert.match(service, /if \(input\.createTasks\)/);
  // LLM system prompt gates the write tool symmetrically
  assert.match(service, /用户已授权创建任务|createStudyTask 一次即可/);
});