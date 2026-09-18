import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildErrorDiagnosis, type ErrorDiagnosisResult } from '@kaoyan408/shared';
import { ErrorPatternService, ERROR_PATTERN_WINDOW } from './error-pattern.service';

/**
 * V13-A2 — ErrorPattern → Diagnosis read projection.
 *
 * Composes the A1 wrong-attempt evidence (via ErrorPatternService's shared
 * fact loader) with per-question loss aggregates from the ScoreLoss ledger to
 * answer "what should this student diagnose first, and how many points is it
 * worth".
 *
 * Boundaries:
 *   • READ-ONLY. No write primitive; no recommendation/priority input.
 *   • OBSERVED (exact/rubric grading) and PROXY (self-scored) loss are
 *     aggregated as separate fields — never merged (score-loss IL-6).
 *   • Unpriced questions count but contribute no loss value (NULL ≠ 0).
 *   • Pure aggregation lives in the shared `buildErrorDiagnosis`; this service
 *     only loads bounded facts.
 */

export interface ErrorDiagnosisView extends ErrorDiagnosisResult {
  readonly userId: string;
  readonly generatedAt: string;
  readonly storeAvailable: boolean;
  readonly reason?: string;
}

const MAX_LOSS_ROWS = 500;

@Injectable()
export class ErrorDiagnosisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly errorPatterns: ErrorPatternService,
  ) {}

  get enabled(): boolean {
    return Boolean(process.env.DATABASE_URL && this.prisma && this.errorPatterns.enabled);
  }

  async getErrorDiagnosis(userId: string, options: { days?: number } = {}, now: Date = new Date()): Promise<ErrorDiagnosisView> {
    const generatedAt = now.toISOString();
    const windowDays = this.errorPatterns.clampDays(options.days);
    if (!this.enabled) {
      return {
        userId,
        generatedAt,
        storeAvailable: false,
        reason: 'store_unavailable',
        window: { days: windowDays, from: new Date(now.getTime() - windowDays * 86_400_000).toISOString(), to: generatedAt },
        summary: { wrongCount: 0, observedLostScore: 0, proxyLostScore: 0, pricedQuestions: 0, unpricedQuestions: 0 },
        rows: [],
      };
    }

    const from = new Date(now.getTime() - windowDays * 86_400_000);
    const [attempts, lossRows] = await Promise.all([
      this.errorPatterns.loadAttemptFacts(userId, windowDays, now),
      this.prisma!.scoreLossItem.findMany({
        where: { userId },
        orderBy: { recordedAt: 'desc' },
        take: MAX_LOSS_ROWS,
        select: { questionId: true, lostScore: true, lossKind: true, maxScore: true },
      }),
    ]);

    // Per-question ledger aggregate (append-only rows may repeat a question —
    // one entry per score evidence). OBSERVED and PROXY summed separately.
    const lossByQuestion: Record<string, { observed: number; proxy: number; priced: boolean }> = {};
    for (const row of lossRows) {
      const fact = lossByQuestion[row.questionId] ?? { observed: 0, proxy: 0, priced: false };
      if (row.lostScore != null) {
        if (row.lossKind === 'OBSERVED') fact.observed += row.lostScore;
        else if (row.lossKind === 'PROXY') fact.proxy += row.lostScore;
      }
      if (row.maxScore != null) fact.priced = true;
      lossByQuestion[row.questionId] = fact;
    }

    const diagnosis = buildErrorDiagnosis({ now: generatedAt, windowDays, attempts, lossByQuestion });
    return { userId, generatedAt, storeAvailable: true, ...diagnosis };
  }
}

// Re-exported for the controller's unavailable-shape typing.
export { ERROR_PATTERN_WINDOW };
