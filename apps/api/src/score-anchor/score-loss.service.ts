/**
 * S1-P1 — Score Loss Evidence: derivation + read projection.
 *
 * Derivation is SYSTEM-ONLY (design API-4: no manual loss entry exists). It
 * runs best-effort right after the paper ledger write, from the attempt facts
 * the session already persisted:
 *
 *   ledger assessment row (semantic/raw scale)
 *     × PracticeRecord per-question facts (correct / gradingMode / selfScore)
 *     × Question.maxScore (content price, ①) else record.maxScore (paper
 *       structure, ②) else null (unpriced — counted, never imputed)
 *     × resolvePrimaryNodeByQuestion (THE canonical resolver — INV-16; this
 *       module never queries QuestionKnowledgeNodeTag directly)
 *
 * Invariants enforced here or pinned by tests:
 *   • append-only: rows are only ever created (skipDuplicates on the
 *     (scoreEntryKind, scoreEntryId, questionId) unique) — never updated.
 *   • conservation refused, not clipped: a violating derivation stores nothing
 *     and returns the rejection reason.
 *   • self-reported partial credit derives PROXY loss; objective exact-match
 *     derives OBSERVED loss; the two are aggregated separately, never merged.
 *   • the projection is DERIVED — a read model that can be dropped and rebuilt,
 *     never a second ledger.
 *
 * The read endpoint follows the same access discipline as
 * GET /coach/score-evidence: student self-only, teacher with an authorization
 * record, admin any.
 */

import { ForbiddenException, Injectable, Optional } from '@nestjs/common';
import {
  buildScoreLossProjection,
  deriveScoreLossItems,
  type ScoreLossQuestionFact,
} from '@kaoyan408/shared';
import { PrismaService } from '../prisma/prisma.service';
import { resolvePrimaryNodeByQuestion } from '../study/question-node-resolution';

export interface ScoreLossActor {
  userId: string;
  role: 'student' | 'teacher' | 'admin';
}

const MAX_ROWS_READ = 1000;

@Injectable()
export class ScoreLossService {
  constructor(private readonly prisma: PrismaService) {}

  get enabled(): boolean {
    return Boolean(process.env.DATABASE_URL && this.prisma);
  }

  /**
   * Derive (and persist) per-question loss for one in-app paper assessment.
   * The per-question attempt facts are passed in by the caller (both paper
   * submission paths hold the exact record set — paper-path records carry no
   * sessionId, so re-querying by session would silently find nothing). The
   * ledger row must already exist (written by recordPaperAssessment with the
   * `paper:<originId>` origin key); a missing row means nothing to derive
   * against, not an error.
   */
  async deriveFromPaperSession(
    userId: string,
    originId: string,
    records: ReadonlyArray<{
      questionId: string;
      correct: boolean;
      gradingMode?: string | null;
      selfScore?: number | null;
      maxScore?: number | null;
    }>,
  ): Promise<{
    stored: boolean;
    rejectionReason: string | null;
    lostQuestions: number;
    pricedLostQuestions: number;
    unpricedLostQuestions: number;
    observedLoss: number | null;
    proxyLoss: number | null;
    conservationBasis: string;
  } | null> {
    if (!this.enabled) return null;

    const assessment = await this.prisma.scoreAssessment.findUnique({
      where: {
        userId_originType_originId: {
          userId,
          originType: 'teacher_entry',
          originId: `paper:${originId}`,
        },
      },
      select: { id: true, semantic: true, rawScore: true, rawTotalScale: true },
    });
    if (!assessment) return null;
    if (records.length === 0) return null;

    const questionIds = [...new Set(records.map((record) => record.questionId))];

    // Price precedence (design §三 #2): ① Question.maxScore (content-side,
    // OBSERVED) → ② the paper's declared per-question max (record) → ③ null.
    const questions = await this.prisma.question.findMany({
      where: { id: { in: questionIds } },
      select: { id: true, maxScore: true },
    });
    const contentPrice = new Map(questions.map((question) => [question.id, question.maxScore]));

    // INV-16: attribution exclusively through the canonical resolver.
    const resolved = await resolvePrimaryNodeByQuestion(this.prisma, questionIds);

    const facts: ScoreLossQuestionFact[] = records.map((record) => {
      const price = contentPrice.get(record.questionId) ?? record.maxScore ?? null;
      const gradingMethod = record.gradingMode === 'self_assessed' ? 'self_report' as const : 'exact_match' as const;
      return {
        questionId: record.questionId,
        correct: record.correct,
        gradingMethod,
        // The reported credit RATIO is graded against the record's own max; the
        // point price is a separate fact. No record max → no ratio → no number.
        selfScore: record.selfScore != null && record.maxScore
          ? record.selfScore / record.maxScore
          : null,
        maxScore: price,
        nodeId: resolved.get(record.questionId)?.nodeId ?? null,
      };
    });

    const sessionPricedTotalPoints = facts.reduce((sum, fact) => sum + (fact.maxScore ?? 0), 0) || null;

    const derivation = deriveScoreLossItems({
      facts,
      entrySemantic: assessment.semantic,
      entryRawScore: assessment.rawScore,
      entryRawTotalScale: assessment.rawTotalScale,
      sessionPricedTotalPoints,
    });

    if (!derivation.ok) {
      // 拒绝出数: store nothing, surface the reason. A conservation violation is
      // a data defect to fix, never a number to clip into plausibility.
      return {
        stored: false,
        rejectionReason: derivation.rejectionReason,
        lostQuestions: derivation.summary.lostQuestions,
        pricedLostQuestions: derivation.summary.pricedLostQuestions,
        unpricedLostQuestions: derivation.summary.unpricedLostQuestions,
        observedLoss: null,
        proxyLoss: null,
        conservationBasis: derivation.summary.conservationBasis,
      };
    }

    if (derivation.items.length > 0) {
      // Append-only + idempotent: re-deriving the same session is a no-op.
      await this.prisma.scoreLossItem.createMany({
        data: derivation.items.map((item) => ({
          userId,
          scoreEntryKind: 'assessment',
          scoreEntryId: assessment.id,
          questionId: item.questionId,
          nodeId: item.nodeId,
          maxScore: item.maxScore,
          earnedScore: item.earnedScore,
          lostScore: item.lostScore,
          lossKind: item.lossKind,
          gradingMethod: item.gradingMethod,
        })),
        skipDuplicates: true,
      });
    }

    return {
      stored: true,
      rejectionReason: null,
      lostQuestions: derivation.summary.lostQuestions,
      pricedLostQuestions: derivation.summary.pricedLostQuestions,
      unpricedLostQuestions: derivation.summary.unpricedLostQuestions,
      observedLoss: derivation.summary.observedLoss,
      proxyLoss: derivation.summary.proxyLoss,
      conservationBasis: derivation.summary.conservationBasis,
    };
  }

