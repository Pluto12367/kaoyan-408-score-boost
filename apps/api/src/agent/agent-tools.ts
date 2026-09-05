/**
 * Study Agent Tool Registry (Phase AI-3).
 *
 * Six tools over EXISTING services only — the registry itself holds no
 * database handle and no write primitive:
 *
 *   getStudentContext  → StudentContextQueryService.getContext        (read)
 *   searchKnowledge    → KnowledgeSearchService.search                (read, RAG)
 *   searchQuestion     → QuestionsService.listQuestions               (read)
 *   getWrongQuestions  → WrongQuestionQueryService.getWrongQuestionsCompat (read)
 *   generateStudyPlan  → RecommendationService.runRecommendationForUser (read/preview)
 *   createStudyTask    → RecommendationService.generateDailyPlanFromState (WRITE via canonical plan writer)
 *
 * Hard boundaries (enforced by tests):
 * - No database client reference; write happens only inside the existing service.
 * - All outputs are bounded (slices) for token control.
 * - Tool names and arguments are whitelist-validated before dispatch.
 */

import { Logger } from '@nestjs/common';
import type { QuestionsService } from '../questions/questions.service';
import type { RecommendationService } from '../study/recommendation.service';
import type { StudentContextQueryService } from '../study/student-context.query.service';
import type { WrongQuestionQueryService } from '../study/wrong-question-query.service';
import type { KnowledgeSearchService } from '../rag/knowledge-search.service';

