/**
 * v3.4 Phase 1 — Remote LLM smoke (real DeepSeek calls).
 *
 * Loads AI_API_KEY from .env.development (never prints it), then runs four
 * minimal real-provider calls with a small token budget:
 *   1. plain contextual-coach request
 *   2. RAG-grounded answer (knowledgeContext in the envelope)
 *   3. agent tool-calling round (single tool)
 *   4. agent planner (validate-only run through the deterministic planner
 *      is LLM-free — so instead we validate the raw tool-calling protocol
 *      with a forced tool_choice, which exercises the same provider path
 *      the agent loop uses)
 *
 * Output: JSON result lines with latency / token usage / success / fallback.
 * This script is a validation harness, not part of the app; it never logs
 * the key and never writes to the database.
 */

import { readFileSync } from 'node:fs';

function loadEnvFile(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^([A-Z_]+)\s*=\s*(.*)$/);
      if (match) out[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
    }
  } catch {}
  return out;
}

const fileEnv = loadEnvFile('.env.development');
const apiKey = process.env.AI_API_KEY?.trim() || fileEnv.AI_API_KEY?.trim();
const baseUrl = (process.env.AI_BASE_URL || fileEnv.AI_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
const model = process.env.AI_MODEL || fileEnv.AI_MODEL || 'deepseek-v4-flash';

if (!apiKey || /your|placeholder|xxx/i.test(apiKey)) {
  console.error(JSON.stringify({ blocked: true, reason: 'AI_API_KEY missing or placeholder' }));
  process.exit(2);
}

async function chat(body, label) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { label, ok: false, latencyMs, status: response.status, error: text.slice(0, 200) };
    }
    const payload = await response.json();
    const message = payload.choices?.[0]?.message;
    const toolCalls = (message?.tool_calls ?? []).map((call) => call.function?.name);
    return {
      label,
      ok: true,
      latencyMs,
      model: payload.model,
      tokens: payload.usage ?? null,
      contentPreview: (message?.content ?? '').slice(0, 160),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: payload.choices?.[0]?.finish_reason,
    };
  } catch (error) {
    return { label, ok: false, latencyMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

const results = [];

// 1. Plain coach request (JSON mode, same prompt family as the coach).
results.push(await chat({
  model,
  max_tokens: 300,
  temperature: 0.3,
  response_format: { type: 'json_object' },
  thinking: { type: 'disabled' },
  chat_template_kwargs: { thinking: false },
  messages: [
    { role: 'system', content: '你是 408 学习辅导助手，只能解释、提醒和建议。只输出 JSON：{"summary": string, "replySteps": string[]}。' },
    { role: 'user', content: JSON.stringify({ learnerMessage: '死锁的四个必要条件我总是记混，怎么办？' }) },
  ],
}, "coach_plain"));

// 2. RAG-grounded request (knowledgeContext envelope, must reference the node).
results.push(await chat({
  model,
  max_tokens: 300,
  temperature: 0.3,
  response_format: { type: 'json_object' },
  thinking: { type: 'disabled' },
  chat_template_kwargs: { thinking: false },
  messages: [
    { role: 'system', content: '你是 408 学习辅导助手。只能基于提供的 knowledgeContext 解释，不得虚构；没有依据就回答"不知道"。只输出 JSON：{"summary": string, "knowledgeRefs": string[]}。' },
    { role: 'user', content: JSON.stringify({
      learnerMessage: '为什么PV操作总错？',
      knowledgeContext: { results: [{ knowledgeNodeId: 'OS-C02-S04-P20', title: '信号量', chapterPath: ['进程同步', '信号量'], relevanceScore: 0.82 }] },
    }) },
  ],
}, "coach_rag_grounded"));

// 3. Agent tool-calling (single forced tool call, mirrors the agent loop protocol).
results.push(await chat({
  model,
  max_tokens: 200,
  temperature: 0.2,
  thinking: { type: 'disabled' },
  chat_template_kwargs: { thinking: false },
  messages: [
    { role: 'system', content: '你是 408 学习规划助手，必须先调用工具获取数据。' },
    { role: 'user', content: '帮我看看我现在的学习状态' },
  ],
  tools: [{
    type: 'function',
    function: {
      name: 'getStudentContext',
      description: '读取学生当前学习上下文（掌握度、复习、任务）',
      parameters: { type: 'object', properties: {} },
    },
  }],
  tool_choice: { type: 'function', function: { name: 'getStudentContext' } },
}, "agent_tool_call"));

// 4. Planner-style free tool selection among the agent's real toolset (no forced choice).
results.push(await chat({
  model,
  max_tokens: 250,
  temperature: 0.2,
  thinking: { type: 'disabled' },
  chat_template_kwargs: { thinking: false },
  messages: [
    { role: 'system', content: '你是 408 学习规划助手。安排学习前必须先 getStudentContext，再用 searchKnowledge 检索相关考点。一次只调用一个工具。' },
    { role: 'user', content: '帮我安排今天408学习' },
  ],
  tools: [
    { type: 'function', function: { name: 'getStudentContext', description: '读取学生上下文', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'searchKnowledge', description: '语义检索408知识节点', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
    { type: 'function', function: { name: 'createStudyTask', description: '创建今日任务（写入）', parameters: { type: 'object', properties: {} } } },
  ],
}, "agent_planning_selection"));

const passed = results.filter((result) => result.ok).length;
const totalTokens = results.reduce((sum, result) => sum + (result.tokens?.total_tokens ?? 0), 0);
console.log(JSON.stringify({
  provider: `${baseUrl} (${model})`,
  real: true,
  results,
  summary: { total: results.length, passed, failed: results.length - passed, totalTokens },
}, null, 1));