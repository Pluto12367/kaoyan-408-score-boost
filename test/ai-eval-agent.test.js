/**
 * AI Evaluation — Agent suite (Phase AI-11).
 *
 * - tool selection: scripted scenarios must produce the expected tool sequence
 * - plan quality: validator filters bad plans (capacity/duplicates/mastered)
 * - failure recovery: LLM outage degrades to a complete workflow run
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { StudyAgentToolRegistry } from '../apps/api/dist/agent/agent-tools.js';
import { StudyAgentService } from '../apps/api/dist/agent/study-agent.service.js';
import { validatePlan } from '../apps/api/dist/agent/plan-validator.js';

const NOW = new Date('2026-09-05T11:00:00.000Z');

function fullDeps() {
  const order = [];
  return {
    order,
    deps: {
      studentContext: { getContext: async () => { order.push('getStudentContext'); return {
        userId: 'u-1', mastery: { weakNodes: [{ knowledgeNodeId: 'OS-C06-S06-P02', title: '死锁必要条件', subject: 'OS', mastery: 0.3, attempts: 5 }], weakPoints: [], improvingPoints: [], masteredPoints: [], source: 'user_knowledge_mastery' },
        plan: { source: 'empty', planId: null, todayTasks: [] }, review: { source: 'empty', dueCount: 0, overdueCount: 0, highRiskQuestions: [] },
      }; } },
      knowledgeSearch: { search: async () => { order.push('searchKnowledge'); return { results: [{ knowledgeNodeId: 'OS-C06-S06-P02', title: '死锁必要条件', relatedNodes: [] }] }; } },
      questions: { listQuestions: () => { order.push('searchQuestion'); return [{ id: 'q-1', stem: '死锁相关题目', type: '单选', difficulty: 'medium', knowledgePointIds: ['p1'] }]; } },
      wrongQuestions: { getWrongQuestionsCompat: async () => { order.push('getWrongQuestions'); return [{ questionId: 'w-1', stem: '错题', knowledgePointId: 'p1', knowledgePointTitle: '信号量', wrongCount: 3, latestMistakeReason: '概念不清' }]; } },
      recommendation: {
        runRecommendationForUser: async () => { order.push('generateStudyPlan'); return { result: { items: [{ kind: 'TASK_DRAFT', knowledgeNodeId: 'OS-C06-S06-P02', action: 'LEARN', score: 90, estimatedMinutes: 40, scheduledDate: '2026-09-05', reasonCodes: ['LOW_MASTERY'] }] }, nodeById: new Map([['OS-C06-S06-P02', { id: 'OS-C06-S06-P02', name: '死锁必要条件', subject: 'OS', importance: 5, difficulty: 3 }]]) }; },
        generateDailyPlanFromState: async () => { order.push('createStudyTask'); return { id: 'plan-eval', tasks: [{ title: '学习死锁必要条件', minutes: 40 }] }; },
      },
    },
  };
}

test('tool selection: explain-scenario picks retrieval + wrong questions', async () => {
  const { deps } = fullDeps();
  const registry = new StudyAgentToolRegistry(deps);
  const toolCalls = [];
  const llm = {
    name: 'eval-llm',
    complete: async () => {
      if (toolCalls.length === 0) {
        toolCalls.push('getStudentContext', 'searchKnowledge', 'getWrongQuestions');
        return { content: null, toolCalls: [
          { id: '1', name: 'getStudentContext', arguments: '{}' },
          { id: '2', name: 'searchKnowledge', arguments: '{"query":"死锁"}' },
          { id: '3', name: 'getWrongQuestions', arguments: '{}' },
        ] };
      }
      return { content: JSON.stringify({ summary: '死锁是薄弱点', focusNodes: ['死锁必要条件'], suggestions: ['复盘错题'] }), toolCalls: [] };
    },
  };
  const agent = new StudyAgentService(registry, llm);
  const result = await agent.run('u-1', { message: '为什么我死锁总错？' }, NOW);
  assert.deepEqual(result.steps.map((step) => step.tool), ['getStudentContext', 'searchKnowledge', 'getWrongQuestions']);
  assert.equal(result.mode, 'llm');
});

test('tool selection: planning scenario without authorization never calls the write tool', async () => {
  const { deps, order } = fullDeps();
  const registry = new StudyAgentToolRegistry(deps);
  let round = 0;
  const llm = {
    name: 'eval-llm-write',
    complete: async () => {
      round += 1;
      if (round === 1) {
        return {
          content: null,
          toolCalls: [
            { id: '1', name: 'getStudentContext', arguments: '{}' },
            { id: '2', name: 'createStudyTask', arguments: '{}' },
          ],
        };
      }
      return { content: JSON.stringify({ summary: 'done', focusNodes: [], suggestions: [] }), toolCalls: [] };
    },
  };
  const agent = new StudyAgentService(registry, llm);
  await agent.run('u-1', { message: '安排今天' }, NOW);
  assert.ok(!order.includes('createStudyTask'), 'write tool must never reach the recommendation service');
});

test('plan quality: validator rejects over-capacity, duplicates and mastered nodes together', () => {
  const draft = (overrides) => ({ knowledgeNodeId: 'x', title: '点', action: 'LEARN', score: 80, estimatedMinutes: 30, ...overrides });
  const result = validatePlan({
    items: [
      draft({ knowledgeNodeId: 'good-1', score: 95 }),
      draft({ knowledgeNodeId: 'good-1', score: 60 }),
      draft({ knowledgeNodeId: 'mastered-1', score: 90 }),
      draft({ knowledgeNodeId: 'overflow-1', score: 50 }),
    ],
    availableMinutes: 45,
    masteredNodeIds: ['mastered-1'],
  });
  assert.deepEqual(result.validItems.map((item) => item.knowledgeNodeId), ['good-1']);
  const reasons = result.removed.map((entry) => entry.reason).sort();
  assert.deepEqual(reasons, ['already_mastered', 'duplicate', 'over_capacity']);
  assert.equal(result.totalMinutes, 30);
});

test('failure recovery: broken LLM degrades to a complete workflow run', async () => {
  const { deps, order } = fullDeps();
  const registry = new StudyAgentToolRegistry(deps);
  const brokenLlm = { name: 'outage', complete: async () => { throw new Error('connection refused'); } };
  const agent = new StudyAgentService(registry, brokenLlm);
  const result = await agent.run('u-1', { message: '帮我安排今天408学习' }, NOW);

  assert.equal(result.mode, 'workflow');
  assert.match(result.fallbackReason, /llm_error: connection refused/);
  // workflow still ran the full read pipeline
  assert.deepEqual(order.slice(0, 4), ['getStudentContext', 'searchKnowledge', 'getWrongQuestions', 'generateStudyPlan']);
  assert.ok(result.steps.every((step) => step.ok));
  assert.ok(result.answer.summary.length > 0);
});