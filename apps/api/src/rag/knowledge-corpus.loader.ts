/**
 * Knowledge Corpus Loader (Nest Service).
 *
 * Loads knowledge nodes, relations, and question analyses from the database.
 * Falls back to empty corpus when DATABASE_URL is not configured.
 */

import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

import type {
  KnowledgeNodeCorpusInput,
  KnowledgeQuestionCorpusInput,
  KnowledgeRelationCorpusInput,
} from './knowledge-corpus';

@Injectable()
export class KnowledgeCorpusLoader {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  async load(): Promise<{
    nodes: readonly KnowledgeNodeCorpusInput[];
    relations: readonly KnowledgeRelationCorpusInput[];
    questions: readonly KnowledgeQuestionCorpusInput[];
    available: boolean;
  }> {
    if (!this.prisma || !process.env.DATABASE_URL) {
      return { nodes: [], relations: [], questions: [], available: false };
    }

    const db = this.prisma;

    // Load active knowledge nodes with chapter path
    const nodeRows = await db.knowledgeNode.findMany({
      where: { isActive: true },
      select: {
        id: true,
        subject: true,
        nodeType: true,
        name: true,
        importance: true,
        difficulty: true,
        parent: {
          select: {
            name: true,
            parent: { select: { name: true } },
          },
        },
      },
    });

    const nodes: KnowledgeNodeCorpusInput[] = nodeRows.map((row: any) => {
      const chapterPath: string[] = [];
      if (row.parent) {
        if (row.parent.parent) chapterPath.push(row.parent.parent.name);
        if (row.parent.name) chapterPath.push(row.parent.name);
      }
      return {
        id: row.id,
        subject: row.subject,
        nodeType: row.nodeType,
        name: row.name,
        importance: row.importance,
        difficulty: row.difficulty,
        chapterPath,
      };
    });

    // Load relations
    const relationRows = await db.knowledgeRelation.findMany({
      select: { fromId: true, toId: true, type: true },
    });
    const relations: KnowledgeRelationCorpusInput[] = relationRows;

    // Load current questions with analysis
    const questionRows = await db.question.findMany({
      where: { isCurrent: true },
      take: 2000,
      select: {
        id: true,
        stem: true,
        analysis: true,
        knowledgeNodeTags: {
          select: { knowledgeNodeId: true },
        },
      },
    });

    const questions: KnowledgeQuestionCorpusInput[] = questionRows
      .filter((q: any) => q.analysis && q.analysis.trim())
      .map((q: any) => ({
        id: q.id,
        stem: q.stem,
        analysis: q.analysis,
        knowledgeNodeIds: q.knowledgeNodeTags.map((t: any) => t.knowledgeNodeId),
      }));

    return { nodes, relations, questions, available: true };
  }
}