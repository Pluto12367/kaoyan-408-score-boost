import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Question } from '@kaoyan408/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface PersistedPaper {
  id: string;
  title: string;
  paperType: PersistedPaperType;
  questionCount: number;
  knowledgePointIds: string[];
  questions: Question[];
  estimatedMinutes: number;
  createdBy: string;
  createdAt: string;
}

export type PersistedPaperType = '模拟卷' | '阶段卷' | '专项卷';

@Injectable()
export class PaperRepository {
  constructor(private readonly prisma: PrismaService) {}

  get enabled() {
    return Boolean(process.env.DATABASE_URL);
  }

  async loadAll(): Promise<PersistedPaper[]> {
    if (!this.enabled) return [];
    const rows = await this.prisma.paper.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      paperType: row.paperType as PersistedPaperType,
      questionCount: row.questionCount,
      knowledgePointIds: row.knowledgePointIds,
      questions: Array.isArray(row.questions) ? row.questions as unknown as Question[] : [],
      estimatedMinutes: row.estimatedMinutes,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async save(paper: PersistedPaper): Promise<void> {
    if (!this.enabled) return;
    const data = {
      title: paper.title,
      paperType: paper.paperType,
      questionCount: paper.questionCount,
      knowledgePointIds: paper.knowledgePointIds,
      questions: paper.questions as unknown as Prisma.InputJsonValue,
      estimatedMinutes: paper.estimatedMinutes,
      createdBy: paper.createdBy,
      createdAt: new Date(paper.createdAt),
    };
    await this.prisma.paper.upsert({
      where: { id: paper.id },
      create: { id: paper.id, ...data },
      update: data,
    });
  }
}