  /**
   * Read-only projection (API-1 GET /coach/score-loss). Same access spine as
   * GET /coach/score-evidence: student self-only, teacher needs an
   * authorization record, admin any.
   */
  async getScoreLoss(
    actor: ScoreLossActor,
    targetUserId: string,
  ): Promise<{
    userId: string;
    generatedAt: string;
    storeAvailable: true;
    basis: string;
  } & ReturnType<typeof buildScoreLossProjection> | { userId: string; storeAvailable: false; reason: string } | null> {
    if (!this.enabled) return null;
    if (targetUserId !== actor.userId) {
      if (actor.role === 'student') {
        throw new ForbiddenException('You can only access your own score loss');
      }
      if (actor.role === 'teacher') {
        const authorization = await this.prisma.teacherStudentAuthorization.findFirst({
          where: { teacherId: actor.userId, studentId: targetUserId },
          select: { id: true },
        });
        if (!authorization) {
          throw new ForbiddenException('teacher is not authorized for this student');
        }
      }
    }

    const rows = await this.prisma.scoreLossItem.findMany({
      where: { userId: targetUserId },
      orderBy: { recordedAt: 'desc' },
      take: MAX_ROWS_READ,
    });

    const assessmentIds = [
      ...new Set(rows.filter((row) => row.scoreEntryKind === 'assessment').map((row) => row.scoreEntryId)),
    ];
    const assessments = assessmentIds.length
      ? await this.prisma.scoreAssessment.findMany({
          where: { id: { in: assessmentIds }, userId: targetUserId },
          select: { id: true, semantic: true, rawScore: true, rawTotalScale: true, title: true, recordedAt: true },
        })
      : [];
    const assessmentById = new Map(assessments.map((row) => [row.id, row]));

    const grouped = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = `${row.scoreEntryKind}:${row.scoreEntryId}`;
      const bucket = grouped.get(key) ?? [];
      bucket.push(row);
      grouped.set(key, bucket);
    }

    const projection = buildScoreLossProjection({
      entries: [...grouped.entries()].map(([key, bucket]) => {
        const [kind, id] = [bucket[0].scoreEntryKind, bucket[0].scoreEntryId];
        const parent = kind === 'assessment' ? assessmentById.get(id) : undefined;
        void key;
        return {
          scoreEntryKind: kind,
          scoreEntryId: id,
          semantic: parent?.semantic ?? 'unknown',
          rawScore: parent?.rawScore ?? null,
          rawTotalScale: parent?.rawTotalScale ?? null,
          title: parent?.title ?? null,
          recordedAt: parent?.recordedAt?.toISOString() ?? null,
          items: bucket.map((row) => ({
            questionId: row.questionId,
            nodeId: row.nodeId,
            maxScore: row.maxScore,
            earnedScore: row.earnedScore,
            lostScore: row.lostScore,
            lossKind: row.lossKind,
            gradingMethod: row.gradingMethod,
          })),
        };
      }),
    });

    return {
      userId: targetUserId,
      generatedAt: new Date().toISOString(),
      storeAvailable: true,
      basis: '逐题失分由系统在整卷成绩落账时自动派生（分值来源：题目标注分值 → 试卷结构分值 → 未定价计但不出数）；节点归因走唯一 canonical resolver；本投影为 DERIVED 只读模型，可整体重建。',
      ...projection,
    };
  }
}
