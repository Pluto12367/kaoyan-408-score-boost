/**
 * V12-M5 → S1 — Real score calibration (read-only assembly).
 *
 * Pairs each recorded score with the prediction that preceded it — the
 * comparison EB-4 said had never been made.
 *
 * ## S1: the pairing now runs on the Score Ledger
 *
 * The Score Anchor service owns persisted predictions (ScorePrediction) and
 * provenance-carrying evidence (ScoreAssessment / ScoreOutcome). When ledger
 * data exists, every pair is
 *
 *   ledger prediction (150-scale, modelVersion, generatedAt)
 *     × ledger evidence (normalized 150-scale, semantic, source)
 *
 * and the shared calibration enforces FULL compatibility — same scale, same
 * semantic, known provenance, prediction strictly before the evidence. An
 * accuracy-rate row is structurally excluded from exam-total calibration
 * instead of being subtracted from a 150-scale prediction (the original
 * measured mismatch: predicted=26, actual=96/100, error=70).
 *
 * The legacy AssessmentHistoryItem reconstruction remains as a declared
 * fallback (before any ledger prediction exists), with one S1 correction:
 * the id prefix ("imported-") is the only recorded provenance fact those
 * rows carry, so it derives semantic/source from it — a paper row's
 * percentage is accuracy_rate and can no longer masquerade as a 150-scale
 * exam score. previousScore chaining uses the NORMALIZED value, not the raw.
 *
 * Three concepts stay separate: prediction (a range + disclaimer), evidence
 * (which facts, how many), actual (the recorded score). Read-only.
 */

import { Injectable, Optional } from '@nestjs/common';
import {
  buildScoreCalibration,
  estimatePredictedScore,
  normalizeScore,
  type CalibrationPairInput,
  type ScoreCalibration,
} from '@kaoyan408/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ScoreAnchorService } from '../score-anchor/score-anchor.service';

const MAX_ASSESSMENTS = 50;
const MAX_PRACTICE_ROWS = 500;
const MAX_SNAPSHOT_ROWS = 1000;
const DAYS_FALLBACK = 240;
const TARGET_FALLBACK = 120;

export interface ScoreCalibrationResult extends ScoreCalibration {
  readonly generatedAt: string;
  readonly basis: string;
  readonly source: 'derived';
  /** Outcomes recorded but not yet teacher/admin-verified — never calibrated in S1. */
  readonly pendingVerification?: number;
}

