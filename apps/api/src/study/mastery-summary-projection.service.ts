import { Injectable } from '@nestjs/common';
import {
  type StudentMasterySnapshot,
  type StudentWeakPointSnapshot,
} from './student-state.snapshot';

import {
  buildNodeMasteryMap,
  deriveNodeMasteryStatus,
  type NodeMasteryMap,
  type NodeMasteryPoint,
  type NodeMasteryRow,
  type Subject,
  type WeaknessReport,
} from '@kaoyan408/shared';
import { PrismaService } from '../prisma/prisma.service';

const SUBJECTS: Subject[] = ['数据结构', '计算机组成原理', '操作系统', '计算机网络'];

const SUBJECT_NAME_BY_CODE: Record<string, Subject | '未分类'> = {
  DS: '数据结构',
  DATA_STRUCTURE: '数据结构',
  CO: '计算机组成原理',
  COMPUTER_ORGANIZATION: '计算机组成原理',
  OS: '操作系统',
  OPERATING_SYSTEM: '操作系统',
  CN: '计算机网络',
  COMPUTER_NETWORK: '计算机网络',
};

export interface MasterySummaryProjection {
  userId: string;
  generatedAt: string;
  source: 'user_knowledge_mastery' | 'empty';
  nodeCount: number;
  practicedNodeCount: number;
  averageMastery: number;
  weakCount: number;
  reviewCount: number;
  masteredCount: number;
  subjects: MasterySubjectProjection[];
  weakPoints: MasteryWeakPointProjection[];
}

export interface MasterySubjectProjection {
  subject: Subject | '未分类';
  averageMastery: number;
  weakCount: number;
  reviewCount: number;
  masteredCount: number;
  points: MasteryPointProjection[];
}

export interface MasteryPointProjection {
  knowledgeNodeId: string;
  title: string;
  subject: Subject | '未分类';
  chapter: string;
  importance: number;
  frequency: number;
  masteryRate: number;
  accuracyRate: number;
  practiceCount: number;
  wrongCount: number;
  status: 'weak' | 'review' | 'mastered';
}

export interface MasteryWeakPointProjection extends MasteryPointProjection {
  weaknessScore: number;
  suggestion: string;
  topReason: string | null;
}

export interface ReportMasterySummary {
  source: 'user_knowledge_mastery';
  averageMastery: number;
  nodeCount: number;
  practicedNodeCount: number;
  weakCount: number;
  reviewCount: number;
  masteredCount: number;
}

export type ReportMasteryWeakPoint = WeaknessReport['weakPoints'][number] & {
  knowledgeNodeId: string;
};

export type ReportWithMasterySummary = WeaknessReport & {
  weakPoints: ReportMasteryWeakPoint[];
  masterySummary?: ReportMasterySummary;
  summary: WeaknessReport['summary'] | (Record<string, unknown> & { mastery?: ReportMasterySummary });
};

export interface StudentStateMasteryDto {
  mastery: StudentMasterySnapshot;
  weakPoints: StudentWeakPointSnapshot[];
}

export function toMasteryMapDto(projection: MasterySummaryProjection): NodeMasteryMap {
  const subjects = projection.subjects.map((subject) => ({
    subject: subject.subject,
    averageMastery: subject.averageMastery,
    weakCount: subject.weakCount,
    reviewCount: subject.reviewCount,
    masteredCount: subject.masteredCount,
    points: subject.points.map(toMasteryMapPoint),
  }));
  const weakestPoints = subjects
    .flatMap((subject) => subject.points.map((point) => ({ ...point, subject: subject.subject })))
    .sort((left, right) => left.masteryRate - right.masteryRate)
    .slice(0, 3);

  return {
    userId: projection.userId,
    title: '408 掌握度地图',
    generatedAt: projection.generatedAt,
    subjects,
    weakestPoints,
  };
}

