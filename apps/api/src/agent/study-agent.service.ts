/**
 * Study Agent V1 (Phase AI-3/AI-4).
 *
 * A planning agent — not a chatbot. Two execution paths:
 *
 * 1. LLM tool-calling loop (when an AgentLlm boundary is wired):
 *    the model decides which whitelisted tools to call, the orchestrator
 *    executes them through StudyAgentToolRegistry (existing services only),
 *    and grounds the final answer in tool results.
 *
 * 2. Deterministic workflow fallback (no LLM or LLM failure):
 *    the fixed 7-step "安排今天408学习" pipeline runs the same tools in a
 *    fixed order — getStudentContext → searchKnowledge → getWrongQuestions →
 *    (createStudyTask when requested) — and renders a structured summary.
 *
 * Boundaries: the agent NEVER touches the database; writes happen only via
 * the createStudyTask tool (canonical plan writer inside RecommendationService).
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { StudyAgentToolRegistry, AGENT_TOOL_NAMES, type AgentToolName } from './agent-tools';
import { LearningMemoryService } from './learning-memory.service';
import {
  detectPromptInjection,
  normalizeAgentAnswer,
  sanitizeAgentInput,
  wrapWithInjectionDefense,
} from './agent-guard';
import { AiMetricsService } from '../ai-metrics/ai-metrics.service';

const MAX_LLM_STEPS = 6;
const MAX_TOOL_RESULT_CHARS = 4000;
/** Run-level wall-clock deadline (TD-P1). Env-overridable; 60s default. */
const DEFAULT_RUN_DEADLINE_MS = 60_000;