@Injectable()
export class ScoreCalibrationService {
  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly scoreAnchor?: ScoreAnchorService,
  ) {}

  get enabled(): boolean {
    return Boolean(process.env.DATABASE_URL && this.prisma);
  }

  /** null = store unavailable (honestly absent, never an empty calibration). */
  async getCalibration(userId: string): Promise<ScoreCalibrationResult | null> {
    if (!this.enabled) return null;
    const db = this.prisma!;
    const asOf = new Date();

    const user = await db.user
      .findUnique({
        where: { id: userId },
        select: { targetScore: true },
      })
      .catch(() => null);
    const targetScore = (user as { targetScore?: number | null } | null)?.targetScore ?? TARGET_FALLBACK;

    // S1: the Score Ledger is the primary source once it holds anything.
    const dataset = (await this.scoreAnchor?.getCalibrationDataset(userId)) ?? null;
    if (dataset && (dataset.predictions.length > 0 || dataset.assessments.length > 0 || dataset.outcomes.length > 0)) {
      return this.calibrateFromLedger(userId, dataset, targetScore, asOf);
    }
    return this.calibrateFromLegacyAssessments(userId, targetScore, asOf);
  }

  // ---------------------------------------------------------------------------
  // Ledger path
  // ---------------------------------------------------------------------------

  private async calibrateFromLedger(
    userId: string,
    dataset: {
      predictions: Array<{
        id: string;
        predictedScore: number;
        predictedMinScore: number | null;
        predictedMaxScore: number | null;
        generatedAt: Date;
        modelVersion: string;
      }>;
      assessments: Array<{
        id: string;
        rawScore: number;
        rawTotalScale: number;
        normalizedScore: number | null;
        semantic: string;
        source: string;
        examDate: Date | null;
      }>;
      outcomes: Array<{
        id: string;
        rawScore: number;
        rawTotalScale: number;
        normalizedScore: number | null;
        semantic: string;
        source: string;
        verificationStatus: string;
        occurredAt: Date;
      }>;
    },
    targetScore: number,
    asOf: Date,
  ): Promise<ScoreCalibrationResult> {
    const [practiceRows, snapshotRows] = await Promise.all([
      this.prisma!.practiceRecord.findMany({
        where: { userId },
        orderBy: { submittedAt: 'asc' },
        take: MAX_PRACTICE_ROWS,
        select: { submittedAt: true, correct: true },
      }),
      this.prisma!.userMasterySnapshot.findMany({
        where: { userId },
        orderBy: { snapshotDate: 'asc' },
        take: MAX_SNAPSHOT_ROWS,
        select: { snapshotDate: true, mastery: true },
      }),
    ]);

    const predictionsAsc = [...dataset.predictions].sort(
      (left, right) => left.generatedAt.getTime() - right.generatedAt.getTime(),
    );
    const evidenceRows: Array<{
      key: string;
      semantic: string;
      source: string;
      normalizedScore: number | null;
      rawScore: number;
      rawTotalScale: number;
      occurredAt: Date | null;
      unverified: boolean;
    }> = [
      ...dataset.assessments.map((row) => ({
        key: `assessment:${row.id}`,
        semantic: row.semantic,
        source: row.source,
        normalizedScore: row.normalizedScore,
        rawScore: row.rawScore,
        rawTotalScale: row.rawTotalScale,
        occurredAt: row.examDate,
        unverified: false,
      })),
      ...dataset.outcomes.map((row) => ({
        key: `outcome:${row.id}`,
        semantic: row.semantic,
        source: row.source,
        normalizedScore: row.normalizedScore,
        rawScore: row.rawScore,
        rawTotalScale: row.rawTotalScale,
        occurredAt: row.occurredAt,
        unverified: row.verificationStatus !== 'verified',
      })),
    ];

    const pairs: CalibrationPairInput[] = [];
    const customExclusions: Array<{ sessionId: string; reason: string }> = [];
    let previousScore: number | null = null;
    let pendingVerification = 0;

    for (const row of evidenceRows) {
      if (row.unverified) {
        pendingVerification += 1;
        customExclusions.push({
          sessionId: row.key,
          reason: 'outcome_unverified：成绩尚未经教师/管理员验证，S1 不将其纳入校准。',
        });
        continue;
      }
      if (row.occurredAt == null) {
        customExclusions.push({
          sessionId: row.key,
          reason: 'exam_date_unknown：考试日期未记录，无法保证预测先于成绩，已排除。',
        });
        continue;
      }
      if (row.semantic !== 'exam_total') {
        customExclusions.push({
          sessionId: row.key,
          reason: 'semantic_mismatch：accuracy_rate（正确率口径）不得与 exam_total（总分口径）预测直接比较，已排除。',
        });
        continue;
      }

      const occurredIso = row.occurredAt.toISOString();
      const prior = predictionsAsc.filter((prediction) => prediction.generatedAt.toISOString() <= occurredIso);
      const prediction = prior[prior.length - 1];
      const normalized = row.normalizedScore ?? normalizeScore(row.rawScore, row.rawTotalScale).normalized;

      if (prediction) {
        pairs.push({
          sessionId: row.key,
          assessedAt: occurredIso,
          predictedBest: prediction.predictedScore,
          predictedMin: prediction.predictedMinScore,
          predictedMax: prediction.predictedMaxScore,
          predictedAt: prediction.generatedAt.toISOString(),
          actualScore: row.rawScore,
          totalScore: row.rawTotalScale,
          actualNormalizedScore: normalized,
          actualSemantic: 'exam_total',
          actualSource: row.source as CalibrationPairInput['actualSource'],
          evidenceSampleSize: 1,
          evidenceBasis: `Score Ledger 持久化预测（${prediction.modelVersion}，生成于 ${prediction.generatedAt.toISOString().slice(0, 10)}）`,
        });
      } else {
        const reconstructed = this.reconstructPredictionBefore(
          practiceRows,
          snapshotRows,
          row.occurredAt,
          previousScore,
          targetScore,
        );
        if (!reconstructed || normalized == null) {
          customExclusions.push({
            sessionId: row.key,
            reason: 'no_prior_prediction：该成绩发生前没有已持久化的预测，也无法用更早的事实诚实重建，已排除。',
          });
          continue;
        }
        pairs.push({
          sessionId: row.key,
          assessedAt: occurredIso,
          predictedBest: reconstructed.bestEstimate,
          predictedMin: reconstructed.minScore,
          predictedMax: reconstructed.maxScore,
          predictedAt: null,
          actualScore: row.rawScore,
          totalScore: row.rawTotalScale,
          actualNormalizedScore: normalized,
          actualSemantic: 'exam_total',
          actualSource: row.source as CalibrationPairInput['actualSource'],
          evidenceSampleSize: reconstructed.sampleSize,
          evidenceBasis: reconstructed.basis,
        });
      }
      previousScore = normalized;
    }

    const base = buildScoreCalibration(pairs);
    return {
      ...base,
      exclusions: [...base.exclusions, ...customExclusions],
      summary: {
        ...base.summary,
        excludedCount: base.summary.excludedCount + customExclusions.length,
      },
      generatedAt: asOf.toISOString(),
      basis:
        base.rows.length === 0
          ? '该学生没有可校准的 Score Ledger 证据（无成对的预测与已验证成绩），无法进行预测—实测校准。'
          : 'S1：配对来自 Score Ledger（持久化预测 × 带来源证据），兼容性已强制（同量纲/同语义/同来源层/时序合法）。',
      source: 'derived',
      pendingVerification,
    };
  }

  // ---------------------------------------------------------------------------
  // Legacy fallback (AssessmentHistoryItem reconstruction)
  // ---------------------------------------------------------------------------

  private async calibrateFromLegacyAssessments(
    userId: string,
    targetScore: number,
    asOf: Date,
  ): Promise<ScoreCalibrationResult> {
    const db = this.prisma!;
    const assessments = await db.assessmentHistoryItem.findMany({
      where: { userId },
      orderBy: { submittedAt: 'asc' },
      take: MAX_ASSESSMENTS,
      select: {
        id: true,
        sessionId: true,
        submittedAt: true,
        score: true,
        totalScore: true,
        accuracyRate: true,
      },
    });

    if (assessments.length === 0) {
      const empty = buildScoreCalibration([]);
      return {
        ...empty,
        generatedAt: asOf.toISOString(),
        basis: '该学生没有已记录的测评成绩，无法进行预测—实测校准。',
        source: 'derived',
      };
    }

    const [practiceRows, snapshotRows] = await Promise.all([
      db.practiceRecord.findMany({
        where: { userId },
        orderBy: { submittedAt: 'asc' },
        take: MAX_PRACTICE_ROWS,
        select: { submittedAt: true, correct: true },
      }),
      db.userMasterySnapshot.findMany({
        where: { userId },
        orderBy: { snapshotDate: 'asc' },
        take: MAX_SNAPSHOT_ROWS,
        select: { snapshotDate: true, mastery: true },
      }),
    ]);

    const pairs: CalibrationPairInput[] = [];
    const customExclusions: Array<{ sessionId: string; reason: string }> = [];
    let previousScore: number | null = null;

    for (const assessment of assessments) {
      const before = assessment.submittedAt;
      // Legacy rows carry exactly one recorded provenance fact: their id
      // prefix and their totalScore. Interpretation rule (S1, documented):
      //   • "assessment-history-*"  → paper pipeline → accuracy_rate / MOCK
      //   • anything else with totalScore === 150 → user-entered exam points
      //     (the import channel shape) → exam_total / IMPORTED
      //   • anything else → accuracy_rate / MOCK (a percentage or an
      //     unknown-scale number can never be treated as exam points)
      const isPaperPipeline =
        typeof assessment.id === 'string' && assessment.id.startsWith('assessment-history-');
      const isExamPoints = !isPaperPipeline && assessment.totalScore === 150;
      const semantic = isExamPoints ? 'exam_total' : 'accuracy_rate';
      const source = isExamPoints ? 'IMPORTED' : 'MOCK';

      if (semantic !== 'exam_total') {
        customExclusions.push({
          sessionId: assessment.sessionId ?? `assessment:${assessment.submittedAt.toISOString()}`,
          reason: 'semantic_mismatch：整卷训练记录的分数是正确率口径（accuracy_rate），不得与 exam_total 预测直接比较，已排除。',
        });
        continue;
      }

      const priorPractice = practiceRows.filter((row) => row.submittedAt < before);
      const priorSnapshots = snapshotRows.filter((row) => row.snapshotDate < before);
      const accuracyRate = priorPractice.length > 0
        ? Math.round((priorPractice.filter((row) => row.correct).length / priorPractice.length) * 100)
        : null;
      const averageMastery = priorSnapshots.length > 0
        ? Math.round((priorSnapshots.reduce((sum, row) => sum + row.mastery, 0) / priorSnapshots.length) * 100)
        : null;

      const reconstructable = accuracyRate != null && averageMastery != null;
      const impliedBaseline = accuracyRate != null ? Math.round((accuracyRate / 100) * 150) : null;
      const currentScore = previousScore ?? impliedBaseline;

      const estimate = reconstructable && currentScore != null
        ? estimatePredictedScore({
            currentScore,
            targetScore: targetScore > currentScore ? targetScore : currentScore + 20,
            accuracyRate: accuracyRate!,
            averageMastery: averageMastery!,
            remainingDays: DAYS_FALLBACK,
          })
        : null;

      const basisParts: string[] = [];
      if (accuracyRate != null) basisParts.push(`评估前 ${priorPractice.length} 次已判分作答（正确率 ${accuracyRate}%）`);
      if (averageMastery != null) basisParts.push(`评估前 ${priorSnapshots.length} 条掌握度快照（均值 ${averageMastery}%）`);
      if (previousScore != null) basisParts.push(`上一次实测 ${previousScore} 分`);
      else if (impliedBaseline != null) basisParts.push(`首次测评，基准分由评估前正确率折算（${impliedBaseline}，估算）`);

      const normalization = normalizeScore(assessment.score, assessment.totalScore);
      pairs.push({
        sessionId: assessment.sessionId ?? `assessment:${assessment.submittedAt.toISOString()}`,
        assessedAt: assessment.submittedAt.toISOString(),
        predictedBest: estimate ? estimate.bestEstimate : null,
        predictedMin: estimate ? estimate.minScore : null,
        predictedMax: estimate ? estimate.maxScore : null,
        predictedAt: null,
        actualScore: assessment.score ?? null,
        totalScore: assessment.totalScore,
        actualNormalizedScore: normalization.ok ? normalization.normalized : null,
        actualSemantic: 'exam_total',
        actualSource: source as CalibrationPairInput['actualSource'],
        evidenceSampleSize: priorPractice.length + priorSnapshots.length,
        evidenceBasis: basisParts.join('；') || '无评估前事实可用于重建预测',
      });
      previousScore = normalization.ok ? normalization.normalized : previousScore;
    }

    const base = buildScoreCalibration(pairs);
    return {
      ...base,
      exclusions: [...base.exclusions, ...customExclusions],
      summary: {
        ...base.summary,
        excludedCount: base.summary.excludedCount + customExclusions.length,
      },
      generatedAt: asOf.toISOString(),
      basis: 'S1 回退路径：预测由测评前的练习正确率与掌握度快照重建（估算），实测分数按来源分层校验兼容性。预测分不等于真实成绩。',
      source: 'derived',
    };
  }

  private reconstructPredictionBefore(
    practiceRows: Array<{ submittedAt: Date; correct: boolean }>,
    snapshotRows: Array<{ snapshotDate: Date; mastery: number }>,
    before: Date,
    previousScore: number | null,
    targetScore: number,
  ): { bestEstimate: number; minScore: number; maxScore: number; sampleSize: number; basis: string } | null {
    const priorPractice = practiceRows.filter((row) => row.submittedAt < before);
    const priorSnapshots = snapshotRows.filter((row) => row.snapshotDate < before);
    const accuracyRate = priorPractice.length > 0
      ? Math.round((priorPractice.filter((row) => row.correct).length / priorPractice.length) * 100)
      : null;
    const averageMastery = priorSnapshots.length > 0
      ? Math.round((priorSnapshots.reduce((sum, row) => sum + row.mastery, 0) / priorSnapshots.length) * 100)
      : null;
    const reconstructable = accuracyRate != null && averageMastery != null;
    const impliedBaseline = accuracyRate != null ? Math.round((accuracyRate / 100) * 150) : null;
    const currentScore = previousScore ?? impliedBaseline;
    if (!reconstructable || currentScore == null) return null;

    const estimate = estimatePredictedScore({
      currentScore,
      targetScore: targetScore > currentScore ? targetScore : currentScore + 20,
      accuracyRate: accuracyRate!,
      averageMastery: averageMastery!,
      remainingDays: DAYS_FALLBACK,
    });

    const basisParts: string[] = [];
    if (accuracyRate != null) basisParts.push(`评估前 ${priorPractice.length} 次已判分作答（正确率 ${accuracyRate}%）`);
    if (averageMastery != null) basisParts.push(`评估前 ${priorSnapshots.length} 条掌握度快照（均值 ${averageMastery}%）`);
    if (previousScore != null) basisParts.push(`上一次实测 ${previousScore} 分`);
    else if (impliedBaseline != null) basisParts.push(`首次测评，基准分由评估前正确率折算（${impliedBaseline}，估算）`);

    return {
      bestEstimate: estimate.bestEstimate,
      minScore: estimate.minScore,
      maxScore: estimate.maxScore,
      sampleSize: priorPractice.length + priorSnapshots.length,
      basis: basisParts.join('；') || '无评估前事实可用于重建预测',
    };
  }
}
