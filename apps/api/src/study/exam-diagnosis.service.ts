/**
 * LE-V10 F2 — Exam Diagnosis Service (read-only assembly).
 *
 * Composes the existing exam report (ownership enforced inside
 * StudyService.getExamReport) with node-level loss attribution (the same
 * exported score-center loaders the exam-links chain uses), the user's
 * target score, and the recovery-plan closure facts (post-exam task ids are
 * deterministic: exam-review-{sessionId}-day-N). Read-only; when the store
 * is unavailable the diagnosis degrades to report-only facts with explicit
 * recovery reason.
 */

import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  loadLatestFrequencyForNodes,
  loadNodesWithParents,
  resolveKnowledgeNodesForQuestion,
} from '../score-center/repository';
import { StudyService } from './study.service';
import { buildExamDiagnosis, type DiagnosisNodeIndex, type ExamDiagnosis } from './exam-diagnosis';

const MAX_LOST_QUESTIONS = 30;

@Injectable()
export class ExamDiagnosisService {
  constructor(
    private readonly studyService: StudyService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  get enabled() {
    return Boolean(process.env.DATABASE_URL && this.prisma);
  }

  async getExamDiagnosis(sessionId: string, userId: string): Promise<ExamDiagnosis> {
    const asOf = new Date().toISOString();
    const report = this.studyService.getExamReport(sessionId, userId);
    const lostQuestionIds =
      (report as { lostQuestionIds?: string[] }).lostQuestionIds ?? [];

    let nodeIndex: DiagnosisNodeIndex = { nodesByQuestion: {} };
    const nodeFrequency: Record<string, number> = {};
    let targetScore: number | null = null;
    let recovery: { exposedTasks: number; completedTasks: number } | null = null;
    let recoveryReason: 'recovery_plan_not_generated' | null = 'recovery_plan_not_generated';

    if (this.enabled && lostQuestionIds.length > 0) {
      const db = this.prisma!;
      const bounded = lostQuestionIds.slice(0, MAX_LOST_QUESTIONS);
      const mutableNodesByQuestion: Record<string, { knowledgeNodeId: string; name: string; subject: string }[]> = {};
      const allNodeIds = new Set<string>();

      for (const questionId of bounded) {
        const resolutions = await resolveKnowledgeNodesForQuestion(db, questionId);
        const ordered = [
          ...resolutions.filter((row) => row.role === 'PRIMARY'),
          ...resolutions.filter((row) => row.role !== 'PRIMARY'),
        ];
        const rows: { knowledgeNodeId: string; name: string; subject: string }[] = [];
        const seen = new Set<string>();
        for (const row of ordered) {
          if (seen.has(row.knowledgeNodeId)) continue;
          seen.add(row.knowledgeNodeId);
          rows.push({ knowledgeNodeId: row.knowledgeNodeId, name: row.knowledgeNodeId, subject: '未分类' });
          allNodeIds.add(row.knowledgeNodeId);
        }
        if (rows.length > 0) mutableNodesByQuestion[questionId] = rows;
      }

      if (allNodeIds.size > 0) {
        const nodeIds = [...allNodeIds];
        const [nodes, snapshots] = await Promise.all([
          loadNodesWithParents(db, nodeIds),
          loadLatestFrequencyForNodes(db, nodeIds),
        ]);
        const nodeById = new Map(nodes.map((node) => [node.id, node]));
        for (const rows of Object.values(mutableNodesByQuestion)) {
          for (const row of rows) {
            const node = nodeById.get(row.knowledgeNodeId);
            if (node) {
              row.name = node.name;
              row.subject = node.subject;
            }
          }
        }
        for (const row of snapshots) {
          nodeFrequency[row.knowledgeNodeId] = row.recent5Frequency;
        }
      }
      nodeIndex = { nodesByQuestion: mutableNodesByQuestion };

      const postExamTaskIds = [1, 2, 3].map((day) => `exam-review-${sessionId}-day-${day}`);
      const [user, taskCount] = await Promise.all([
        db.user.findUnique({ where: { id: userId }, select: { targetScore: true } }),
        db.studyTask.count({ where: { id: { in: postExamTaskIds } } }),
      ]);
      targetScore = user?.targetScore ?? null;
      if (taskCount > 0) {
        const completedTasks = await db.studyTaskCompletion.count({
          where: { userId, taskId: { in: postExamTaskIds } },
        });
        recovery = { exposedTasks: taskCount, completedTasks };
        recoveryReason = null;
      }
    }

    return buildExamDiagnosis({
      report: report as unknown as Parameters<typeof buildExamDiagnosis>[0]['report'],
      lostQuestionIds,
      nodeIndex,
      nodeFrequency,
      recovery,
      targetScore,
      asOf,
    });
  }
}