export function toReportMasteryDto(
  projection: MasterySummaryProjection,
  legacyReport: WeaknessReport,
): WeaknessReport | ReportWithMasterySummary {
  if (projection.source === 'empty') return legacyReport;

  const mastery = toReportMasterySummary(projection);
  const report = {
    ...legacyReport,
    weakPoints: projection.weakPoints.map((point) => ({
      knowledgePointId: point.knowledgeNodeId,
      knowledgeNodeId: point.knowledgeNodeId,
      subject: point.subject,
      chapter: point.chapter,
      title: point.title,
      attempts: point.practiceCount,
      wrongCount: point.wrongCount,
      slowCount: 0,
      accuracyRate: point.accuracyRate,
      topReason: point.topReason,
      suggestion: point.suggestion,
      weaknessScore: point.weaknessScore,
    })),
  };

  const legacySummary = legacyReport.summary as unknown;
  if (isRecord(legacySummary)) {
    return {
      ...report,
      summary: {
        ...legacySummary,
        mastery,
      },
    } as ReportWithMasterySummary;
  }

  return {
    ...report,
    masterySummary: mastery,
  } as ReportWithMasterySummary;
}

export function toStudentStateMasteryDto(
  projection: MasterySummaryProjection,
  lastUpdatedAt: string | null,
): StudentStateMasteryDto {
  return {
    mastery: {
      source: projection.source,
      nodeCount: projection.nodeCount,
      practicedNodeCount: projection.practicedNodeCount,
      averageMastery: projection.averageMastery,
      weakCount: projection.weakCount,
      reviewCount: projection.reviewCount,
      masteredCount: projection.masteredCount,
      lastUpdatedAt,
    },
    weakPoints: projection.weakPoints.map((point) => ({
      knowledgeNodeId: point.knowledgeNodeId,
      subject: point.subject,
      chapter: point.chapter,
      title: point.title,
      masteryRate: point.masteryRate,
      accuracyRate: point.accuracyRate,
      attempts: point.practiceCount,
      wrongCount: point.wrongCount,
    })),
  };
}

@Injectable()
export class MasterySummaryProjectionService {
  constructor(private readonly prisma: PrismaService) {}

  getProjectionFromRows(
    userId: string,
    rows: NodeMasteryRow[],
    generatedAt: Date = new Date(),
  ): MasterySummaryProjection {
    return buildProjection({
      userId,
      generatedAt: generatedAt.toISOString(),
      rows,
    });
  }

  async getProjection(userId: string, generatedAt: Date = new Date()): Promise<MasterySummaryProjection> {
    if (!process.env.DATABASE_URL) {
      return buildProjection({
        userId,
        generatedAt: generatedAt.toISOString(),
        rows: [],
      });
    }

    const rows = await this.prisma.userKnowledgeMastery.findMany({
      where: { userId },
      include: {
        knowledgeNode: {
          select: {
            subject: true,
            name: true,
            importance: true,
            parent: {
              select: {
                name: true,
                parent: { select: { name: true } },
              },
            },
            frequency: {
              orderBy: { snapshotDate: 'desc' },
              take: 1,
              select: { recent3Frequency: true },
            },
          },
        },
      },
      orderBy: { knowledgeNodeId: 'asc' },
    });

    return buildProjection({
      userId,
      generatedAt: generatedAt.toISOString(),
      rows: rows.map(toNodeMasteryRow),
    });
  }
}

