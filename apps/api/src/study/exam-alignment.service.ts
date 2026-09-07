/**
 * LE-V10 Feature 1 / Milestone 1 — Exam Alignment Service (read-only assembly).
 *
 * Loads everything the pure selector needs, exclusively through the loaders
 * already exported by score-center/repository.ts (the same chain the
 * exam-links endpoint runs in production) plus a bounded UserKnowledgeMastery
 * read. Read-only by contract; no engine, no writers, no new tables. When the
 * database is unavailable the service is disabled and callers receive null
 * (an honest absence — never fabricated alignment data).
 */

import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  loadExamQuestionsForNodes,
  loadLatestFrequencyForNodes,
  loadNodesWithParents,
  resolveKnowledgeNodesForQuestion,
} from '../score-center/repository';
import {
  buildExamAlignment,
  rankByExamAlignment,
  withExamAlignmentSection,
  type AlignmentExamHit,
  type AlignmentFrequencySnapshot,
  type AlignmentMasteryState,
  type AlignmentNodeIndex,
  type AlignmentQuestionInput,
  type ExamAlignmentResult,
  type RecentPracticeRef,
} from './exam-alignment.selector';

/** Per-question node resolution cap — recommended sets stay well under this. */
const MAX_QUESTIONS_PER_ALIGNMENT = 30;

@Injectable()
export class ExamAlignmentService {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  get enabled() {
    return Boolean(process.env.DATABASE_URL && this.prisma);
  }

  /**
   * Builds the exam-alignment projection for a set of question ids.
   * Returns null when the store is unavailable (legacy demo mode) — the
   * response then carries no examAlignment section at all.
   */
  async getAlignmentForQuestions(
    userId: string,
    questionIds: readonly string[],
  ): Promise<ExamAlignmentResult | null> {
    if (!this.enabled || questionIds.length === 0) return null;
    const db = this.prisma!;
    const boundedIds = questionIds.slice(0, MAX_QUESTIONS_PER_ALIGNMENT);

    // Question → nodes (ordered PRIMARY first, mirroring the tag roles).
    const nodesByQuestion = new Map<string, string[]>();
    const allNodeIds = new Set<string>();
    for (const questionId of boundedIds) {
      const resolutions = await resolveKnowledgeNodesForQuestion(db, questionId);
      const ordered = [
        ...resolutions.filter((row) => row.role === 'PRIMARY'),
        ...resolutions.filter((row) => row.role !== 'PRIMARY'),
      ].map((row) => row.knowledgeNodeId);
      const unique = [...new Set(ordered)];
      if (unique.length > 0) nodesByQuestion.set(questionId, unique);
      unique.forEach((id) => allNodeIds.add(id));
    }
    if (allNodeIds.size === 0) {
      return buildExamAlignment(
        boundedIds.map((questionId) => ({ questionId, nodeIds: [] })),
        emptyIndex(),
      );
    }

    const nodeIds = [...allNodeIds];
    const [nodes, snapshots, examTags, masteryRows] = await Promise.all([
      loadNodesWithParents(db, nodeIds),
      loadLatestFrequencyForNodes(db, nodeIds),
      loadExamQuestionsForNodes(db, nodeIds),
      db.userKnowledgeMastery.findMany({
        where: { userId, knowledgeNodeId: { in: nodeIds } },
        select: { knowledgeNodeId: true, mastery: true, attempts: true },
      }),
    ]);

    const nodesById: Record<string, { knowledgeNodeId: string; name: string; subject: string }> = {};
    for (const node of nodes) {
      nodesById[node.id] = { knowledgeNodeId: node.id, name: node.name, subject: node.subject };
    }

    const snapshotByNode: Record<string, AlignmentFrequencySnapshot> = {};
    for (const row of snapshots) {
      snapshotByNode[row.knowledgeNodeId] = {
        knowledgeNodeId: row.knowledgeNodeId,
        recent3Frequency: row.recent3Frequency,
        recent5Frequency: row.recent5Frequency,
        allTimeEvidence: row.allTimeEvidence,
        primaryScore5y: row.primaryScore5y,
        trendDirection: row.trendDirection,
        trendDelta: row.trendDelta,
        evidenceConfidence: row.evidenceConfidence,
      };
    }

    const examHitsByNode: Record<string, AlignmentExamHit[]> = {};
    for (const tag of examTags) {
      const nodeId = tag.knowledgeNodeId;
      const list = examHitsByNode[nodeId] ?? (examHitsByNode[nodeId] = []);
      if (tag.question?.paper?.year == null || tag.question.questionNo == null) continue;
      list.push({
        knowledgeNodeId: nodeId,
        year: tag.question.paper.year,
        subject: tag.question.subject,
        questionNo: tag.question.questionNo,
      });
    }

    const masteryByNode: Record<string, AlignmentMasteryState> = {};
    for (const row of masteryRows) {
      masteryByNode[row.knowledgeNodeId] = {
        knowledgeNodeId: row.knowledgeNodeId,
        mastery: row.mastery,
        attempts: row.attempts,
      };
    }

    const index: AlignmentNodeIndex = { nodesById, snapshotByNode, masteryByNode, examHitsByNode };
    const questions: AlignmentQuestionInput[] = boundedIds.map((questionId) => ({
      questionId,
      nodeIds: nodesByQuestion.get(questionId) ?? [],
    }));
    return buildExamAlignment(questions, index);
  }

  /**
   * M2 — attaches the examAlignment section to a recommended practice set.
   * Plain mode passes the base through untouched (byte-identical response);
   * exam_aligned resolves alignment for the set's question ids and lets the
   * pure selector attach (and rank) the section. Read-only; the base object
   * is never mutated.
   */
  async attachToPracticeSet<
    T extends { readonly questions: readonly { readonly id: string }[] },
  >(
    userId: string,
    base: T,
    mode: string | null | undefined,
    recentPractice: readonly RecentPracticeRef[] = [],
  ): Promise<T & { examAlignment?: ExamAlignmentResult | null }> {
    const serviceEnabled = this.enabled;
    const alignment =
      serviceEnabled && mode === 'exam_aligned'
        ? await this.getAlignmentForQuestions(userId, base.questions.map((question) => question.id))
        : null;
    return withExamAlignmentSection(base, mode, alignment, { serviceEnabled, recentPractice });
  }
}

function emptyIndex(): AlignmentNodeIndex {
  return { nodesById: {}, snapshotByNode: {}, masteryByNode: {}, examHitsByNode: {} };
}