export const AGENT_TOOL_NAMES = [
  'getStudentContext',
  'searchKnowledge',
  'searchQuestion',
  'getWrongQuestions',
  'generateStudyPlan',
  'createStudyTask',
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

export interface AgentToolDefinition {
  name: AgentToolName;
  description: string;
  parameters: Record<string, { type: 'string' | 'number' | 'boolean'; description: string; enum?: string[] }>;
  readOnly: boolean;
}

export interface AgentToolResult {
  ok: boolean;
  data: unknown;
  error?: string;
}

export interface StudyAgentToolDeps {
  studentContext: Pick<StudentContextQueryService, 'getContext'>;
  knowledgeSearch: Pick<KnowledgeSearchService, 'search'>;
  questions: Pick<QuestionsService, 'listQuestions'>;
  wrongQuestions: Pick<WrongQuestionQueryService, 'getWrongQuestionsCompat'>;
  recommendation: Pick<RecommendationService, 'runRecommendationForUser' | 'generateDailyPlanFromState'>;
}

const SUBJECT_CODES = ['DS', 'CO', 'OS', 'CN'] as const;
const AVAILABLE_MINUTES = [30, 60, 120, 180] as const;
const MAX_QUESTION_RESULTS = 10;
const MAX_WRONG_RESULTS = 10;
const MAX_PLAN_PREVIEW_ITEMS = 8;
const MAX_PLAN_TASKS_IN_RESULT = 8;
const DEFAULT_EXAM_HORIZON_DAYS = 180;

export function listStudyAgentTools(): AgentToolDefinition[] {
  return [
    {
      name: 'getStudentContext',
      description: '读取学生当前学习上下文（掌握度薄弱节点、练习趋势、复习到期、今日任务、学习动力）。无参数。',
      parameters: {},
      readOnly: true,
    },
    {
      name: 'searchKnowledge',
      description: '按语义检索 408 知识节点（RAG）。返回 knowledgeNodeId、科目、标题、相关节点与相关性分数。',
      parameters: {
        query: { type: 'string', description: '检索文本，例如"死锁产生条件"' },
        subject: { type: 'string', description: '可选科目过滤', enum: [...SUBJECT_CODES] },
        topK: { type: 'number', description: '返回数量 1-5，默认 3' },
      },
      readOnly: true,
    },
    {
      name: 'searchQuestion',
      description: '按知识点/科目/章节搜索题库题目（仅返回题干等安全字段，不含答案）。',
      parameters: {
        knowledgePointId: { type: 'string', description: '可选知识点 ID' },
        subject: { type: 'string', description: '可选科目代码', enum: [...SUBJECT_CODES] },
      },
      readOnly: true,
    },
    {
      name: 'getWrongQuestions',
      description: '读取学生当前未解决错题（题干、知识点、错误次数、最近错因）。',
      parameters: {
        subject: { type: 'string', description: '可选科目代码', enum: [...SUBJECT_CODES] },
      },
      readOnly: true,
    },
    {
      name: 'generateStudyPlan',
      description: '生成学习计划预览（只读，不落库）。基于推荐引擎计算优先任务建议。',
      parameters: {
        availableMinutes: { type: 'number', description: '可用学习分钟数', enum: AVAILABLE_MINUTES.map(String) },
        targetExamDate: { type: 'string', description: '可选考试日期 ISO' },
      },
      readOnly: true,
    },
    {
      name: 'createStudyTask',
      description: '创建今日学习任务（写入）。通过推荐引擎的 canonical 计划写入路径生成 StudyPlan+StudyTask，幂等（generationKey）。',
      parameters: {
        scheduledDate: { type: 'string', description: '计划日期 YYYY-MM-DD，默认今天' },
        availableMinutes: { type: 'number', description: '可用学习分钟数', enum: AVAILABLE_MINUTES.map(String) },
        targetExamDate: { type: 'string', description: '可选考试日期 ISO' },
      },
      readOnly: false,
    },
  ];
}

export class StudyAgentToolRegistry {
  private readonly logger = new Logger(StudyAgentToolRegistry.name);

  constructor(private readonly deps: StudyAgentToolDeps) {}

  listTools(): AgentToolDefinition[] {
    return listStudyAgentTools();
  }

  async execute(userId: string, tool: string, args: Record<string, unknown> = {}, now: Date = new Date()): Promise<AgentToolResult> {
    if (!AGENT_TOOL_NAMES.includes(tool as AgentToolName)) {
      return { ok: false, data: null, error: `unknown tool: ${tool}` };
    }
    try {
      switch (tool as AgentToolName) {
        case 'getStudentContext':
          return { ok: true, data: await this.deps.studentContext.getContext(userId) };
        case 'searchKnowledge':
          return { ok: true, data: await this.searchKnowledge(args) };
        case 'searchQuestion':
          return { ok: true, data: this.searchQuestion(args) };
        case 'getWrongQuestions':
          return { ok: true, data: await this.getWrongQuestions(userId, args) };
        case 'generateStudyPlan':
          return { ok: true, data: await this.generateStudyPlanPreview(userId, args, now) };
        case 'createStudyTask':
          return { ok: true, data: await this.createStudyTask(userId, args, now) };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`agent tool ${tool} failed: ${message}`);
      return { ok: false, data: null, error: message };
    }
  }

  private async searchKnowledge(args: Record<string, unknown>) {
    const query = requiredString(args, 'query');
    const subject = optionalEnum(args, 'subject', SUBJECT_CODES);
    const topK = clampNumber(args.topK, 1, 5, 3);
    const response = await this.deps.knowledgeSearch.search(query, {
      topK,
      ...(subject ? { subject } : {}),
    });
    return response;
  }

  private searchQuestion(args: Record<string, unknown>) {
    const filters: { knowledgePointId?: string; subject?: string } = {};
    const knowledgePointId = optionalString(args, 'knowledgePointId');
    if (knowledgePointId) filters.knowledgePointId = knowledgePointId;
    const subject = optionalEnum(args, 'subject', SUBJECT_CODES);
    if (subject) filters.subject = subject;
    const questions = this.deps.questions.listQuestions(filters).slice(0, MAX_QUESTION_RESULTS);
    // Student-safe projection: stems only, no answers/analysis in agent context.
    return questions.map((question) => ({
      id: question.id,
      stem: question.stem.slice(0, 160),
      type: question.type,
      difficulty: question.difficulty,
      knowledgePointIds: question.knowledgePointIds.slice(0, 3),
    }));
  }

  private async getWrongQuestions(userId: string, args: Record<string, unknown>) {
    const items = await this.deps.wrongQuestions.getWrongQuestionsCompat(userId);
    return items.slice(0, MAX_WRONG_RESULTS).map((item) => ({
      questionId: item.questionId,
      stem: String(item.stem ?? '').slice(0, 120),
      knowledgePointId: item.knowledgePointId,
      knowledgePointTitle: item.knowledgePointTitle,
      wrongCount: item.wrongCount,
      latestMistakeReason: item.latestMistakeReason,
    }));
  }

  private async generateStudyPlanPreview(userId: string, args: Record<string, unknown>, now: Date) {
    const { result, nodeById } = await this.deps.recommendation.runRecommendationForUser(userId, {
      availableMinutes: availableMinutesArg(args),
      ...(targetExamDateArg(args, now) ? { targetExamDate: targetExamDateArg(args, now)! } : {}),
    });
    return {
      preview: true,
      generatedAt: now.toISOString(),
      items: result.items
        .filter((item) => item.kind === 'TASK_DRAFT')
        .slice(0, MAX_PLAN_PREVIEW_ITEMS)
        .map((item) => {
          const node = nodeById.get(item.knowledgeNodeId);
          return {
            knowledgeNodeId: item.knowledgeNodeId,
            subject: node?.subject ?? null,
            title: node?.name ?? item.knowledgeNodeId,
            action: item.action,
            score: item.score,
            estimatedMinutes: item.estimatedMinutes,
            reasonCodes: item.reasonCodes,
          };
        }),
    };
  }

  private async createStudyTask(userId: string, args: Record<string, unknown>, now: Date) {
    const scheduledDate = optionalString(args, 'scheduledDate') ?? dateKey(now);
    const plan = await this.deps.recommendation.generateDailyPlanFromState(userId, {
      targetExamDate: targetExamDateArg(args, now) ?? defaultExamDate(now),
      availableMinutes: availableMinutesArg(args),
      scheduledDate,
      generationKey: `AGENT:${userId}:${scheduledDate}:v1`,
      source: 'study-agent',
      version: 'study-agent-v1',
    });
    const tasks = Array.isArray((plan as { tasks?: unknown }).tasks) ? (plan as { tasks: unknown[] }).tasks : [];
    return {
      planId: (plan as { id?: string }).id,
      scheduledDate,
      taskCount: tasks.length,
      tasks: tasks.slice(0, MAX_PLAN_TASKS_IN_RESULT).map((task) => {
        const t = task as { title?: string; mode?: string; minutes?: number; questionCount?: number; priority?: string };
        return {
          title: t.title,
          mode: t.mode,
          minutes: t.minutes,
          questionCount: t.questionCount,
          priority: t.priority,
        };
      }),
    };
  }
}

// ---- shared arg helpers ----

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = typeof args[key] === 'string' ? (args[key] as string).trim() : '';
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = typeof args[key] === 'string' ? (args[key] as string).trim() : '';
  return value || undefined;
}

function optionalEnum<T extends readonly string[]>(args: Record<string, unknown>, key: string, allowed: T): T[number] | undefined {
  const value = optionalString(args, key);
  if (value === undefined) return undefined;
  const match = allowed.find((option) => option === value);
  if (!match) throw new Error(`${key} must be one of ${allowed.join(', ')}`);
  return match as T[number];
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function availableMinutesArg(args: Record<string, unknown>): 30 | 60 | 120 | 180 {
  const raw = typeof args.availableMinutes === 'number' ? args.availableMinutes : Number.parseInt(String(args.availableMinutes ?? ''), 10);
  const match = AVAILABLE_MINUTES.find((option) => option === raw);
  return match ?? 60;
}

function targetExamDateArg(args: Record<string, unknown>, now: Date): Date | null {
  const raw = optionalString(args, 'targetExamDate');
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new Error('targetExamDate must be a valid ISO date');
  if (date.getTime() < now.getTime() - 86_400_000) throw new Error('targetExamDate must not be far in the past');
  return date;
}

/** Fallback exam horizon when neither args nor student facts provide one. */
export function defaultExamDate(now: Date): Date {
  return new Date(now.getTime() + DEFAULT_EXAM_HORIZON_DAYS * 86_400_000);
}

function dateKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}