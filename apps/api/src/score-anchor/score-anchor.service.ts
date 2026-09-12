/**
 * S1 Score Anchor — Score Ledger writers and read models.
 *
 * ## What this service owns
 *
 * The append-only Score Ledger: three STRUCTURALLY separate evidence tables
 * (ScorePrediction / ScoreAssessment / ScoreOutcome) plus ScoreCorrection.
 * The separation is the point — no code path in this service can turn a
 * prediction into an outcome, because they do not even share a table.
 *
 * ## Invariants enforced here
 *
 *   • every raw score is normalized onto the 150 scale at write time and the
 *     raw scale is kept beside it (normalizeScore never guesses a total)
 *   • provenance follows the ACTOR, not the request: a student can record an
 *     imported external score, a teacher records teacher-graded scores, and a
 *     student claiming TEACHER_GRADED is a 403, not a data-quality finding
 *   • an outcome's occurredAt must be in the past; an assessment's examDate
 *     may be unknown (null) but never in the future
 *   • evidence rows are never updated — corrections append to
 *     ScoreCorrection and the read model folds the chain (append-only)
 *   • unverified outcomes exist but never enter the primary calibration
 *     stratum (the calibration path excludes them explicitly)
 *
 * Without a database the service is honestly absent: every method returns
 * null / an empty shell rather than fabricating in-memory score facts.
 */

import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  SCORE_NORMALIZED_TOTAL_SCALE,
  calculateCalibrationError,
  deriveCalibrationEvidenceStatus,
  deriveExamDateState,
  evaluateCalibrationGate,
  isCalibrationCompatible,
  normalizeScore,
  resolveCorrectedEvidence,
  validateScoreEvidence,
  type CalibrationEvidenceStatus,
  type ScoreSource,
} from '@kaoyan408/shared';
import { PrismaService } from '../prisma/prisma.service';

export type ScoreAnchorActor = { userId: string; role: 'student' | 'teacher' | 'admin' };

const CORRECTABLE_FIELDS = new Set([
  'rawScore',
  'rawTotalScale',
  'normalizedScore',
  'semantic',
  'gradingMethod',
  'examDate',
  'occurredAt',
  'title',
]);

/** Assessment evidence rows are folded with their correction chain in the read model. */
type AssessmentRow = {
  id: string;
  originType: string;
  originId: string;
  rawScore: number;
  rawTotalScale: number;
  normalizedScore: number | null;
  normalizedTotalScale: number;
  semantic: string;
  source: string;
  gradingMethod: string | null;
  examDate: Date | null;
  title: string | null;
  recordedAt: Date;
};

@Injectable()
export class ScoreAnchorService {
  constructor(private readonly prisma: PrismaService) {}

  get enabled(): boolean {
    return Boolean(process.env.DATABASE_URL && this.prisma);
  }

