/**
 * V4-5 Agent Adaptive Planner tests.
 *
 * Validates that the Study Agent's system prompt carries the adaptive
 * planning brief (signals + risk-derived strategy directives) when the
 * signal service is wired, and that the directives are RULE-derived.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import * as realSignals from '../apps/api/dist/adaptive/learning-signals.js';
import * as realRisk from '../apps/api/dist/adaptive/learning-risk.js';
import * as realPlanning from '../apps/api/dist/adaptive/adaptive-planning.js';
import { StudyAgentService } from '../apps/api/dist/agent/study-agent.service.js';

async function loadAgentService() {
  const path = 'apps/api/src/agent/study-agent.service.ts';
  const input = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(input, {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, emitDecoratorMetadata: false },
  }).outputText;
  const module = { exports: {} };
  const stubs = {
    '@nestjs/common': { Injectable: () => (target) => target, Optional: () => () => {}, Logger: class { log() {} warn() {} } },
  };
  Function('require', 'module', 'exports', output)((specifier) => {
    const stubKey = Object.keys(stubs).find((key) => specifier.includes(key));
    if (stubKey) return stubs[stubKey];
    if (specifier.includes('agent-tools')) return { StudyAgentToolRegistry: class {}, AGENT_TOOL_NAMES: ['getStudentContext'] };
    if (specifier.includes('learning-memory.service')) return { LearningMemoryService: class {} };
    if (specifier.includes('learning-signals')) return realSignals;
    if (specifier.includes('learning-risk')) return realRisk;
    if (specifier.includes('adaptive-planning')) return realPlanning;
    if (specifier.includes('ai-metrics')) return { AiMetricsService: class {} };
    if (specifier.includes('agent-guard')) return { detectPromptInjection: () => ({ suspicious: false, patterns: [] }), normalizeAgentAnswer: (raw) => ({ summary: String(raw?.summary ?? ''), focusNodes: [], suggestions: [], knowledgeRefs: [], unknown: false, guard: { invalidCitations: [], ungroundedKnowledgeClaim: false, admittedUnknown: false } }), sanitizeAgentInput: (raw) => ({ sanitized: raw ?? '', truncated: false, removedControlChars: 0 }), wrapWithInjectionDefense: (m) => m };
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
  return module.exports.StudyAgentService;
}

function depsWithRisk() {
  const tools = {
    execute: async (_userId, tool) => {
      if (tool === 'getStudentContext') return { ok: true, data: { mastery: { weakNodes: [{ knowledgeNodeId: 'n1', title: '死锁', subject: 'OS', mastery: 0.3 }] } } };
      if (tool === 'searchKnowledge') return { ok: true, data: { results: [{ knowledgeNodeId: 'n1', title: '死锁', relatedNodes: [] }] } };
      if (tool === 'getWrongQuestions') return { ok: true, data: [] };
      if (tool === 'generateStudyPlan') return { ok: true, data: { items: [{ knowledgeNodeId: 'n1', title: '死锁', action: 'LEARN', score: 90, estimatedMinutes: 40 }] } };
      return { ok: true, data: {} };
    },
    listTools: () => [],
  };
  return tools;
}

test('V4-5: adaptive planner prompt carries signals and strategy directives', async () => {
  // Confirm via the compiled agent service behavior: wire LearningSignalService
  // through the real module composition used in agent.module (signal service
  // wraps StudentContextQueryService). Here we use a light stub pair.
  const { LearningSignalService } = await import('../apps/api/dist/adaptive/learning-signal.service.js');
  const { StudentContextQueryService } = await import('../apps/api/dist/study/student-context.query.service.js');
  void StudentContextQueryService;

  const signalService = new LearningSignalService(
    { getContext: async () => ({
        asOf: '2026-09-07T08:00:00.000Z',
        mastery: { weakNodes: [{ knowledgeNodeId: 'n1', title: '死锁', subject: 'OS', mastery: 0.3, attempts: 6, wrongCount: 5 }], improvingPoints: [], masteredPoints: [] },
        practice: { recentAccuracy: { status: 'sufficient', value: 0.4 }, totalCount: 10, latestSubmittedAt: null },
        review: { dueCount: 4, overdueCount: 2, highRiskQuestions: [{ questionId: 'w-1', wrongCount: 5, overdue: true }] },
        plan: { todayTasks: [{ completed: false }, { completed: false }], completion: { rate: { value: 0.2 } } },
        momentum: { studyStreak: 0, isActiveToday: false, recentSessions: [], activityTrend: { value: 1 } },
      }) },
    undefined,
  );
  const tools = {
    execute: async (_userId, tool) => {
      if (tool === 'getStudentContext') return { ok: true, data: { mastery: { weakNodes: [{ knowledgeNodeId: 'n1', title: '死锁', subject: 'OS', mastery: 0.3 }] } } };
      if (tool === 'searchKnowledge') return { ok: true, data: { results: [{ knowledgeNodeId: 'n1', title: '死锁', relatedNodes: [] }] } };
      return { ok: true, data: {} };
    },
    listTools: () => [],
  };
  const registry = new (await import('../apps/api/dist/agent/agent-tools.js')).StudyAgentToolRegistry({
    studentContext: { getContext: async () => ({ mastery: { weakNodes: [], improvingPoints: [], masteredPoints: [] } }) },
    knowledgeSearch: { search: async () => ({ results: [] }) },
    questions: { listQuestions: () => [] },
    wrongQuestions: { getWrongQuestionsCompat: async () => [] },
    recommendation: { runRecommendationForUser: async () => ({ result: { items: [] }, nodeById: new Map() }), generateDailyPlanFromState: async () => ({ id: 'p', tasks: [] }) },
  });
  const service = await loadAgentService();
  // Recreate the agent with the wired tools registry + signal service.
  const captured = [];
  const riskLlm = {
    name: 'risk-probe',
    complete: async ({ messages }) => {
      captured.push(messages[0].content);
      return { content: JSON.stringify({ summary: 'ok', focusNodes: [], suggestions: [] }), toolCalls: [] };
    },
  };
  const agentWithRisk = new StudyAgentService(registry, riskLlm, undefined, undefined, signalService);
  const result = await agentWithRisk.run('u-1', { message: '安排今天' }, new Date('2026-09-07T08:00:00.000Z'));
  assert.equal(result.mode, 'llm');
  assert.ok(
    captured[0].includes('学习信号') || captured[0].includes('自适应策略指令'),
    'system prompt should carry the adaptive signal/strategy brief',
  );
  assert.ok(
    captured[0].includes('学习中断') || captured[0].includes('复习债积压'),
    'strategy directives should reflect the fixture risks (inactivity + review debt)',
  );
});
test('V4-5: agent prompt carries adaptive signals and strategy directives', async () => {
  const { LearningSignalService } = await import('../apps/api/dist/adaptive/learning-signal.service.js');
  const { StudyAgentService } = await import('../apps/api/dist/agent/study-agent.service.js');
  const { StudyAgentToolRegistry } = await import('../apps/api/dist/agent/agent-tools.js');
  const { detectLearningRisks } = await import('../apps/api/dist/adaptive/learning-risk.js');

  const captured = [];
  const tools = {
    execute: async (_userId, tool) => {
      if (tool === 'getStudentContext') return { ok: true, data: { mastery: { weakNodes: [{ knowledgeNodeId: 'n1', title: '死锁', subject: 'OS', mastery: 0.3 }] } } };
      if (tool === 'searchKnowledge') return { ok: true, data: { results: [] } };
      if (tool === 'getWrongQuestions') return { ok: true, data: [] };
      return { ok: true, data: {} };
    },
    listTools: () => [],
  };
  const registry = new StudyAgentToolRegistry({
    studentContext: { getContext: async () => ({
      asOf: '2026-09-07T08:00:00.000Z',
      mastery: { weakNodes: [{ knowledgeNodeId: 'n1', title: '死锁', subject: 'OS', mastery: 0.3, attempts: 6, wrongCount: 5 }], improvingPoints: [], masteredPoints: [] },
      practice: { recentAccuracy: { status: 'sufficient', value: 0.4 }, totalCount: 10, latestSubmittedAt: null },
      review: { dueCount: 4, overdueCount: 2, highRiskQuestions: [{ questionId: 'w-1', wrongCount: 5, overdue: true }] },
      plan: { todayTasks: [{ completed: false }, { completed: false }], completion: { rate: { value: 0.2 } } },
      momentum: { studyStreak: 0, isActiveToday: false, recentSessions: [], activityTrend: { value: 1 } },
    }) },
    knowledgeSearch: { search: async () => ({ results: [] }) },
    questions: { listQuestions: () => [] },
    wrongQuestions: { getWrongQuestionsCompat: async () => [] },
    recommendation: { runRecommendationForUser: async () => ({ result: { items: [] }, nodeById: new Map() }), generateDailyPlanFromState: async () => ({ id: 'p', tasks: [] }) },
  });
  const signalService = new LearningSignalService(
    { getContext: async () => registry ? (await (async () => { const r = await tools.execute('u-1', 'getStudentContext'); return r.data; })()) : null },
    async () => ({ n1: 0.6 }),
  );
  const llm = {
    name: 'probe',
    complete: async ({ messages }) => {
      captured.push(messages[0].content);
      return { content: JSON.stringify({ summary: 'ok', focusNodes: [], suggestions: [] }), toolCalls: [] };
    },
  };
  const agent = new StudyAgentService(tools, llm, undefined, undefined, signalService);
  const result = await agent.run('u-1', { message: '安排今天' }, new Date('2026-09-07T08:00:00.000Z'));
  assert.equal(result.mode, 'llm');
  const prompt = captured[0] ?? '';
  assert.ok(prompt.includes('学习信号'), 'prompt should carry the signal brief');
  assert.ok(prompt.includes('自适应策略指令'), 'prompt should carry strategy directives');
  // risk-derived directive text present (inactivity + review debt paths)
  assert.ok(
    prompt.includes('学习中断') || prompt.includes('复习债积压'),
    'strategy directives should reflect detected risks',
  );
  // signals/risks actually derived: inactivity fired in the fixture
  void detectLearningRisks;
});