function toReportMasterySummary(projection: MasterySummaryProjection): ReportMasterySummary {
  return {
    source: 'user_knowledge_mastery',
    averageMastery: projection.averageMastery,
    nodeCount: projection.nodeCount,
    practicedNodeCount: projection.practicedNodeCount,
    weakCount: projection.weakCount,
    reviewCount: projection.reviewCount,
    masteredCount: projection.masteredCount,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildProjection(input: {
  userId: string;
  generatedAt: string;
  rows: NodeMasteryRow[];
}): MasterySummaryProjection {
  const masteryMap = buildNodeMasteryMap({
    userId: input.userId,
    rows: input.rows,
    subjects: SUBJECTS,
    generatedAt: input.generatedAt,
  });
  const subjects = masteryMap.subjects.map((subject) => ({
    subject: subject.subject as Subject | '未分类',
    averageMastery: subject.averageMastery,
    weakCount: subject.weakCount,
    reviewCount: subject.reviewCount,
    masteredCount: subject.masteredCount,
    points: subject.points.map((point) => toProjectionPoint(point, subject.subject as Subject | '未分类')),
  }));
  const practicedPoints = subjects.flatMap((subject) => subject.points);
  const weakPoints = practicedPoints
    .filter((point) => point.status === 'weak')
    .sort((left, right) => left.masteryRate - right.masteryRate || right.wrongCount - left.wrongCount || left.knowledgeNodeId.localeCompare(right.knowledgeNodeId))
    .slice(0, 5)
    .map((point) => ({
      ...point,
      weaknessScore: 100 - point.masteryRate,
      suggestion: '建议回归基础概念，配合真题巩固该节点。',
      topReason: null,
    }));

  return {
    userId: input.userId,
    generatedAt: input.generatedAt,
    source: input.rows.length ? 'user_knowledge_mastery' : 'empty',
    nodeCount: input.rows.length,
    practicedNodeCount: practicedPoints.length,
    averageMastery: practicedPoints.length
      ? Math.round(practicedPoints.reduce((sum, point) => sum + point.masteryRate, 0) / practicedPoints.length)
      : 0,
    weakCount: practicedPoints.filter((point) => point.status === 'weak').length,
    reviewCount: practicedPoints.filter((point) => point.status === 'review').length,
    masteredCount: practicedPoints.filter((point) => point.status === 'mastered').length,
    subjects,
    weakPoints,
  };
}

function toProjectionPoint(
  point: NodeMasteryPoint,
  subject: Subject | '未分类',
): MasteryPointProjection {
  return {
    knowledgeNodeId: point.knowledgePointId,
    title: point.title,
    subject,
    chapter: point.chapter,
    importance: point.importance,
    frequency: point.frequency,
    masteryRate: point.masteryRate,
    accuracyRate: point.accuracyRate,
    practiceCount: point.practiceCount,
    wrongCount: point.wrongCount,
    status: point.status,
  };
}

function toMasteryMapPoint(point: MasteryPointProjection): NodeMasteryPoint {
  return {
    knowledgePointId: point.knowledgeNodeId,
    title: point.title,
    chapter: point.chapter,
    importance: point.importance,
    frequency: point.frequency,
    masteryRate: point.masteryRate,
    accuracyRate: point.accuracyRate,
    practiceCount: point.practiceCount,
    wrongCount: point.wrongCount,
    status: point.status,
    nextAction:
      point.status === 'weak'
        ? '建议回归基础，先看教材再刷题'
        : point.status === 'review'
          ? '建议安排巩固复习与变式练习'
          : '建议保持节奏，定期温习',
    actionAnchor: point.status === 'weak' ? '#wrong-book' : '#question',
  };
}

function toNodeMasteryRow(row: {
  knowledgeNodeId: string;
  mastery: number;
  attempts: number;
  correctCount: number;
  wrongCount: number;
  knowledgeNode: {
    subject: string;
    name: string;
    importance: number;
    parent: { name: string; parent: { name: string } | null } | null;
    frequency?: Array<{ recent3Frequency: number }>;
  };
}): NodeMasteryRow {
  return {
    knowledgeNodeId: row.knowledgeNodeId,
    subject: SUBJECT_NAME_BY_CODE[row.knowledgeNode.subject] ?? '未分类',
    chapter: row.knowledgeNode.parent?.parent?.name ?? row.knowledgeNode.parent?.name ?? '',
    title: row.knowledgeNode.name,
    importance: row.knowledgeNode.importance,
    frequency: row.knowledgeNode.frequency?.[0]?.recent3Frequency ?? row.knowledgeNode.importance,
    mastery: row.mastery,
    attempts: row.attempts,
    correctCount: row.correctCount,
    wrongCount: row.wrongCount,
    status: deriveNodeMasteryStatus({ mastery: row.mastery, attempts: row.attempts }),
  };
}
