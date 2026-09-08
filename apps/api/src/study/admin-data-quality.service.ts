/**
 * V11-M1 — Admin Data Quality Service (read-only assembly).
 *
 * Loads the catalog coverage facts (questions ↔ node tags, knowledge points
 * ↔ PRIMARY catalog mapping, nodes ↔ frequency snapshots, relation edges)
 * and hands them to the pure projection. Read-only; bounded; admin-only at
 * the route.
 */

import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildDataQualityReport, type DataQualityReport } from './admin-data-quality';

const SAMPLE_MAX = 10;

@Injectable()
export class AdminDataQualityService {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  get enabled() {
    return Boolean(process.env.DATABASE_URL && this.prisma);
  }

  /** null = store unavailable (no observations possible, honestly absent). */
  async getDataQualityReport(): Promise<DataQualityReport | null> {
    if (!this.enabled) return null;
    const db = this.prisma!;

    const [questionTotal, taggedGroups, knowledgePointTotal, primaryMapRows, nodeRows, snapshotRows, prerequisiteCount, relatedCount] =
      await Promise.all([
        db.question.count(),
        db.questionKnowledgeNodeTag.groupBy({ by: ['questionId'] }),
        db.knowledgePoint.count(),
        db.knowledgePointNodeMap.findMany({
          where: { mappingType: 'PRIMARY' },
          select: { knowledgePointId: true },
        }),
        db.knowledgeNode.findMany({ select: { id: true, subject: true }, where: { isActive: true } }),
        db.knowledgeFrequencySnapshot.findMany({
          orderBy: { snapshotDate: 'desc' },
          take: 1,
          select: { snapshotDate: true, modelVersion: true },
        }),
        db.knowledgeRelation.count({ where: { type: 'PREREQUISITE' } }),
        db.knowledgeRelation.count({ where: { type: 'RELATED' } }),
      ]);

    const latest = snapshotRows[0] ?? null;
    const snapshotNodeIds = new Set<string>(
      latest
        ? (
            await db.knowledgeFrequencySnapshot.findMany({
              where: { snapshotDate: latest.snapshotDate, modelVersion: latest.modelVersion },
              select: { knowledgeNodeId: true },
            })
          ).map((row) => row.knowledgeNodeId)
        : [],
    );

    const taggedQuestionIds = new Set(taggedGroups.map((row) => row.questionId));
    const untaggedSamples = await db.question.findMany({
      where: { knowledgeNodeTags: { none: {} } },
      select: { id: true },
      take: SAMPLE_MAX,
    });
    const mappedPointIds = new Set(primaryMapRows.map((row) => row.knowledgePointId));
    const unmappedPointSamples = (await db.knowledgePoint.findMany({ select: { id: true, title: true }, take: 200 }))
      .filter((point) => !mappedPointIds.has(point.id))
      .slice(0, SAMPLE_MAX)
      .map((point) => point.title);
    const snapshotlessSamples = nodeRows
      .filter((node) => !snapshotNodeIds.has(node.id))
      .slice(0, SAMPLE_MAX)
      .map((node) => ({ id: node.id, subject: node.subject }));

    return buildDataQualityReport({
      questionTotal,
      questionIdsWithNodeTags: taggedQuestionIds,
      knowledgePointTotal,
      knowledgePointIdsWithPrimaryMap: mappedPointIds,
      nodeIds: nodeRows.map((node) => ({ id: node.id, subject: node.subject })),
      nodeIdsWithFrequencySnapshot: snapshotNodeIds,
      prerequisiteEdgeCount: prerequisiteCount,
      relatedEdgeCount: relatedCount,
      samples: {
        questionsWithoutNodeTags: untaggedSamples.map((row) => row.id),
        knowledgePointsWithoutPrimaryMap: unmappedPointSamples,
        nodesWithoutFrequencySnapshot: snapshotlessSamples,
      },
      generatedAt: new Date().toISOString(),
    });
  }
}