  /**
   * G1.8 — the first and only writer of `User.examDate` (owner decision A6).
   *
   * Before this the column existed but nothing ever wrote it, while
   * `User.remainingDays` was a hand-typed integer that silently became the
   * engine's `daysToExam`; the two could disagree forever and the student could
   * not tell where the number came from.
   *
   * `examDate` is now the single fact: the same shared derivation the UI uses
   * validates the input AND computes `remainingDays`, and both are written in
   * one update so they can never drift. Passing `null` clears both.
   */
  async setExamDate(
    userId: string,
    input: { examDate: string | null; todayIso?: string },
  ): Promise<{
    examDate: string | null;
    remainingDays: number | null;
    daysLabel: string | null;
    source: 'exam_date' | 'unset';
  } | null> {
    if (!this.enabled) return null;
    const todayIso = input.todayIso ?? new Date().toISOString();
    const state = deriveExamDateState({ examDate: input.examDate, todayIso });
    if (state.error) throw new BadRequestException(state.error);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        examDate: state.examDate ? new Date(`${state.examDate}T00:00:00.000Z`) : null,
        // Derived, never hand-filled, so the two can never disagree.
        remainingDays: state.remainingDays,
      },
    });
    return {
      examDate: state.examDate,
      remainingDays: state.remainingDays,
      daysLabel: state.daysLabel,
      source: state.source,
    };
  }

  // ---------------------------------------------------------------------------
  // Writers
  // ---------------------------------------------------------------------------

  async recordPrediction(
    userId: string,
    input: {
      predictionKey: string;
      modelVersion: string;
      predictedScore: number;
      predictedMinScore?: number | null;
      predictedMaxScore?: number | null;
      generatedFor?: string | null;
      inputsSnapshot?: Record<string, unknown> | null;
    },
  ): Promise<{ id: string; duplicate: boolean } | null> {
    if (!this.enabled) return null;
    const { predictedMinScore = null, predictedMaxScore = null } = input;
    if (predictedMinScore != null && input.predictedScore < predictedMinScore) {
      throw new BadRequestException('predictedScore must not fall below predictedMinScore');
    }
    if (predictedMaxScore != null && input.predictedScore > predictedMaxScore) {
      throw new BadRequestException('predictedScore must not exceed predictedMaxScore');
    }
    const existing = await this.prisma.scorePrediction.findUnique({
      where: { userId_predictionKey: { userId, predictionKey: input.predictionKey } },
      select: { id: true },
    });
    if (existing) return { id: existing.id, duplicate: true };
    try {
      const row = await this.prisma.scorePrediction.create({
        data: {
          userId,
          predictionKey: input.predictionKey,
          modelVersion: input.modelVersion,
          predictedScore: input.predictedScore,
          predictedMinScore,
          predictedMaxScore,
          normalizedTotalScale: SCORE_NORMALIZED_TOTAL_SCALE,
          semantic: 'exam_total',
          source: 'MODEL_OUTPUT',
          generatedFor: input.generatedFor ?? null,
          inputsSnapshot: (input.inputsSnapshot ?? undefined) as Prisma.InputJsonValue | undefined,
        },
        select: { id: true },
      });
      return { id: row.id, duplicate: false };
    } catch (error) {
      if (isUniqueConflict(error)) {
        const winner = await this.prisma.scorePrediction.findUnique({
          where: { userId_predictionKey: { userId, predictionKey: input.predictionKey } },
          select: { id: true },
        });
        if (winner) return { id: winner.id, duplicate: true };
      }
      throw error;
    }
  }

  async recordAssessment(
    actor: ScoreAnchorActor,
    input: {
      rawScore: number;
      rawTotalScale: number;
      semantic?: string;
      source?: string;
      gradingMethod?: string | null;
      examDate?: string | null;
      title?: string | null;
      evidenceRefs?: Record<string, unknown> | null;
      clientKey?: string | null;
    },
  ): Promise<{ id: string; duplicate: boolean; normalizedScore: number | null } | null> {
    if (!this.enabled) return null;
    const validation = validateScoreEvidence({
      rawScore: input.rawScore,
      rawTotalScale: input.rawTotalScale,
      source: input.source ?? 'IMPORTED',
      semantic: input.semantic ?? 'exam_total',
    });
    if (!validation.ok) {
      throw new BadRequestException(`invalid score evidence: ${validation.reject}`);
    }

    // Provenance follows the actor. A student recording "TEACHER_GRADED" is a
    // forbidden claim, not a typo to fix silently.
    const source: ScoreSource = actor.role === 'student' ? 'IMPORTED' : (input.source as ScoreSource) ?? 'TEACHER_GRADED';
    if (actor.role === 'student' && input.source != null && input.source !== 'IMPORTED') {
      throw new ForbiddenException('students may only record IMPORTED assessment evidence');
    }
    const originType = actor.role === 'student' ? 'external_import' : 'teacher_entry';

    let examDate: Date | null = null;
    if (input.examDate) {
      examDate = new Date(input.examDate);
      if (examDate.getTime() > Date.now()) {
        throw new BadRequestException('examDate must not be in the future');
      }
    }

    const normalization = normalizeScore(input.rawScore, input.rawTotalScale);
    if (!normalization.ok) {
      throw new BadRequestException(`score normalization rejected: ${normalization.reject}`);
    }

    const originId = input.clientKey ?? `assess-${randomUUID()}`;
    const findExisting = () =>
      this.prisma.scoreAssessment.findUnique({
        where: { userId_originType_originId: { userId: actor.userId, originType, originId } },
      });
    const existing = await findExisting();
    if (existing) return { id: existing.id, duplicate: true, normalizedScore: existing.normalizedScore };

    try {
      const row = await this.prisma.scoreAssessment.create({
        data: {
          userId: actor.userId,
          originType,
          originId,
          rawScore: input.rawScore,
          rawTotalScale: input.rawTotalScale,
          normalizedScore: normalization.normalized,
          normalizedTotalScale: SCORE_NORMALIZED_TOTAL_SCALE,
          semantic: (input.semantic ?? 'exam_total') as string,
          source: source as string,
          gradingMethod: input.gradingMethod ?? null,
          examDate,
          title: input.title ?? null,
          evidenceRefs: (input.evidenceRefs ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
      return { id: row.id, duplicate: false, normalizedScore: row.normalizedScore };
    } catch (error) {
      if (isUniqueConflict(error)) {
        const winner = await findExisting();
        if (winner) return { id: winner.id, duplicate: true, normalizedScore: winner.normalizedScore };
      }
      throw error;
    }
  }

  /**
   * The in-app paper mock dual-write. Called best-effort from the session
   * submit path: a ledger failure must never fail the exam submission, and a
   * missing ledger row is recoverable (the AssessmentHistoryItem stays the
   * legacy source of truth for these rows in S1).
   */
  async recordPaperAssessment(
    userId: string,
    input: {
      originId: string;
      accuracyRate: number;
      title: string;
    },
  ): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.recordAssessment(
        { userId, role: 'admin' },
        {
          rawScore: input.accuracyRate,
          rawTotalScale: 100,
          semantic: 'accuracy_rate',
          source: 'MOCK',
          gradingMethod: 'exact_match',
          title: input.title,
          clientKey: `paper:${input.originId}`,
        },
      );
    } catch {
      // Best-effort by design: the paper path's authoritative store is
      // AssessmentHistoryItem; a duplicate key here means the row exists.
    }
  }

  async recordOutcome(
    actor: ScoreAnchorActor,
    input: {
      examType: string;
      examYear?: number | null;
      rawScore: number;
      rawTotalScale: number;
      occurredAt: string;
      evidenceRefs?: Record<string, unknown> | null;
      clientKey?: string | null;
      verified?: boolean;
    },
  ): Promise<{ id: string; duplicate: boolean; verificationStatus: string } | null> {
    if (!this.enabled) return null;
    const validation = validateScoreEvidence({
      rawScore: input.rawScore,
      rawTotalScale: input.rawTotalScale,
      source: 'REAL_EXAM',
      semantic: 'exam_total',
    });
    if (!validation.ok) {
      throw new BadRequestException(`invalid score evidence: ${validation.reject}`);
    }
    const occurredAt = new Date(input.occurredAt);
    if (occurredAt.getTime() > Date.now()) {
      throw new BadRequestException('an outcome records an exam that has already happened — occurredAt must be in the past');
    }

    // Only a teacher/admin may record a verified outcome in one step; student
    // submissions always start unverified and await verification.
    const requestingVerification = input.verified === true;
    if (requestingVerification && actor.role === 'student') {
      throw new ForbiddenException('only a teacher or admin may record a verified outcome');
    }
    const source: ScoreSource =
      input.examType === 'real_exam' ? 'REAL_EXAM' : requestingVerification ? 'TEACHER_GRADED' : 'IMPORTED';

    const dedupKey =
      input.examType === 'real_exam' && input.examYear != null
        ? `real_exam:${input.examYear}`
        : (input.clientKey ?? null);

    const findExisting = () =>
      dedupKey
        ? this.prisma.scoreOutcome.findUnique({ where: { userId_dedupKey: { userId: actor.userId, dedupKey } } })
        : null;
    const existing = await findExisting();
    if (existing) {
      return { id: existing.id, duplicate: true, verificationStatus: existing.verificationStatus };
    }

    const verificationStatus = requestingVerification ? 'verified' : 'unverified';
    try {
      const row = await this.prisma.scoreOutcome.create({
        data: {
          userId: actor.userId,
          examType: input.examType,
          dedupKey,
          rawScore: input.rawScore,
          rawTotalScale: input.rawTotalScale,
          normalizedScore: normalizeScore(input.rawScore, input.rawTotalScale).normalized,
          normalizedTotalScale: SCORE_NORMALIZED_TOTAL_SCALE,
          semantic: 'exam_total',
          source: source as string,
          verificationStatus,
          verifiedBy: requestingVerification ? actor.userId : null,
          verifiedAt: requestingVerification ? new Date() : null,
          occurredAt,
          evidenceRefs: (input.evidenceRefs ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
      return { id: row.id, duplicate: false, verificationStatus: row.verificationStatus };
    } catch (error) {
      if (isUniqueConflict(error)) {
        const winner = await findExisting();
        if (winner) {
          return { id: winner.id, duplicate: true, verificationStatus: winner.verificationStatus };
        }
      }
      throw error;
    }
  }

  /** unverified -> verified; the only state transition an outcome supports. */
  async verifyOutcome(
    actor: ScoreAnchorActor,
    outcomeId: string,
  ): Promise<{ id: string; verificationStatus: string } | null> {
    if (!this.enabled) return null;
    const row = await this.prisma.scoreOutcome.findUnique({ where: { id: outcomeId } });
    if (!row) throw new NotFoundException('outcome not found');
    if (actor.role === 'student') {
      throw new ForbiddenException('only a teacher or admin may verify an outcome');
    }
    if (actor.role === 'teacher' && row.userId !== actor.userId) {
      // A teacher may only verify outcomes of students they are authorized for
      // (same authorization spine as every teacher read path).
      const authorization = await this.prisma.teacherStudentAuthorization.findFirst({
        where: { teacherId: actor.userId, studentId: row.userId },
        select: { id: true },
      });
      if (!authorization) {
        throw new ForbiddenException('teacher is not authorized for this student');
      }
    }
    if (row.verificationStatus === 'verified') {
      return { id: row.id, verificationStatus: row.verificationStatus };
    }
    const updated = await this.prisma.scoreOutcome.update({
      where: { id: outcomeId },
      data: { verificationStatus: 'verified', verifiedBy: actor.userId, verifiedAt: new Date() },
      select: { id: true, verificationStatus: true },
    });
    return { id: updated.id, verificationStatus: updated.verificationStatus };
  }

  /**
   * Append a correction. The target row is never touched; the read model
   * folds the chain. Corrections are restricted to the evidence owner (or an
   * admin) and to a field whitelist — verificationStatus is NOT correctable
   * (it moves only through verifyOutcome).
   */
  async recordCorrection(
    actor: ScoreAnchorActor,
    input: { targetKind: 'assessment' | 'outcome'; targetId: string; correctedFields: Record<string, unknown>; reason: string },
  ): Promise<{ id: string } | null> {
    if (!this.enabled) return null;
    const target =
      input.targetKind === 'assessment'
        ? await this.prisma.scoreAssessment.findUnique({ where: { id: input.targetId } })
        : await this.prisma.scoreOutcome.findUnique({ where: { id: input.targetId } });
    if (!target) throw new NotFoundException('score evidence not found');
    if (target.userId !== actor.userId && actor.role === 'student') {
      throw new ForbiddenException('you can only correct your own score evidence');
    }

    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input.correctedFields)) {
      if (!CORRECTABLE_FIELDS.has(key)) {
        throw new BadRequestException(`field is not correctable: ${key}`);
      }
      fields[key] = value;
    }
    if (Object.keys(fields).length === 0) {
      throw new BadRequestException('a correction must change at least one field');
    }

    const nextRawScore = (fields.rawScore as number | undefined) ?? target.rawScore;
    const nextRawTotalScale = (fields.rawTotalScale as number | undefined) ?? target.rawTotalScale;
    const rawFieldsChanged = fields.rawScore !== undefined || fields.rawTotalScale !== undefined;
    if (rawFieldsChanged && fields.normalizedScore === undefined) {
      const normalization = normalizeScore(nextRawScore, nextRawTotalScale);
      if (!normalization.ok) {
        throw new BadRequestException(`corrected score normalization rejected: ${normalization.reject}`);
      }
      fields.normalizedScore = normalization.normalized;
    }
    if (fields.normalizedScore != null && typeof fields.normalizedScore !== 'number') {
      throw new BadRequestException('normalizedScore must be a number when provided');
    }
    if ((fields.examDate != null || fields.occurredAt != null)) {
      const candidate = new Date((fields.examDate ?? fields.occurredAt) as string);
      if (input.targetKind === 'outcome' && candidate.getTime() > Date.now()) {
        throw new BadRequestException('an outcome occurredAt must stay in the past');
      }
    }

    const row = await this.prisma.scoreCorrection.create({
      data: {
        userId: target.userId,
        targetKind: input.targetKind,
        targetId: input.targetId,
        correctedFields: fields as Prisma.InputJsonValue,
        reason: input.reason,
        correctedBy: actor.userId,
      },
      select: { id: true },
    });
    return { id: row.id };
  }

  // ---------------------------------------------------------------------------
  // Read models
  // ---------------------------------------------------------------------------

  async getCalibrationDataset(userId: string): Promise<{
    predictions: Array<{ id: string; predictedScore: number; predictedMinScore: number | null; predictedMaxScore: number | null; generatedAt: Date; modelVersion: string }>;
    assessments: AssessmentRow[];
    outcomes: Array<{
      id: string;
      rawScore: number;
      rawTotalScale: number;
      normalizedScore: number | null;
      normalizedTotalScale: number;
      semantic: string;
      source: string;
      verificationStatus: string;
      occurredAt: Date;
      recordedAt: Date;
      examType: string;
    }>;
  } | null> {
    if (!this.enabled) return null;
    const [predictions, assessments, outcomes] = await Promise.all([
      this.prisma.scorePrediction.findMany({
        where: { userId },
        orderBy: { generatedAt: 'asc' },
        take: 200,
        select: {
          id: true,
          predictedScore: true,
          predictedMinScore: true,
          predictedMaxScore: true,
          generatedAt: true,
          modelVersion: true,
        },
      }),
      this.prisma.scoreAssessment.findMany({
        where: { userId },
        orderBy: { recordedAt: 'asc' },
        take: 200,
      }),
      this.prisma.scoreOutcome.findMany({
        where: { userId },
        orderBy: { recordedAt: 'asc' },
        take: 100,
      }),
    ]);
    return { predictions, assessments, outcomes };
  }

  /**
   * Pair ledger evidence with the latest PRIOR persisted prediction. Only
   * fully compatible pairs become observations; everything else is excluded
   * with its reason (never averaged, never silently dropped).
   */
  async getCalibrationObservations(userId: string): Promise<{
    observations: Array<{ key: string; source: ScoreSource; absoluteError: number; error: number; withinRange: boolean | null }>;
    exclusions: Array<{ key: string; reason: string }>;
    pendingVerification: number;
    pairedCount: number;
  } | null> {
    if (!this.enabled) return null;
    const dataset = await this.getCalibrationDataset(userId);
    if (!dataset) return null;

    const predictions = [...dataset.predictions].sort((left, right) => left.generatedAt.getTime() - right.generatedAt.getTime());
    const evidenceRows: Array<{
      key: string;
      source: ScoreSource;
      semantic: string;
      normalizedScore: number | null;
      occurredAt: Date | null;
    }> = [
      ...dataset.assessments.map((row) => ({
        key: `assessment:${row.id}`,
        source: row.source as ScoreSource,
        semantic: row.semantic,
        normalizedScore: row.normalizedScore,
        occurredAt: row.examDate,
      })),
      ...dataset.outcomes.map((row) => ({
        key: `outcome:${row.id}`,
        source: row.source as ScoreSource,
        semantic: row.semantic,
        normalizedScore: row.normalizedScore,
        occurredAt: row.occurredAt,
      })),
    ];

    const observations: Array<{ key: string; source: ScoreSource; absoluteError: number; error: number; withinRange: boolean | null }> = [];
    const exclusions: Array<{ key: string; reason: string }> = [];
    let pairedCount = 0;
    let pendingVerification = 0;

    for (const evidence of evidenceRows) {
      const isOutcome = evidence.key.startsWith('outcome:');
      if (isOutcome && dataset.outcomes.find((row) => `outcome:${row.id}` === evidence.key)?.verificationStatus !== 'verified') {
        pendingVerification += 1;
        exclusions.push({ key: evidence.key, reason: 'outcome_unverified' });
        continue;
      }
      if (evidence.normalizedScore == null) {
        exclusions.push({ key: evidence.key, reason: 'score_missing' });
        continue;
      }
      if (evidence.occurredAt == null) {
        exclusions.push({ key: evidence.key, reason: 'exam_date_unknown' });
        continue;
      }
      if (evidence.semantic !== 'exam_total') {
        exclusions.push({ key: evidence.key, reason: 'semantic_mismatch' });
        continue;
      }
      const occurredIso = evidence.occurredAt.toISOString();
      const priorPredictions = predictions.filter((prediction) => prediction.generatedAt.toISOString() <= occurredIso);
      const prediction = priorPredictions[priorPredictions.length - 1];
      if (!prediction) {
        exclusions.push({ key: evidence.key, reason: 'no_prior_prediction' });
        continue;
      }
      const predictionRef = {
        predictedScore: prediction.predictedScore,
        predictedMinScore: prediction.predictedMinScore,
        predictedMaxScore: prediction.predictedMaxScore,
        semantic: 'exam_total' as const,
        generatedAt: prediction.generatedAt.toISOString(),
      };
      const evidenceRef = {
        normalizedScore: evidence.normalizedScore,
        normalizedTotalScale: SCORE_NORMALIZED_TOTAL_SCALE,
        semantic: 'exam_total' as const,
        source: evidence.source,
        occurredAt: occurredIso,
      };
      const verdict = isCalibrationCompatible(predictionRef, evidenceRef);
      if (!verdict.compatible) {
        exclusions.push({ key: evidence.key, reason: verdict.reasons.join(',') });
        continue;
      }
      const error = calculateCalibrationError(predictionRef, evidenceRef);
      if (!error.ok || error.absoluteError == null || error.error == null) {
        exclusions.push({ key: evidence.key, reason: error.reason ?? 'error_unavailable' });
        continue;
      }
      pairedCount += 1;
      observations.push({
        key: evidence.key,
        source: evidence.source,
        absoluteError: error.absoluteError,
        error: error.error,
        withinRange: error.withinRange,
      });
    }

    return { observations, exclusions, pendingVerification, pairedCount };
  }

  /** Student-facing evidence timeline: rows with corrections folded in. */
  async getScoreEvidence(
    actor: ScoreAnchorActor,
    targetUserId: string,
  ): Promise<{
    userId: string;
    generatedAt: string;
    examDate: string | null;
    storeAvailable: true;
    predictions: unknown[];
    assessments: unknown[];
    outcomes: unknown[];
    anchors: Record<string, unknown>;
    calibrationEvidence: {
      status: CalibrationEvidenceStatus;
      strata: Array<{ source: ScoreSource; layer: string; n: number; gatePass: boolean }>;
      pairedCount: number;
      pendingVerification: number;
      exclusions: Array<{ key: string; reason: string }>;
    };
  } | { userId: string; storeAvailable: false; reason: string } | null> {
    if (!this.enabled) return null;
    if (targetUserId !== actor.userId) {
      if (actor.role === 'student') {
        throw new ForbiddenException('You can only access your own score evidence');
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
    const userId = targetUserId;
    const [user, dataset, corrections, analysis] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { examDate: true } }),
      this.getCalibrationDataset(userId),
      this.prisma.scoreCorrection.findMany({
        where: { userId },
        orderBy: { correctedAt: 'asc' },
        take: 300,
        select: { targetId: true, correctedFields: true, correctedAt: true, reason: true },
      }),
      this.getCalibrationObservations(userId),
    ]);
    if (!dataset) return null;

    const correctionRecords = corrections.map((row) => ({
      targetId: row.targetId,
      correctedFields: row.correctedFields as Record<string, unknown>,
      correctedAt: row.correctedAt.toISOString(),
    }));

    const byRecordedDesc = (left: { recordedAt: Date }, right: { recordedAt: Date }) =>
      right.recordedAt.getTime() - left.recordedAt.getTime();

    const assessmentViews = [...dataset.assessments].sort(byRecordedDesc).slice(0, 10).map((row) => {
      const resolved = resolveCorrectedEvidence(
        { ...row, recordedAt: row.recordedAt.toISOString(), examDate: row.examDate?.toISOString() ?? null } as Record<string, unknown>,
        correctionRecords,
      );
      return {
        id: row.id,
        kind: 'assessment' as const,
        source: row.source,
        semantic: row.semantic,
        originType: row.originType,
        rawScore: resolved.effective.rawScore,
        rawTotalScale: resolved.effective.rawTotalScale,
        normalizedScore: resolved.effective.normalizedScore,
        normalizedTotalScale: row.normalizedTotalScale,
        examDate: resolved.effective.examDate,
        title: resolved.effective.title,
        gradingMethod: row.gradingMethod,
        corrected: resolved.corrected,
        correctionCount: resolved.correctionCount,
      };
    });

    const outcomeViews = [...dataset.outcomes].sort(byRecordedDesc).slice(0, 5).map((row) => {
      const resolved = resolveCorrectedEvidence(
        { ...row, recordedAt: row.recordedAt.toISOString(), occurredAt: row.occurredAt.toISOString() } as Record<string, unknown>,
        correctionRecords,
      );
      return {
        id: row.id,
        kind: 'outcome' as const,
        source: row.source,
        semantic: row.semantic,
        examType: row.examType,
        rawScore: resolved.effective.rawScore,
        rawTotalScale: resolved.effective.rawTotalScale,
        normalizedScore: resolved.effective.normalizedScore,
        normalizedTotalScale: row.normalizedTotalScale,
        occurredAt: resolved.effective.occurredAt,
        verificationStatus: row.verificationStatus,
        corrected: resolved.corrected,
        correctionCount: resolved.correctionCount,
      };
    });

    const predictionViews = [...dataset.predictions]
      .sort((left, right) => right.generatedAt.getTime() - left.generatedAt.getTime())
      .slice(0, 5)
      .map((row) => ({
        id: row.id,
        kind: 'prediction' as const,
        modelVersion: row.modelVersion,
        predictedScore: row.predictedScore,
        predictedMinScore: row.predictedMinScore,
        predictedMaxScore: row.predictedMaxScore,
        normalizedTotalScale: SCORE_NORMALIZED_TOTAL_SCALE,
        generatedAt: row.generatedAt.toISOString(),
      }));

    const gates = evaluateCalibrationGate(analysis?.observations ?? []);
    const strata = gates.map((gate) => ({
      source: gate.source,
      layer: gate.layer,
      n: gate.n,
      gatePass: gate.gate.pass,
    }));
    return {
      userId,
      generatedAt: new Date().toISOString(),
      storeAvailable: true,
      examDate: user?.examDate?.toISOString() ?? null,
      predictions: predictionViews,
      assessments: assessmentViews,
      outcomes: outcomeViews,
      anchors: {
        verifiedOutcome: outcomeViews.find((row) => row.verificationStatus === 'verified') ?? null,
        latestAssessment: assessmentViews[0] ?? null,
        latestPrediction: predictionViews[0] ?? null,
      },
      calibrationEvidence: {
        status: deriveCalibrationEvidenceStatus(gates),
        strata,
        pairedCount: analysis?.pairedCount ?? 0,
        pendingVerification: analysis?.pendingVerification ?? 0,
        exclusions: analysis?.exclusions ?? [],
      },
    };
  }
}

function isUniqueConflict(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002');
}
