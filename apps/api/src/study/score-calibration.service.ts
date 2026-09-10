/**
 * V12-M5 — Real score calibration (read-only assembly).
 *
 * Pairs, for each recorded assessment, the score the system WOULD have
 * predicted just beforehand with the score that was actually recorded — the
 * comparison EB-4 said had never been made.
 *
 * The prediction is reconstructed with the production estimator
 * (estimatePredictedScore) from state strictly BEFORE the assessment:
 *   accuracy + average mastery from facts dated before it, days-to-exam at that
 *   time, and the previous recorded score (or, for the first assessment, the
 *   score implied by pre-assessment accuracy — declared in the evidence basis
 *   rather than passed off as a real prior score).
 *
 * Three concepts stay separate: prediction (a range + disclaimer), evidence
 * (which facts, how many), actual (the recorded score). Read-only.
 */

import { Injectable, Optional } from '@nestjs/common';
import {
  buildScoreCalibration,
  estimatePredictedScore,
  type CalibrationPairInput,
  type ScoreCalibration,
} from '@kaoyan408/shared';
import { PrismaService } from '../prisma/prisma.service';

const MAX_ASSESSMENTS = 50;
const MAX_PRACTICE_ROWS = 500;
const MAX_SNAPSHOT_ROWS = 1000;
const DEFAULT_TOTAL_SCORE = 150;
const TARGET_FALLBACK = 120;
const DAYS_FALLBACK = 240;

export interface ScoreCalibrationResult extends ScoreCalibration {
  readonly generatedAt: string;
  readonly basis: string;
  readonly source: 'derived';
}

@Injectable()
export class ScoreCalibrationService {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

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

    const assessments = await db.assessmentHistoryItem.findMany({
      where: { userId },
      orderBy: { submittedAt: 'asc' },
      take: MAX_ASSESSMENTS,
      select: {
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
    let previousScore: number | null = null;

    for (const assessment of assessments) {
      const before = assessment.submittedAt;
      const priorPractice = practiceRows.filter((row) => row.submittedAt < before);
      const priorSnapshots = snapshotRows.filter((row) => row.snapshotDate < before);

      const accuracyRate = priorPractice.length > 0
        ? Math.round((priorPractice.filter((row) => row.correct).length / priorPractice.length) * 100)
        : null;
      const averageMastery = priorSnapshots.length > 0
        ? Math.round((priorSnapshots.reduce((sum, row) => sum + row.mastery, 0) / priorSnapshots.length) * 100)
        : null;

      // Without a reconstructable basis there is no honest prediction to compare.
      const reconstructable = accuracyRate != null && averageMastery != null;
      const totalScore = assessment.totalScore || DEFAULT_TOTAL_SCORE;
      const impliedBaseline = accuracyRate != null
        ? Math.round((accuracyRate / 100) * totalScore)
        : null;
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

      pairs.push({
        sessionId: assessment.sessionId ?? `assessment:${assessment.submittedAt.toISOString()}`,
        assessedAt: assessment.submittedAt.toISOString(),
        predictedBest: estimate ? estimate.bestEstimate : null,
        predictedMin: estimate ? estimate.minScore : null,
        predictedMax: estimate ? estimate.maxScore : null,
        actualScore: assessment.score ?? null,
        totalScore,
        evidenceSampleSize: priorPractice.length + priorSnapshots.length,
        evidenceBasis: basisParts.length > 0 ? basisParts.join('；') : '无评估前事实可用于重建预测',
      });

      previousScore = assessment.score ?? previousScore;
    }

    const calibration = buildScoreCalibration(pairs);
    return {
      ...calibration,
      generatedAt: asOf.toISOString(),
      basis: `以 ${assessments.length} 次已记录测评为对象，用生产估算器重建每次测评之前的预测，再与该次实测分数对照。预测分不等于真实成绩。`,
      source: 'derived',
    };
  }
}
