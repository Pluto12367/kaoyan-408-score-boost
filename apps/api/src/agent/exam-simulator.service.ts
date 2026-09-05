/**
 * Exam Simulator Service (Phase PX-3).
 *
 * generate: StudentContext mastery + RAG V2 retrieval (real knowledge
 * nodes) + engine priorities → real question-bank selection (pure builder).
 * The LLM is NOT involved in content generation — knowledge nodes come from
 * the database via RAG and questions come from the question bank.
 *
 * analyze: exam answer facts → deterministic per-point analysis → next-step
 * plan proposal through the planner (validate-only unless execute=true).
 * Writing mastery happens exclusively through the existing practice
 * submission path (ScoreCenterService) when the student actually answers;
 * this service never writes mastery directly.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { buildExamPaper, analyzeExam, type ExamCandidateQuestion, type ExamAnswerFact, type ExamAnalysis } from './exam-simulator';
import type { GeneratedExamPaper } from './exam-simulator';
import { StudyAgentToolRegistry } from './agent-tools';
import { ExamQuestionRepository } from './exam-question.repository';
import { AiMetricsService } from '../ai-metrics/ai-metrics.service';

export interface ExamGenerationInput {
  subject?: 'DS' | 'CO' | 'OS' | 'CN';
  questionCount?: number;
}

export interface ExamGenerationResult {
  paper: GeneratedExamPaper;
  knowledgeContext: {
    retrievedNodes: Array<{ knowledgeNodeId: string; title: string; subject: string }>;
    enginePriorities: Array<{ knowledgeNodeId: string; title: string; score: number }>;
  };
  note: string;
}

export interface ExamAnalysisInput {
  /** Answer facts from the submitted mock paper. */
  facts: ExamAnswerFact[];
  /** Kept for protocol compatibility; next steps are deterministic and
   * plan execution stays with the planner agent via the supervisor. */
  includePlan?: boolean;
}

@Injectable()
export class ExamSimulatorService {
  private readonly logger = new Logger(ExamSimulatorService.name);

  constructor(
    private readonly tools: StudyAgentToolRegistry,
    // PX follow-up: node-precise question lookup (read-only). Optional so
    // legacy compositions keep working; when unavailable or the database is
    // down the simulator falls back to the subject-level bank candidates.
    @Optional() private readonly examQuestions?: ExamQuestionRepository,
    @Optional() private readonly metrics?: AiMetricsService,
  ) {}

  async generateExam(userId: string, input: ExamGenerationInput, now: Date = new Date()): Promise<ExamGenerationResult> {
    const targetCount = Math.max(5, Math.min(50, input.questionCount ?? 10));

    // Real knowledge nodes via RAG V2 (retrieval, no invention).
    const searchQuery = input.subject ? `${input.subject} 考试 重点 考点` : '408 高频 考点';
    const knowledgeResult = await this.tools.execute(userId, 'searchKnowledge', { query: searchQuery, ...(input.subject ? { subject: input.subject } : {}), topK: 5 }, now);
    const retrievedNodes = knowledgeResult.ok
      ? ((knowledgeResult.data as { results?: Array<{ knowledgeNodeId: string; title: string; subject: string }> }).results ?? [])
      : [];

    // Engine priorities (frequency/weakness evidence) via read-only preview.
    const previewResult = await this.tools.execute(userId, 'generateStudyPlan', { availableMinutes: 60 }, now);
    const enginePriorities = previewResult.ok
      ? ((previewResult.data as { items?: Array<{ knowledgeNodeId: string; title?: string; score?: number }> }).items ?? [])
        .slice(0, 5)
        .map((item) => ({ knowledgeNodeId: item.knowledgeNodeId, title: String(item.title ?? item.knowledgeNodeId), score: item.score ?? 0 }))
      : [];

    // Student mastery evidence.
    const contextResult = await this.tools.execute(userId, 'getStudentContext', {}, now);
    const context = contextResult.ok ? (contextResult.data as Record<string, any>) : null;
    const masteryByPoint = new Map<string, number>();
    const buckets = ['weakNodes', 'improvingPoints', 'masteredPoints'] as const;
    for (const bucket of buckets) {
      for (const node of context?.mastery?.[bucket] ?? []) {
        if (typeof node.knowledgePointId === 'string' && typeof node.mastery === 'number') {
          masteryByPoint.set(node.knowledgePointId, node.mastery);
        }
        if (typeof node.knowledgeNodeId === 'string' && typeof node.mastery === 'number') {
          masteryByPoint.set(node.knowledgeNodeId, node.mastery);
        }
      }
    }
    const priorityByPoint = new Map<string, number>(enginePriorities.map((item) => [item.knowledgeNodeId, item.score]));

    // Real question-bank candidates (never LLM-generated).
    const candidatesResult = await this.tools.execute(userId, 'searchQuestion', input.subject ? { subject: input.subject } : {}, now);
    let candidates: ExamCandidateQuestion[] = (candidatesResult.ok ? (candidatesResult.data as ExamCandidateQuestion[]) : [])
      .map((question) => ({
        ...question,
        difficulty: (['BASIC', 'MEDIUM', 'HARD'] as const).includes(question.difficulty as 'BASIC') ? question.difficulty : 'MEDIUM' as const,
      }));

    // Node-precise candidates: real QuestionKnowledgeNodeTag labels for the
    // retrieved nodes (PX follow-up). Merged with dedup; precise candidates
    // carry the node id so mastery weighting applies directly.
    const nodeIds = [...new Set([
      ...retrievedNodes.map((node) => node.knowledgeNodeId),
      ...enginePriorities.map((item) => item.knowledgeNodeId),
    ])].filter(Boolean);
    if (this.examQuestions?.enabled && nodeIds.length > 0) {
      try {
        const precise = await this.examQuestions.listByNode(nodeIds, targetCount * 4);
        const seen = new Set(precise.map((question) => question.id));
        candidates = [...precise, ...candidates.filter((question) => !seen.has(question.id))];
      } catch (error) {
        this.logger.warn(`node-precise candidates unavailable, using subject-level bank: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const paper = buildExamPaper(candidates, {
      targetCount,
      ...(input.subject ? { subject: input.subject } : {}),
      masteryByPoint,
      priorityByPoint,
    });

    this.metrics?.recordAgentRun({
      mode: 'workflow',
      failed: !candidatesResult.ok || candidates.length === 0,
      toolCalls: 4,
      failedTools: [knowledgeResult, previewResult, contextResult, candidatesResult].filter((result) => !result.ok).length,
      durationMs: 0,
    });

    return {
      paper,
      knowledgeContext: { retrievedNodes, enginePriorities },
      note: '试卷题目全部来自真实题库；覆盖知识点来自 RAG 检索与推荐引擎的真实节点，无 LLM 生成内容。',
    };
  }

  async analyzeExam(userId: string, input: ExamAnalysisInput): Promise<{ analysis: ExamAnalysis; nextStepPlan?: unknown }> {
    const analysis = analyzeExam(input.facts);
    this.logger.log(JSON.stringify({
      event: 'exam_analyzed',
      userId,
      answeredCount: analysis.answeredCount,
      accuracyPercent: analysis.accuracyPercent,
      weakPoints: analysis.weakPoints.length,
    }));
    // Next-step plan execution stays with the planner agent (via the
    // supervisor protocol); the exam agent reports the facts only.
    return { analysis };
  }
}