/**
 * Tutor Service (Phase PX-4) — one-on-one AI tutor over real node facts.
 *
 * start:  RAG-retrieves the knowledge node, reads mastery evidence and
 *         recorded mistake reasons, then builds a Socratic question
 *         sequence. The tutor asks — it does not hand over the answer.
 * explain: three-level explanation (beginner/exam/interview) over the same
 *          node facts.
 * check:  rule-based understanding check for a student reply.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  buildSocraticSequence,
  buildLayeredExplanation,
  checkUnderstanding,
  detectMisconceptions,
  type SocraticQuestion,
  type ExplanationLevel,
  type MisconceptionPattern,
} from './tutor-mode';
import { StudyAgentToolRegistry } from './agent-tools';

export interface TutorSessionStart {
  sessionId: string;
  node: { knowledgeNodeId: string; title: string; subject: string; chapterPath: string[]; mastery: number | null };
  misconceptions: MisconceptionPattern[];
  questions: SocraticQuestion[];
  teachingPlan: string;
}

@Injectable()
export class TutorService {
  private readonly logger = new Logger(TutorService.name);

  constructor(private readonly tools: StudyAgentToolRegistry) {}

  async start(userId: string, input: { knowledgeNodeId?: string; topic?: string }, now: Date = new Date()): Promise<TutorSessionStart> {
    let node: TutorSessionStart['node'] | null = null;
    if (input.knowledgeNodeId?.trim()) {
      const detail = await this.tools.execute(userId, 'searchKnowledge', { query: input.knowledgeNodeId, topK: 1 }, now);
      const hit = detail.ok ? (detail.data as { results?: Array<{ knowledgeNodeId: string; title: string; subject: string; chapterPath: string[] }> }).results?.[0] : null;
      if (hit) node = { knowledgeNodeId: hit.knowledgeNodeId, title: hit.title, subject: hit.subject, chapterPath: [...hit.chapterPath], mastery: null };
    }
    if (!node && input.topic?.trim()) {
      const search = await this.tools.execute(userId, 'searchKnowledge', { query: input.topic, topK: 1 }, now);
      const hit = search.ok ? (search.data as { results?: Array<{ knowledgeNodeId: string; title: string; subject: string; chapterPath: string[] }> }).results?.[0] : null;
      if (hit) node = { knowledgeNodeId: hit.knowledgeNodeId, title: hit.title, subject: hit.subject, chapterPath: [...hit.chapterPath], mastery: null };
    }
    if (!node) {
      // Fallback: anchor on the student's weakest node from canonical context.
      const contextResult = await this.tools.execute(userId, 'getStudentContext', {}, now);
      const weak = contextResult.ok
        ? (contextResult.data as { mastery?: { weakNodes?: Array<{ knowledgeNodeId: string; title: string; subject: string; chapter?: string; mastery?: number }> } }).mastery?.weakNodes?.[0]
        : null;
      if (weak) {
        node = {
          knowledgeNodeId: weak.knowledgeNodeId,
          title: weak.title,
          subject: weak.subject,
          chapterPath: weak.chapter ? [weak.chapter] : [],
          mastery: weak.mastery ?? null,
        };
      }
    }
    if (!node) {
      node = { knowledgeNodeId: 'unknown', title: '尚未确定知识点', subject: '', chapterPath: [], mastery: null };
    }

    // Mastery evidence + recorded mistake reasons via read-only tools.
    const contextResult = await this.tools.execute(userId, 'getStudentContext', {}, now);
    const context = contextResult.ok ? (contextResult.data as Record<string, any>) : null;
    const matched = context?.mastery?.weakNodes?.find((weak: { knowledgeNodeId?: string }) => weak.knowledgeNodeId === node!.knowledgeNodeId);
    node.mastery = matched?.mastery ?? node.mastery ?? null;

    const wrongResult = await this.tools.execute(userId, 'getWrongQuestions', {}, now);
    const wrongItems = wrongResult.ok && Array.isArray(wrongResult.data) ? (wrongResult.data as Array<Record<string, unknown>>) : [];
    const related = wrongItems.filter((item) => item.knowledgePointTitle === node!.title);
    const { patterns } = detectMisconceptions({
      mistakeReasons: related.map((item) => String(item.latestMistakeReason ?? '')),
      questionTitles: related.map((item) => String(item.stem ?? '')),
    });

    const questions = buildSocraticSequence(
      { knowledgeNodeId: node.knowledgeNodeId, title: node.title, subject: node.subject, chapterPath: node.chapterPath, mastery: node.mastery },
      patterns.map((pattern) => pattern.label),
    );

    const teachingPlan = patterns[0]
      ? `检测到「${patterns[0].label}」倾向：${patterns[0].teachingRecommendation}`
      : '未检测到明显误区模式：按回忆→为什么→应用三步推进。';

    const sessionId = `tutor-${userId}-${now.getTime()}`;
    this.logger.log(JSON.stringify({ event: 'tutor_session.started', userId, node: node.knowledgeNodeId, patterns: patterns.length }));
    return {
      sessionId,
      node: { knowledgeNodeId: node.knowledgeNodeId, title: node.title, subject: node.subject, chapterPath: [...node.chapterPath], mastery: node.mastery },
      misconceptions: patterns,
      questions,
      teachingPlan,
    };
  }

  async explain(userId: string, input: { knowledgeNodeId?: string; topic?: string; level: ExplanationLevel }, now: Date = new Date()) {
    const session = await this.start(userId, { knowledgeNodeId: input.knowledgeNodeId, topic: input.topic }, now);
    const explanation = buildLayeredExplanation(
      { knowledgeNodeId: session.node.knowledgeNodeId, title: session.node.title, subject: session.node.subject, chapterPath: session.node.chapterPath, mastery: session.node.mastery },
      input.level,
    );
    return {
      sessionId: session.sessionId,
      level: input.level,
      node: session.node,
      explanation,
      knowledgeRefs: [session.node.knowledgeNodeId].filter((ref) => ref !== 'unknown'),
      followUpQuestions: session.questions.slice(0, 2).map((question) => question.question),
    };
  }

  async check(userId: string, input: { expected: SocraticQuestion; reply: string }) {
    void userId;
    return checkUnderstanding(input.reply, input.expected);
  }
}