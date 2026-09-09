/**
 * V11-M4.2/M4.3 — Learning Impact Service (read-only assembly).
 *
 * M4.2 mastery-calibration: for the student's most-practiced nodes, compare
 * the stored EMA mastery against observed recent accuracy on the same node
 * (Evidence → Confidence → Suggested direction). Never writes mastery.
 *
 * M4.3 outcome tracking: for the student's recent recommendations, compare
 * the 14 days BEFORE vs AFTER creation on the same knowledge node: practice
 * accuracy, mastery (snapshot facts), and wrong-practice reduction. Answers
 * "did this recommendation actually help?" with honest insufficient_data
 * windows. Read-only; store unavailable → null (honest absence).
 */

import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildMasteryCalibration,
  buildOutcomeTracking,
  type MasteryCalibrationEntry,
  type OutcomeAttempt,
  type OutcomeTrackingResult,
} from '@kaoyan408/shared';

const CALIBRATION_NODES_MAX = 20;
const CALIBRATION_WINDOW_DAYS = 30;
const OUTCOME_ACTIONS_MAX = 10;
const OUTCOME_WINDOW_DAYS = 14;
const OUTCOME_ATTEMPTS_MAX = 200;

@Injectable()
export class LearningImpactService {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  get enabled() {
    return Boolean(process.env.DATABASE_URL && this.prisma);
  }

  /** null = store unavailable (no calibration claims possible, honestly absent). */
  async getMasteryCalibration(
    userId: string,
  ): Promise<{ generatedAt: string; entries: MasteryCalibrationEntry[] } | null> {
    if (!this.enabled) return null;
    const db = this.prisma!;

    const masteryRows = await db.userKnowledgeMastery.findMany({
      where: { userId },
      orderBy: { attempts: 'desc' },
      take: CALIBRATION_NODES_MAX,
      select: { knowledgeNodeId: true, mastery: true },
    });
    if (masteryRows.length === 0) {
      return { generatedAt: new Date().toISOString(), entries: [] };
    }

    const nodeIds = masteryRows.map((row) => row.knowledgeNodeId);
    const windowStart = new Date(Date.now() - CALIBRATION_WINDOW_DAYS * 86_400_000);

    const tagRows = await db.questionKnowledgeNodeTag.findMany({
      where: { knowledgeNodeId: { in: nodeIds } },
      select: { knowledgeNodeId: true, questionId: true },
    });
    const questionsByNode = new Map<string, string[]>();
    for (const row of tagRows) {
      const list = questionsByNode.get(row.knowledgeNodeId) ?? [];
      list.push(row.questionId);
      questionsByNode.set(row.knowledgeNodeId, list);
    }

    const practiceRows = await db.practiceRecord.findMany({
      where: {
        userId,
        questionId: { in: [...new Set(tagRows.map((row) => row.questionId))] },
        submittedAt: { gte: windowStart },
      },
      select: { questionId: true, correct: true },
      orderBy: { submittedAt: 'desc' },
      take: 400,
    });
    const practicesByQuestion = new Map<string, { correct: boolean }[]>();
    for (const row of practiceRows) {
      const list = practicesByQuestion.get(row.questionId) ?? [];
      list.push({ correct: row.correct });
      practicesByQuestion.set(row.questionId, list);
    }

    const entries = masteryRows.map((row) => {
      const questionIds = questionsByNode.get(row.knowledgeNodeId) ?? [];
      const nodeAttempts = questionIds.flatMap((questionId) =>
        (practicesByQuestion.get(questionId) ?? []).map((practice) => ({ correct: practice.correct })),
      );
      const calibration = buildMasteryCalibration([
        {
          nodeId: row.knowledgeNodeId,
          currentMastery: row.mastery,
          attempts: nodeAttempts,
        },
      ]);
      return calibration.entries[0];
    });

    return { generatedAt: new Date().toISOString(), entries };
  }

  /** Empty interventions = no recent recommendations (honest absence). */
  async getOutcomeTracking(
    userId: string,
  ): Promise<{ generatedAt: string; interventions: OutcomeTrackingResult[] } | null> {
    if (!this.enabled) return null;
    const db = this.prisma!;
    const windowStart = new Date(Date.now() - OUTCOME_WINDOW_DAYS * 86_400_000);

    const actions = await db.recommendationAction.findMany({
      where: { userId, createdAt: { gte: windowStart } },
      orderBy: { createdAt: 'desc' },
      take: OUTCOME_ACTIONS_MAX,
      select: {
        id: true,
        actionType: true,
        createdAt: true,
        studyTask: { select: { knowledgeNodeId: true } },
      },
    });
    if (actions.length === 0) {
      return { generatedAt: new Date().toISOString(), interventions: [] };
    }

    const interventions: OutcomeTrackingResult[] = [];
    for (const action of actions) {
      const nodeId = action.studyTask?.knowledgeNodeId ?? null;
      if (nodeId == null) continue;

      const createdMs = action.createdAt.getTime();
      const beforeStartMs = createdMs - OUTCOME_WINDOW_DAYS * 86_400_000;
      const tags = await db.questionKnowledgeNodeTag.findMany({
        where: { knowledgeNodeId: nodeId },
        select: { questionId: true },
      });
      const questionIds = [...new Set(tags.map((row) => row.questionId))];
      if (questionIds.length === 0) continue;

      const attempts = await db.practiceRecord.findMany({
        where: {
          userId,
          questionId: { in: questionIds },
          submittedAt: { gte: new Date(beforeStartMs) },
        },
        select: { questionId: true, submittedAt: true, correct: true },
        orderBy: { submittedAt: 'asc' },
        take: OUTCOME_ATTEMPTS_MAX,
      });
      const attemptsView: OutcomeAttempt[] = attempts.map((row) => ({
        questionId: row.questionId,
        submittedAt: row.submittedAt.toISOString(),
        correct: row.correct,
        nodeIds: [nodeId],
      }));

      const snapshotRows = await db.userMasterySnapshot.findMany({
        where: { userId, knowledgeNodeId: nodeId, snapshotDate: { gte: new Date(beforeStartMs) } },
        orderBy: { snapshotDate: 'asc' },
        select: { mastery: true, snapshotDate: true },
      });
      const masteryPoints = snapshotRows.map((row) => ({
        nodeId,
        mastery: row.mastery,
        at: row.snapshotDate.toISOString(),
      }));

      interventions.push(
        buildOutcomeTracking({
          intervention: {
            actionId: action.id,
            actionType: action.actionType,
            nodeId,
            createdAt: action.createdAt.toISOString(),
          },
          attempts: attemptsView,
          masteryPoints,
        }),
      );
    }

    return { generatedAt: new Date().toISOString(), interventions };
  }
}
