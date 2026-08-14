import { Injectable } from '@nestjs/common';
import { Subject as PrismaSubject } from '@prisma/client';
import type { KnowledgePoint, Subject } from '@kaoyan408/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class KnowledgePointRepository {
  constructor(private readonly prisma: PrismaService) {}

  get enabled() {
    return Boolean(process.env.DATABASE_URL);
  }

  async list(): Promise<KnowledgePoint[]> {
    if (!this.enabled) return [];
    const rows = await this.prisma.knowledgePoint.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map((row) => ({
      id: row.id,
      subject: fromPrismaSubject(row.subject),
      chapter: row.chapter,
      title: row.title,
      importance: row.importance,
      frequency: row.frequency,
      prerequisites: row.prerequisites,
    }));
  }

  async save(point: KnowledgePoint) {
    if (!this.enabled) return;
    await this.prisma.knowledgePoint.create({
      data: {
        id: point.id,
        subject: toPrismaSubject(point.subject),
        chapter: point.chapter,
        title: point.title,
        importance: point.importance,
        frequency: point.frequency,
        prerequisites: point.prerequisites,
      },
    });
  }

  async listNodeMaps(): Promise<Map<string, { title: string; chapter: string }>> {
    const display = new Map<string, { title: string; chapter: string }>();
    if (!this.enabled) return display;
    const rows = await this.prisma.knowledgePointNodeMap.findMany({
      where: { mappingType: 'PRIMARY' },
      include: {
        knowledgeNode: {
          include: { parent: { include: { parent: true } } },
        },
      },
    });
    for (const row of rows) {
      const node = row.knowledgeNode;
      const chapter = node.parent?.parent?.name ?? node.parent?.name ?? '';
      display.set(row.knowledgePointId, { title: node.name, chapter });
    }
    return display;
  }
}

function toPrismaSubject(subject: Subject): PrismaSubject {
  if (subject === '数据结构') return PrismaSubject.DATA_STRUCTURE;
  if (subject === '计算机组成原理') return PrismaSubject.COMPUTER_ORGANIZATION;
  if (subject === '操作系统') return PrismaSubject.OPERATING_SYSTEM;
  return PrismaSubject.COMPUTER_NETWORK;
}

function fromPrismaSubject(subject: PrismaSubject): Subject {
  if (subject === PrismaSubject.DATA_STRUCTURE) return '数据结构';
  if (subject === PrismaSubject.COMPUTER_ORGANIZATION) return '计算机组成原理';
  if (subject === PrismaSubject.OPERATING_SYSTEM) return '操作系统';
  return '计算机网络';
}
