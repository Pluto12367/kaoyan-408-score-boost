import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolvePrimaryNodeByQuestion } from './question-node-resolution';
import {
  buildErrorPatterns,
  type ErrorPatternAttemptFact,
  type ErrorPatternsResult,
} from '@kaoyan408/shared';

/**
 * V13-A1 — Error Pattern read projection.
 *
 * Answers "why did this student get things wrong recently" from exactly two
 * OBSERVED evidence sources (task §9 — never from mastery or score data):
 *
 *   1. wrong PracticeRecords  → source=auto         (server classifyMistake label)
 *   2. wrong review redos     → source=self_reported (ReviewAttempt.reportedReason)
 *
 * Boundaries (mirrors PracticePatternService):
 *   • READ-ONLY — no write primitive exists in this file.
 *   • BOUNDED   — every list read carries an explicit take.
 *   • PROJECTION — aggregation lives in the shared pure module
 *     (`buildErrorPatterns`); nothing is persisted, no second SoT.
 *   • HONEST ABSENCE — without DATABASE_URL it returns storeAvailable:false.
 */

export const ERROR_PATTERN_WINDOW = {
  defaultDays: 7,
  minDays: 1,
  maxDays: 90,
  maxPracticeAttempts: 500,
  maxReviewAttempts: 200,
} as const;

export interface ErrorPatternsView extends ErrorPatternsResult {
  readonly userId: string;
  readonly generatedAt: string;
  readonly storeAvailable: boolean;
  readonly reason?: string;
}

@Injectable()
export class ErrorPatternService {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  get enabled(): boolean {
    return Boolean(process.env.DATABASE_URL && this.prisma);
  }

  clampDays(days: number | undefined | null): number {
    if (days == null || !Number.isFinite(days)) return ERROR_PATTERN_WINDOW.defaultDays;
    return Math.min(ERROR_PATTERN_WINDOW.maxDays, Math.max(ERROR_PATTERN_WINDOW.minDays, Math.trunc(days)));
  }

  /**
   * V13-A2 — shared loader for wrong-attempt facts (practice + wrong review
   * redos), enriched with subject/node/subtype/type. Public so the diagnosis
   * projection composes the SAME evidence instead of duplicating loaders.
   */
  async loadAttemptFacts(userId: string, windowDays: number, now: Date): Promise<ErrorPatternAttemptFact[]> {
    const from = new Date(now.getTime() - windowDays * 86_400_000);
    const [records, reviewAttempts] = await Promise.all([
      this.prisma!.practiceRecord.findMany({
        where: { userId, correct: false, submittedAt: { gte: from } },
        orderBy: { submittedAt: 'desc' },
        take: ERROR_PATTERN_WINDOW.maxPracticeAttempts,
        select: { questionId: true, mistakeReason: true, submittedAt: true },
      }),
      this.prisma!.reviewAttempt.findMany({
        where: { schedule: { userId }, redoCorrect: false, reviewedAt: { gte: from } },
        orderBy: { reviewedAt: 'desc' },
        take: ERROR_PATTERN_WINDOW.maxReviewAttempts,
        select: { reportedReason: true, reviewedAt: true, schedule: { select: { questionId: true } } },
      }),
    ]);

    const questionIds = [
      ...new Set([
        ...records.map((row) => row.questionId),
        ...reviewAttempts.map((row) => row.schedule.questionId),
      ]),
    ];
    if (questionIds.length === 0) return [];
    const nodeByQuestion = await resolvePrimaryNodeByQuestion(this.prisma!, questionIds);
    const nodeIds = [...new Set([...nodeByQuestion.values()].map((resolved) => resolved.nodeId))];
    const [nodes, questions] = await Promise.all([
      this.prisma!.knowledgeNode.findMany({
        where: { id: { in: nodeIds } },
        select: { id: true, subject: true },
      }),
      this.prisma!.question.findMany({
        where: { id: { in: questionIds } },
        // V13-P0-1: subtype comes from the DB row (the authoritative 408 layer);
        // in-memory question objects carry the Chinese form label instead.
        select: { id: true, type: true, questionSubtype: true },
      }),
    ]);

    const subjectByNode = new Map(nodes.map((node) => [node.id, node.subject]));
    const typeByQuestion = new Map(questions.map((question) => [question.id, String(question.type)]));
    const subtypeByQuestion = new Map(questions.map((question) => [question.id, question.questionSubtype as string | null]));

    const practiceFacts: ErrorPatternAttemptFact[] = records.map((row) => {
      const resolved = nodeByQuestion.get(row.questionId);
      return {
        source: 'auto' as const,
        subject: resolved ? subjectByNode.get(resolved.nodeId) ?? null : null,
        nodeId: resolved?.nodeId ?? null,
        questionId: row.questionId,
        questionType: typeByQuestion.get(row.questionId) ?? null,
        questionSubtype: subtypeByQuestion.get(row.questionId) ?? null,
        reasonRaw: row.mistakeReason,
        occurredAt: row.submittedAt.toISOString(),
      };
    });
    const reviewFacts: ErrorPatternAttemptFact[] = reviewAttempts.map((row) => {
      const questionId = row.schedule.questionId;
      const resolved = nodeByQuestion.get(questionId);
      return {
        source: 'self_reported' as const,
        subject: resolved ? subjectByNode.get(resolved.nodeId) ?? null : null,
        nodeId: resolved?.nodeId ?? null,
        questionId,
        questionType: typeByQuestion.get(questionId) ?? null,
        questionSubtype: subtypeByQuestion.get(questionId) ?? null,
        reasonRaw: row.reportedReason,
        occurredAt: row.reviewedAt.toISOString(),
      };
    });
    return [...practiceFacts, ...reviewFacts];
  }

  async getErrorPatterns(userId: string, options: { days?: number } = {}, now: Date = new Date()): Promise<ErrorPatternsView> {
    const generatedAt = now.toISOString();
    const windowDays = this.clampDays(options.days);
    if (!this.enabled) {
      return {
        userId,
        generatedAt,
        storeAvailable: false,
        reason: 'store_unavailable',
        window: { days: windowDays, from: new Date(now.getTime() - windowDays * 86_400_000).toISOString(), to: generatedAt },
        totals: { wrongCount: 0, attributedCount: 0, nodeUnattributedCount: 0, unclassifiedCount: 0, bySubtype: {} },
        attemptsCounted: 0,
        patterns: [],
        byReason: [],
      };
    }

    const attempts = await this.loadAttemptFacts(userId, windowDays, now);

    const projection = buildErrorPatterns({ now: generatedAt, windowDays, attempts });
    return { userId, generatedAt, storeAvailable: true, ...projection, patterns: projection.patterns };
  }
}