function runDeadlineMs(): number {
  const parsed = Number.parseInt(String(process.env.AGENT_RUN_DEADLINE_MS ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RUN_DEADLINE_MS;
}

export interface AgentToolCall {
  id?: string;
  name: string;
  arguments: string;
}

export interface AgentLlmTurn {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: AgentToolCall[];
  toolCallId?: string;
}

export interface AgentLlmUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface AgentLlmResponse {
  content: string | null;
  toolCalls: AgentToolCall[];
  /** Token usage when the provider reports it (AI-12 cost control). */
  usage?: AgentLlmUsage;
}

/** Injectable LLM boundary so the orchestrator loop is testable without a provider. */
export interface AgentLlm {
  readonly name: string;
  complete(input: { messages: AgentLlmTurn[]; tools: unknown[] }): Promise<AgentLlmResponse>;
}

export interface StudyAgentRunInput {
  message: string;
  createTasks?: boolean;
  availableMinutes?: number;
  scheduledDate?: string;
}

export interface StudyAgentStepTrace {
  step: number;
  tool: string;
  ok: boolean;
  durationMs: number;
  summary: string;
  error?: string;
}

export interface StudyAgentAnswer {
  summary: string;
  focusNodes: string[];
  suggestions: string[];
}

export interface StudyAgentRunResult {
  source: string;
  mode: 'llm' | 'workflow';
  steps: StudyAgentStepTrace[];
  answer: StudyAgentAnswer;
  plan?: {
    planId: string | null;
    scheduledDate: string;
    taskCount: number;
    tasks: Array<{ title?: string; mode?: string; minutes?: number; questionCount?: number; priority?: string }>;
  };
  fallbackReason?: string;
}

@Injectable()
export class StudyAgentService {
  private readonly logger = new Logger(StudyAgentService.name);
  private lastPromptTokens = 0;
  private lastCompletionTokens = 0;

  constructor(
    private readonly tools: StudyAgentToolRegistry,
    @Optional() private readonly llm?: AgentLlm,
    // Learning memory (AI-7): read-only, derived from StudentContext.
    // Appended last per the positional-constructor convention; failure to
    // load memory never blocks a run.
    @Optional() private readonly memory?: LearningMemoryService,
    // Live metrics (AI-12): optional so existing DI compositions stay valid.
    @Optional() private readonly metrics?: AiMetricsService,
  ) {}

  async run(userId: string, input: StudyAgentRunInput, now: Date = new Date()): Promise<StudyAgentRunResult> {
    const startedAt = Date.now();
    const deadlineAt = startedAt + runDeadlineMs();
    const result = await this.runInner(userId, input, now, deadlineAt);
    const durationMs = Date.now() - startedAt;
    this.metrics?.recordAgentRun({
      mode: result.mode,
      failed: result.steps.some((step) => !step.ok),
      toolCalls: result.steps.length,
      failedTools: result.steps.filter((step) => !step.ok).length,
      durationMs,
      promptTokens: this.lastPromptTokens,
      completionTokens: this.lastCompletionTokens,
    });
    this.lastPromptTokens = 0;
    this.lastCompletionTokens = 0;
    this.logger.log(JSON.stringify({
      event: 'study_agent.completed',
      userId,
      mode: result.mode,
      source: result.source,
      stepCount: result.steps.length,
      failedSteps: result.steps.filter((step) => !step.ok).map((step) => step.tool),
      createdTasks: result.plan?.taskCount ?? 0,
      fallback: Boolean(result.fallbackReason),
      ...(result.fallbackReason ? { fallbackReason: result.fallbackReason } : {}),
      durationMs,
    }));
    return result;
  }

  private async runInner(userId: string, input: StudyAgentRunInput, now: Date, deadlineAt: number): Promise<StudyAgentRunResult> {
    // Guard (AI-10): bound and clean the raw input before any processing.
    const sanitized = sanitizeAgentInput(input.message ?? '');
    const message = sanitized.sanitized;
    if (!message) {
      return {
        source: this.llm?.name ?? 'workflow-deterministic',
        mode: 'workflow',
        steps: [],
        answer: { summary: '请描述你想安排的学习内容。', focusNodes: [], suggestions: [] },
        fallbackReason: 'empty_message',
      };
    }
    if (this.llm) {
      try {
        return await this.runLlmLoop(userId, input, message, now, deadlineAt);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(`agent LLM loop failed, falling back to workflow: ${reason}`);
        const result = await this.runWorkflow(userId, input, now, deadlineAt);
        return { ...result, fallbackReason: `llm_error: ${reason.slice(0, 200)}` };
      }
    }
    return this.runWorkflow(userId, input, now, deadlineAt);
  }

  // ---- Path 1: LLM tool-calling loop ----

  private async runLlmLoop(userId: string, input: StudyAgentRunInput, message: string, now: Date, deadlineAt: number): Promise<StudyAgentRunResult> {
    const steps: StudyAgentStepTrace[] = [];
    const knownNodeIds = new Set<string>();
    const injection = detectPromptInjection(message);
    const userMessage = injection.suspicious ? wrapWithInjectionDefense(message) : message;
    const messages: AgentLlmTurn[] = [
      { role: 'system', content: await this.systemPrompt(userId, input) },
      { role: 'user', content: userMessage },
    ];
    let promptTokens = 0;
    let completionTokens = 0;
    let lastPlan: StudyAgentRunResult['plan'];

    for (let step = 1; step <= MAX_LLM_STEPS; step += 1) {
      if (Date.now() > deadlineAt) {
        return {
          source: this.llm!.name,
          mode: 'llm',
          steps,
          answer: { summary: '已达到运行时限，返回已收集的分析结果。', focusNodes: [], suggestions: [] },
          ...(lastPlan ? { plan: lastPlan } : {}),
          fallbackReason: 'deadline_exceeded',
        };
      }
      const response = await this.llm!.complete({ messages, tools: this.toolSchemas() });
      if (response.usage) {
        promptTokens += response.usage.promptTokens ?? 0;
        completionTokens += response.usage.completionTokens ?? 0;
        this.lastPromptTokens = promptTokens;
        this.lastCompletionTokens = completionTokens;
      }
      // Guard (AI-10): whitelist filter + hard permission gate on the write tool.
      const toolCalls = (response.toolCalls ?? []).filter((call) => {
        if (!AGENT_TOOL_NAMES.includes(call.name as AgentToolName)) return false;
        if (call.name === 'createStudyTask' && input.createTasks !== true) {
          steps.push({
            step,
            tool: call.name,
            ok: false,
            durationMs: 0,
            summary: 'denied: createTasks not authorized for this run',
            error: 'tool_permission_denied',
          });
          return false;
        }
        return true;
      });
      if (toolCalls.length === 0) {
        return {
          source: this.llm!.name,
          mode: 'llm',
          steps,
          answer: normalizeAgentAnswer(this.parseAnswer(response.content ?? ''), knownNodeIds),
          ...(lastPlan ? { plan: lastPlan } : {}),
        };
      }
      messages.push({ role: 'assistant', content: response.content ?? '', toolCalls });
      for (const call of toolCalls) {
        const startedAt = Date.now();
        let args: Record<string, unknown> = {};
        try {
          args = call.arguments ? JSON.parse(call.arguments) : {};
        } catch {
          args = {};
        }
        const result = await this.tools.execute(userId, call.name, args, now);
        const durationMs = Date.now() - startedAt;
        steps.push({
          step,
          tool: call.name,
          ok: result.ok,
          durationMs,
          summary: summarizeToolResult(call.name, result),
          ...(result.error ? { error: result.error } : {}),
        });
        if (call.name === 'createStudyTask' && result.ok) {
          lastPlan = toPlanTrace(result.data, input.scheduledDate ?? now.toISOString().slice(0, 10));
        }
        collectKnownNodeIds(call.name, result, knownNodeIds);
        messages.push({
          role: 'tool',
          content: JSON.stringify(boundData(result)).slice(0, MAX_TOOL_RESULT_CHARS),
          toolCallId: call.id ?? call.name,
        });
      }
    }
    // Step budget exhausted: return whatever traces we have with explicit reason.
    return {
      source: this.llm!.name,
      mode: 'llm',
      steps,
      answer: {
        summary: '已达到最大工具调用步数，基于已收集的信息给出建议。',
        focusNodes: [],
        suggestions: [],
      },
      ...(lastPlan ? { plan: lastPlan } : {}),
      fallbackReason: 'max_steps_reached',
    };
  }

  private async systemPrompt(userId: string, input: StudyAgentRunInput): Promise<string> {
    const lines = [
      '你是 408 学习规划助手（Study Agent）。你的任务是根据学生真实学习数据安排学习。',
      '必须先调用工具获取数据，再给结论；不得虚构掌握度、错题或计划内容。',
      '可用工具：getStudentContext（学生上下文）、searchKnowledge（知识检索）、searchQuestion（搜题）、getWrongQuestions（错题）、generateStudyPlan（计划预览，只读）、createStudyTask（创建今日任务，写入）。',
      input.createTasks === true
        ? '用户已授权创建任务：在分析完成后调用 createStudyTask 一次即可，不要重复调用。'
        : '用户未授权创建任务：只做分析和建议，禁止调用 createStudyTask。',
      '你不能修改掌握度、复习安排或历史数据；写入仅限 createStudyTask。',
      '回答知识性结论时必须在 knowledgeRefs 中列出所依据的知识点 ID（来自检索或学生上下文的 knowledgeNodeId）；没有依据就明确回答“不知道”，不要编造。',
      '最终回复只输出 JSON：{"summary": string, "focusNodes": string[], "suggestions": string[], "knowledgeRefs": string[], "unknown": boolean}。',
    ];
    if (this.memory) {
      try {
        const memory = await this.memory.getLearningMemory(userId);
        if (memory.brief) lines.push(`学习记忆（只读背景，来自学生上下文）：${memory.brief}`);
      } catch (error) {
        this.logger.warn(`memory load failed (non-blocking): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return lines.join('\n');
  }

  private toolSchemas(): unknown[] {
    return this.tools.listTools().map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: Object.fromEntries(
            Object.entries(tool.parameters).map(([key, param]) => [
              key,
              { type: param.type, description: param.description, ...(param.enum ? { enum: param.enum } : {}) },
            ]),
          ),
        },
      },
    }));
  }

  private parseAnswer(content: string): { summary: string; focusNodes: string[]; suggestions: string[]; knowledgeRefs?: unknown; unknown?: unknown } {
    const fallback = { summary: content.slice(0, 500) || '已完成分析。', focusNodes: [] as string[], suggestions: [] as string[] };
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    try {
      const parsed = JSON.parse(match[0]) as Partial<{
        summary: unknown; focusNodes: unknown; suggestions: unknown; knowledgeRefs: unknown; unknown: unknown;
      }>;
      return {
        summary: typeof parsed.summary === 'string' ? parsed.summary : fallback.summary,
        focusNodes: Array.isArray(parsed.focusNodes)
          ? parsed.focusNodes.filter((node): node is string => typeof node === 'string').slice(0, 8)
          : [],
        suggestions: Array.isArray(parsed.suggestions)
          ? parsed.suggestions.filter((item): item is string => typeof item === 'string').slice(0, 8)
          : [],
        knowledgeRefs: parsed.knowledgeRefs,
        unknown: parsed.unknown,
      };
    } catch {
      return fallback;
    }
  }

  // ---- Path 2: deterministic workflow (AI-4 pipeline) ----

  async runWorkflow(userId: string, input: StudyAgentRunInput, now: Date = new Date(), deadlineAt: number = Date.now() + DEFAULT_RUN_DEADLINE_MS): Promise<StudyAgentRunResult> {
    const steps: StudyAgentStepTrace[] = [];
    const scheduledDate = input.scheduledDate ?? now.toISOString().slice(0, 10);
    const toolArgs = {
      ...(input.availableMinutes ? { availableMinutes: input.availableMinutes } : {}),
    };

    // Step 1: student context
    const contextResult = await this.traceStep(steps, 1, userId, 'getStudentContext', {}, now);
    const context = contextResult?.ok ? (contextResult.data as Record<string, unknown>) : null;
    const weakNodes = extractWeakNodes(context);

    // Step 2: analyze mastery → derive knowledge query
    const query = weakNodes.length
      ? weakNodes.slice(0, 2).map((node) => node.title).join(' ')
      : '408 重点知识';
    const knowledgeResult = await this.traceStep(steps, 2, userId, 'searchKnowledge', { query, topK: 3 }, now);
    const knowledge = knowledgeResult?.ok ? (knowledgeResult.data as { results?: Array<{ title?: string }> }) : null;

    // Step 3: wrong questions
    const wrongResult = await this.traceStep(steps, 3, userId, 'getWrongQuestions', {}, now);
    const wrongQuestions = wrongResult?.ok && Array.isArray(wrongResult.data) ? (wrongResult.data as Array<Record<string, unknown>>) : [];

    // Step 4: plan preview (read-only)
    const previewResult = await this.traceStep(steps, 4, userId, 'generateStudyPlan', toolArgs, now);
    const preview = previewResult?.ok ? (previewResult.data as { items?: Array<Record<string, unknown>> }) : null;

    // Step 5: create tasks (only when explicitly requested, before the deadline)
    let plan: StudyAgentRunResult['plan'];
    if (input.createTasks) {
      if (Date.now() > deadlineAt) {
        steps.push({ step: 5, tool: 'createStudyTask', ok: false, durationMs: 0, summary: 'skipped: deadline_exceeded', error: 'deadline_exceeded' });
      } else {
        const createResult = await this.traceStep(
          steps, 5, userId, 'createStudyTask', { scheduledDate, ...toolArgs }, now,
        );
        if (createResult?.ok) plan = toPlanTrace(createResult.data, scheduledDate);
      }
    }

    const focusTitles = (knowledge?.results ?? []).map((item) => String(item.title ?? '')).filter(Boolean).slice(0, 3);
    const answer = {
      summary: buildWorkflowSummary(weakNodes.length, wrongQuestions.length, preview?.items?.length ?? 0, Boolean(plan), scheduledDate),
      focusNodes: focusTitles,
      suggestions: buildWorkflowSuggestions(wrongQuestions, preview),
    };
    return {
      source: 'workflow-deterministic',
      mode: 'workflow',
      steps,
      answer,
      ...(plan ? { plan } : {}),
    };
  }

  private async traceStep(
    steps: StudyAgentStepTrace[],
    step: number,
    userId: string,
    tool: AgentToolName,
    args: Record<string, unknown>,
    now: Date,
  ) {
    const startedAt = Date.now();
    const result = await this.tools.execute(userId, tool, args, now);
    steps.push({
      step,
      tool,
      ok: result.ok,
      durationMs: Date.now() - startedAt,
      summary: summarizeToolResult(tool, result),
      ...(result.error ? { error: result.error } : {}),
    });
    return result;
  }
}

// ---- helpers ----

/**
 * Track knowledgeNodeIds actually seen by this run (retrieval results,
 * related nodes, student context buckets) so answer citations can be
 * validated against ground truth (AI-10 hallucination guard).
 */
function collectKnownNodeIds(tool: string, result: { ok: boolean; data: unknown }, known: Set<string>): void {
  if (!result.ok || !result.data || typeof result.data !== 'object') return;
  const data = result.data as Record<string, unknown>;
  if (tool === 'searchKnowledge' && Array.isArray(data.results)) {
    for (const node of data.results as Array<Record<string, unknown>>) {
      if (typeof node.knowledgeNodeId === 'string') known.add(node.knowledgeNodeId);
      for (const related of (node.relatedNodes ?? []) as Array<Record<string, unknown>>) {
        if (typeof related.knowledgeNodeId === 'string') known.add(related.knowledgeNodeId);
      }
    }
    return;
  }
  if (tool === 'getStudentContext') {
    const mastery = data.mastery as { weakNodes?: Array<{ knowledgeNodeId?: unknown }>; improvingPoints?: Array<{ knowledgeNodeId?: unknown }>; masteredPoints?: Array<{ knowledgeNodeId?: unknown }> } | undefined;
    for (const bucket of [mastery?.weakNodes, mastery?.improvingPoints, mastery?.masteredPoints]) {
      for (const node of bucket ?? []) {
        if (typeof node.knowledgeNodeId === 'string') known.add(node.knowledgeNodeId);
      }
    }
  }
}

function boundData(result: { ok: boolean; data: unknown; error?: string }): unknown {
  if (!result.ok) return { error: result.error ?? 'tool failed' };
  return result.data;
}

function summarizeToolResult(tool: string, result: { ok: boolean; data: unknown; error?: string }): string {
  if (!result.ok) return `${tool} failed: ${result.error ?? 'unknown'}`;
  if (tool === 'getStudentContext') {
    const mastery = (result.data as { mastery?: { weakNodes?: unknown[] } })?.mastery;
    return `student context loaded (weak=${mastery?.weakNodes?.length ?? 0})`;
  }
  if (tool === 'searchKnowledge') {
    const results = (result.data as { results?: unknown[] })?.results;
    return `knowledge search returned ${results?.length ?? 0} nodes`;
  }
  if (tool === 'searchQuestion' || tool === 'getWrongQuestions') {
    return `${tool} returned ${Array.isArray(result.data) ? result.data.length : 0} items`;
  }
  if (tool === 'generateStudyPlan') {
    const items = (result.data as { items?: unknown[] })?.items;
    return `plan preview generated ${items?.length ?? 0} items`;
  }
  if (tool === 'createStudyTask') {
    const data = result.data as { taskCount?: number; scheduledDate?: string };
    return `created ${data?.taskCount ?? 0} tasks for ${data?.scheduledDate ?? 'today'}`;
  }
  return `${tool} completed`;
}

function toPlanTrace(data: unknown, scheduledDate: string): StudyAgentRunResult['plan'] {
  const plan = data as { planId?: string | null; scheduledDate?: string; taskCount?: number; tasks?: Array<{ title?: string; mode?: string; minutes?: number; questionCount?: number; priority?: string }> };
  return {
    planId: plan?.planId ?? null,
    scheduledDate: plan?.scheduledDate ?? scheduledDate,
    taskCount: plan?.taskCount ?? 0,
    tasks: (plan?.tasks ?? []).slice(0, 8),
  };
}

function extractWeakNodes(context: Record<string, unknown> | null): Array<{ knowledgeNodeId: string; title: string }> {
  const mastery = context?.mastery as { weakNodes?: Array<{ knowledgeNodeId?: string; title?: string }> } | undefined;
  return (mastery?.weakNodes ?? [])
    .filter((node) => typeof node.knowledgeNodeId === 'string' && typeof node.title === 'string')
    .map((node) => ({ knowledgeNodeId: node.knowledgeNodeId!, title: node.title! }));
}

function buildWorkflowSummary(weakCount: number, wrongCount: number, previewCount: number, created: boolean, scheduledDate: string): string {
  const parts = [
    `已读取你的学习上下文：${weakCount} 个薄弱知识点、${wrongCount} 道未解决错题。`,
    `推荐引擎为 ${scheduledDate} 预排了 ${previewCount} 项学习建议。`,
  ];
  if (created) parts.push('学习任务已通过计划写入路径创建，可在今日任务中查看。');
  else parts.push('本次未创建任务；如需落地执行，请确认后让我创建今日任务。');
  return parts.join('');
}

function buildWorkflowSuggestions(wrongQuestions: Array<Record<string, unknown>>, preview: { items?: Array<Record<string, unknown>> } | null): string[] {
  const suggestions: string[] = [];
  const topWrong = wrongQuestions[0] as { knowledgePointTitle?: string | null } | undefined;
  if (topWrong?.knowledgePointTitle) suggestions.push(`优先复盘错题知识点：${topWrong.knowledgePointTitle}`);
  for (const item of (preview?.items ?? []).slice(0, 3)) {
    if (typeof item.title === 'string') suggestions.push(`${item.title}（预计 ${item.estimatedMinutes ?? '?'} 分钟）`);
  }
  if (suggestions.length === 0) suggestions.push('暂无足够数据生成建议，先完成一次练习或测评。');
  return suggestions.slice(0, 5);
}