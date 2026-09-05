/**
 * Exam Question Repository (PX follow-up) — read-only node-precise lookup.
 *
 * Closes the coverage-granularity gap recorded in
 * docs/px-ai-learning-companion-final-report.md §6.3: exam papers can now
 * select questions by their REAL QuestionKnowledgeNodeTag node labels
 * instead of the subject-level approximation.
 *
 * Read-only by contract: no write methods, bounded take, current-version
 * questions only, and a student-safe projection (never answers/analysis).
 */

import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface NodeExamQuestion {
  id: string;
  stem: string;
  type: string;
  difficulty: 'BASIC' | 'MEDIUM' | 'HARD';
  knowledgePointIds: readonly string[];
  subject?: string;
}

@Injectable()
export class ExamQuestionRepository {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  get enabled() {
    return Boolean(process.env.DATABASE_URL && this.prisma);
  }

  /**
   * Current-version questions tagged with any of the given knowledge nodes.
   * Deduplicated by question id (a question may carry several node tags);
   * knowledgePointIds carries the matched node ids for mastery weighting.
   */
  async listByNode(nodeIds: readonly string[], limit = 60): Promise<NodeExamQuestion[]> {
    if (!this.enabled || nodeIds.length === 0) return [];
    const rows = await this.prisma!.questionKnowledgeNodeTag.findMany({
      where: {
        knowledgeNodeId: { in: [...nodeIds] },
        question: { isCurrent: true },
      },
      take: Math.max(limit * 3, 30),
      select: {
        knowledgeNodeId: true,
        question: {
          select: { id: true, stem: true, type: true, difficulty: true },
        },
      },
    });

    const byQuestion = new Map<string, NodeExamQuestion>();
    for (const row of rows) {
      const question = row.question;
      if (!question) continue;
      const existing = byQuestion.get(question.id);
      if (existing) {
        if (!existing.knowledgePointIds.includes(row.knowledgeNodeId)) {
          existing.knowledgePointIds = [...existing.knowledgePointIds, row.knowledgeNodeId];
        }
        continue;
      }
      byQuestion.set(question.id, {
        id: question.id,
        stem: String(question.stem ?? '').slice(0, 160),
        type: String(question.type ?? ''),
        difficulty: (['BASIC', 'MEDIUM', 'HARD'] as const).includes(question.difficulty as 'BASIC')
          ? (question.difficulty as 'BASIC' | 'MEDIUM' | 'HARD')
          : 'MEDIUM',
        knowledgePointIds: [row.knowledgeNodeId],
      });
    }
    return [...byQuestion.values()].slice(0, limit);
  }
}