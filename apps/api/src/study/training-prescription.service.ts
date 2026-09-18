import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildTrainingPrescription,
  REVIEW_INTERVAL_DAYS,
  type ErrorDiagnosisRow,
  type PrescriptionAvailability,
  type TrainingPrescription,
} from '@kaoyan408/shared';
import { ErrorDiagnosisService } from './error-diagnosis.service';

/**
 * V13 PHASE 5 — Training Prescription service (read-only).
 *
 * Takes the top Diagnostic Finding (or an explicitly selected one) and builds
 * an executable ladder against the REAL question bank:
 *
 *   finding → mastery state + real content availability → ladder
 *
 * Content availability is counted through the SAME two-tier node resolution the
 * rest of the system uses (direct QuestionKnowledgeNodeTag rows + the
 * QuestionKnowledgePoint → KnowledgePointNodeMap bridge), so the counts reflect
 * production-shaped data, not a single tagging style.
 *
 * Boundaries: read-only; no task/action creation (recommendation behaviour is
 * Owner-Gated); no mastery writes; variant capability is probed honestly and a
 * missing capability produces an explicit UNAVAILABLE step.
 */

export interface TrainingPrescriptionView extends TrainingPrescription {
  readonly userId: string;
  readonly generatedAt: string;
  readonly storeAvailable: boolean;
  readonly reasonUnavailable?: string;
}

const MAX_TAG_ROWS = 2000;

@Injectable()
export class TrainingPrescriptionService {
  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly errorDiagnosis?: ErrorDiagnosisService,
  ) {}

  get enabled(): boolean {
    return Boolean(process.env.DATABASE_URL && this.prisma && this.errorDiagnosis?.enabled);
  }

  async getTrainingPrescription(
    userId: string,
    options: { days?: number; nodeId?: string; questionSubtype?: string; reasonCode?: string } = {},
    now: Date = new Date(),
  ): Promise<TrainingPrescriptionView> {
    const generatedAt = now.toISOString();
    if (!this.enabled) {
      return {
        userId,
        generatedAt,
        storeAvailable: false,
        reasonUnavailable: 'store_unavailable',
        dataStatus: 'EMPTY',
        target: null,
        reason: '存储不可用，无法生成处方。',
        difficultyAnchor: null,
        reviewEmphasis: false,
        ladder: [],
      };
    }

    const diagnosis = await this.errorDiagnosis!.getErrorDiagnosis(userId, { days: options.days }, now);
    const selected = this.selectFinding(diagnosis.findings, options);
    if (!selected) {
      const empty = buildTrainingPrescription({
        now: generatedAt,
        windowDays: diagnosis.window.days,
        finding: null,
        masteryState: null,
        available: { basic: 0, medium: 0, hard: 0, sameSubtype: 0 },
        variantAvailable: false,
        reviewIntervalDays: REVIEW_INTERVAL_DAYS,
      });
      return { userId, generatedAt, storeAvailable: true, ...empty };
    }

    const [masteryRow, availability] = await Promise.all([
      this.prisma!.userKnowledgeMastery.findUnique({
        where: { userId_knowledgeNodeId: { userId, knowledgeNodeId: selected.nodeId } },
        select: { mastery: true, recentAccuracy: true, retention: true, attempts: true },
      }),
      this.countAvailable(selected.nodeId, selected.questionSubtype),
    ]);

    const prescription = buildTrainingPrescription({
      now: generatedAt,
      windowDays: diagnosis.window.days,
      finding: selected,
      masteryState: masteryRow ?? null,
      available: availability,
      // Honest capability probe: AI variants require a configured provider and
      // teacher confirmation before a student can answer them.
      variantAvailable: Boolean(process.env.AI_API_KEY),
      reviewIntervalDays: REVIEW_INTERVAL_DAYS,
    });
    return { userId, generatedAt, storeAvailable: true, ...prescription };
  }

  private selectFinding(
    findings: readonly ErrorDiagnosisRow[],
    options: { nodeId?: string; questionSubtype?: string; reasonCode?: string },
  ): ErrorDiagnosisRow | null {
    if (options.nodeId) {
      return findings.find((row) =>
        row.nodeId === options.nodeId
        && (!options.questionSubtype || row.questionSubtype === options.questionSubtype)
        && (!options.reasonCode || row.reasonCode === options.reasonCode)) ?? null;
    }
    return findings[0] ?? null;
  }

  /** Real, current-bank counts for the finding's node (and subtype when known). */
  private async countAvailable(nodeId: string, questionSubtype: string): Promise<PrescriptionAvailability> {
    const prisma = this.prisma!;
    const [directTags, bridgeMaps] = await Promise.all([
      prisma.questionKnowledgeNodeTag.findMany({
        where: { knowledgeNodeId: nodeId },
        take: MAX_TAG_ROWS,
        select: { questionId: true },
      }),
      prisma.knowledgePointNodeMap.findMany({
        where: { knowledgeNodeId: nodeId },
        take: MAX_TAG_ROWS,
        select: { knowledgePointId: true },
      }),
    ]);
    const viaKnowledgePoints = bridgeMaps.length > 0
      ? await prisma.questionKnowledgePoint.findMany({
        where: { knowledgePointId: { in: [...new Set(bridgeMaps.map((row) => row.knowledgePointId))] } },
        take: MAX_TAG_ROWS,
        select: { questionId: true },
      })
      : [];
    const questionIds = [...new Set([
      ...directTags.map((row) => row.questionId),
      ...viaKnowledgePoints.map((row) => row.questionId),
    ])];
    if (questionIds.length === 0) return { basic: 0, medium: 0, hard: 0, sameSubtype: 0 };

    const questions = await prisma.question.findMany({
      where: { id: { in: questionIds }, isCurrent: true },
      take: MAX_TAG_ROWS,
      select: { difficulty: true, questionSubtype: true },
    });
    const matchesSubtype = (subtype: string | null) =>
      questionSubtype === 'unknown' || subtype === questionSubtype;
    const counts: PrescriptionAvailability = { basic: 0, medium: 0, hard: 0, sameSubtype: 0 };
    for (const question of questions) {
      if (!matchesSubtype(question.questionSubtype)) continue;
      counts.sameSubtype += 1;
      if (question.difficulty === 'BASIC') counts.basic += 1;
      else if (question.difficulty === 'MEDIUM') counts.medium += 1;
      else if (question.difficulty === 'HARD') counts.hard += 1;
    }
    return counts;
  }
}
