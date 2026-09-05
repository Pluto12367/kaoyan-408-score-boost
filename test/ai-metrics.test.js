/**
 * AI Metrics Tests (Phase AI-12).
 *
 * Covers the sliding-window metrics service (agent/rag/coach aggregation,
 * failure & hit rates, token totals, ring cap, reset), the DeepSeek usage
 * parsing (backward compatible), and the admin snapshot endpoint contract.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { AiMetricsService } from '../apps/api/dist/ai-metrics/ai-metrics.service.js';
import { DeepSeekClient } from '../apps/api/dist/study/deepseek-client.js';

test('metrics starts empty with zeroed snapshot', () => {
  const metrics = new AiMetricsService();
  const snapshot = metrics.snapshot();
  assert.equal(snapshot.agent.runs, 0);
  assert.equal(snapshot.rag.searches, 0);
  assert.equal(snapshot.coach.responses, 0);
  assert.equal(snapshot.agent.failureRate, 0);
  assert.equal(snapshot.agent.tokens.total, 0);
  assert.equal(snapshot.agent.p95LatencyMs, null);
});

test('agent metrics aggregate runs, failure rate, tool calls and tokens', () => {
  const metrics = new AiMetricsService();
  metrics.recordAgentRun({ mode: 'llm', failed: false, toolCalls: 3, failedTools: 0, durationMs: 100, promptTokens: 500, completionTokens: 300 });
  metrics.recordAgentRun({ mode: 'workflow', failed: true, toolCalls: 4, failedTools: 1, durationMs: 50 });
  const snapshot = metrics.snapshot();
  assert.equal(snapshot.agent.runs, 2);
  assert.equal(snapshot.agent.llmRuns, 1);
  assert.equal(snapshot.agent.workflowRuns, 1);
  assert.equal(snapshot.agent.failureRate, 0.5);
  assert.equal(snapshot.agent.toolCalls, 7);
  assert.equal(snapshot.agent.failedToolCalls, 1);
  assert.equal(snapshot.agent.tokens.total, 800);
  assert.ok(snapshot.agent.avgLatencyMs > 0);
});

test('rag metrics compute hit rate and average top score', () => {
  const metrics = new AiMetricsService();
  metrics.recordRagSearch({ available: true, resultCount: 3, topScore: 0.8, durationMs: 20 });
  metrics.recordRagSearch({ available: true, resultCount: 0, topScore: 0.01, durationMs: 15 });
  metrics.recordRagSearch({ available: false, resultCount: 0, topScore: null, durationMs: 5 });
  const snapshot = metrics.snapshot();
  assert.equal(snapshot.rag.searches, 3);
  assert.equal(snapshot.rag.hitRate, Math.round((1 / 3) * 10000) / 10000);
  assert.ok(Math.abs(snapshot.rag.avgTopScore - (0.8 + 0.01) / 2) < 0.001);
});

test('coach metrics track fallback rate', () => {
  const metrics = new AiMetricsService();
  metrics.recordCoachResponse({ source: 'model', fallback: false, durationMs: 900 });
  metrics.recordCoachResponse({ source: 'template', fallback: true, durationMs: 30 });
  const snapshot = metrics.snapshot();
  assert.equal(snapshot.coach.responses, 2);
  assert.equal(snapshot.coach.fallbackRate, 0.5);
});

test('ring cap bounds stored events', () => {
  const metrics = new AiMetricsService();
  for (let index = 0; index < 5010; index += 1) {
    metrics.recordRagSearch({ available: true, resultCount: 1, topScore: 0.5, durationMs: 1 });
  }
  assert.equal(metrics.snapshot().rag.searches, 5000);
});

test('reset clears all windows', () => {
  const metrics = new AiMetricsService();
  metrics.recordAgentRun({ mode: 'llm', failed: false, toolCalls: 1, failedTools: 0, durationMs: 10 });
  metrics.reset();
  assert.equal(metrics.snapshot().agent.runs, 0);
});

test('events outside the window are excluded', () => {
  const metrics = new AiMetricsService();
  metrics.recordAgentRun({ at: Date.now() - 2 * 60 * 60 * 1000, mode: 'llm', failed: false, toolCalls: 1, failedTools: 0, durationMs: 10 });
  assert.equal(metrics.snapshot().agent.runs, 0);
});

// ---- DeepSeek usage parsing (backward compatible) ----

test('DeepSeekClient surfaces provider usage when present', async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: 'ok' } }],
      model: 'm',
      usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 },
    }),
  });
  const client = new DeepSeekClient({ apiKey: 'sk-test', fetchImpl: fakeFetch });
  const result = await client.chatCompletions({ messages: [{ role: 'user', content: 'hi' }] });
  assert.deepEqual(result.usage, { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 });
});

test('DeepSeekClient omits usage when provider does not send it (compat)', async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: 'ok' } }], model: 'm' }),
  });
  const client = new DeepSeekClient({ apiKey: 'sk-test', fetchImpl: fakeFetch });
  const result = await client.chatCompletions({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(result.usage, undefined);
});

test('agent run records usage into metrics via the adapter path', async () => {
  const metrics = new AiMetricsService();
  const tools = {
    execute: async () => ({ ok: true, data: {} }),
    listTools: () => [],
  };
  const llm = {
    name: 'usage-llm',
    complete: async () => ({
      content: JSON.stringify({ summary: 'ok', focusNodes: [], suggestions: [] }),
      toolCalls: [],
      usage: { promptTokens: 100, completionTokens: 40 },
    }),
  };
  const { StudyAgentService } = await import('../apps/api/dist/agent/study-agent.service.js');
  const agent = new StudyAgentService(tools, llm, undefined, metrics);
  await agent.run('u-1', { message: 'hi' }, new Date('2026-09-05T08:00:00.000Z'));
  const snapshot = metrics.snapshot();
  assert.equal(snapshot.agent.runs, 1);
  assert.equal(snapshot.agent.tokens.total, 140);
});

// ---- Admin endpoint contract ----

test('metrics endpoint is admin-only and exposes the snapshot', async () => {
  const controller = await readFile(new URL('../apps/api/src/ai-metrics/ai-metrics.controller.ts', import.meta.url), 'utf8');
  assert.match(controller, /Get\('ai\/metrics'\)/);
  assert.match(controller, /@Roles\('admin'\)/);
  assert.match(controller, /snapshot\(\)/);
});

test('metrics module is global and registered in AppModule', async () => {
  const moduleSource = await readFile(new URL('../apps/api/src/ai-metrics/ai-metrics.module.ts', import.meta.url), 'utf8');
  assert.match(moduleSource, /@Global\(\)/);
  const appModule = await readFile(new URL('../apps/api/src/app.module.ts', import.meta.url), 'utf8');
  assert.match(appModule, /AiMetricsModule/);
});