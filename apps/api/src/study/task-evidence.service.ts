/**
 * V11-M2 — Learning Evidence Service (read-only assembly).
 *
 * For a student's recently completed tasks, assembles the capability
 * evidence: practices on the task's own knowledge nodes within ±3 days of
 * completion, mastery at completion (nearest daily snapshot before) vs the
 * current mastery, then delegates to the pure projection. Read-only; store
 * unavailable → null (no evidence claims possible, honestly absent).
 */

import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildTaskEvidence, type TaskEvidence, type TaskEvidenceInput } from '@kaoyan408/shared';

const EVIDENCE_WINDOW_MS = 3 * 86_400_000;
const MAX_TASKS = 5;

@Injectable()
export class TaskEvidenceService {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  get enabled() {
    return Boolean(process.env.DATABASE_URL && this.prisma);
  }

  /** null = store unavailable (no evidence claims possible, honestly absent). */
  async getRecentCompletedTaskEvidence(
    userId: string,
    take = MAX_TASKS,
  ): Promise<{ generatedAt: string; tasks: TaskEvidence[] } | null> {
    if (!this.enabled) return null;
    const db = this.prisma!;

    const completions = await db.studyTaskCompletion.findMany({
      where: { userId },
      orderBy: { completedAt: 'desc' },
      take,
      distinct: ['taskId'],
      select: { taskId: true, completedDate: true, completedAt: true },
    });
    if (completions.length === 0) {
      return { generatedAt: new Date().toISOString(), tasks: [] };
    }

    const taskIds = completions.map((row) => row.taskId);
    const tasks = await db.studyTask.findMany({
      where: { id: { in: taskIds } },
      select: { id: true, title: true, knowledgeNodeId: true, knowledgePointId: true },
    });
    const taskById = new Map(tasks.map((task) => [task.id, task]));

    const tasksOut: TaskEvidence[] = [];
    for (const completion of completions) {
      const task = taskById.get(completion.taskId);
      if (!task) continue;
      const nodeIds = task.knowledgeNodeId ? [task.knowledgeNodeId] : [];
      const completedAtMs = (completion.completedAt ?? new Date()).getTime();
      const attempts = nodeIds.length > 0 ? await this.loadAttempts(db, userId, nodeIds, completedAtMs) : [];

      const masteryByNode: Record<string, { atCompletion: number | null; current: number | null }> = {};
      for (const nodeId of nodeIds) {
        const [currentRow, beforeRow] = await Promise.all([
          db.userKnowledgeMastery.findFirst({
            where: { userId, knowledgeNodeId: nodeId },
            select: { mastery: true },
          }),
          db.userMasterySnapshot.findFirst({
            where: {
              userId,
              knowledgeNodeId: nodeId,
              snapshotDate: { lte: new Date(`${completion.completedDate}T23:59:59.000Z`) },
            },
            orderBy: { snapshotDate: 'desc' },
            select: { mastery: true },
          }),
        ]);
        masteryByNode[nodeId] = { atCompletion: beforeRow?.mastery ?? null, current: currentRow?.mastery ?? null };
      }

      tasksOut.push(
        buildTaskEvidence({
          taskId: task.id,
          title: task.title,
          completedDate: completion.completedDate,
          nodeIds,
          attempts,
          masteryByNode,
          asOf: new Date().toISOString(),
        }),
      );
    }

    return { generatedAt: new Date().toISOString(), tasks: tasksOut };
  }

  private async loadAttempts(
    db: PrismaService,
    userId: string,
    nodeIds: readonly string[],
    completedAtMs: number,
  ): Promise<TaskEvidenceInput['attempts']> {
    const tags = await db.questionKnowledgeNodeTag.findMany({
      where: { knowledgeNodeId: { in: [...nodeIds] } },
      select: { questionId: true },
    });
    const questionIds = [...new Set(tags.map((row) => row.questionId))];
    if (questionIds.length === 0) return [];
    const rows = await db.practiceRecord.findMany({
      where: {
        userId,
        questionId: { in: questionIds },
        submittedAt: {
          gte: new Date(completedAtMs - EVIDENCE_WINDOW_MS).toISOString(),
          lte: new Date(completedAtMs + EVIDENCE_WINDOW_MS).toISOString(),
        },
      },
      select: { questionId: true, submittedAt: true, correct: true },
      orderBy: { submittedAt: 'asc' },
      take: 50,
    });
    return rows.map((row) => ({
      questionId: row.questionId,
      submittedAt: row.submittedAt.toISOString(),
      correct: row.correct,
    }));
  }
}
