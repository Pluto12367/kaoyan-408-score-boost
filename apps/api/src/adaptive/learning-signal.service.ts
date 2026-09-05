/**
 * Learning Signal Service (V4-2) — Nest shell over the pure derivation.
 *
 * Read-only: derives signals from the canonical StudentContext via
 * StudentContextQueryService, optionally enriched with a mastery baseline
 * (UserMasterySnapshot daily snapshots read through the existing prisma
 * client — read-only, no new fact source). Signals are rebuilt per call.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { StudentContextQueryService } from '../study/student-context.query.service';
import {
  deriveLearningSignals,
  buildSignalBrief,
  type LearningSignal,
  type SignalBaseline,
  type SignalStudentContextInput,
} from './learning-signals';

@Injectable()
export class LearningSignalService {
  private readonly logger = new Logger(LearningSignalService.name);

  constructor(
    private readonly studentContext: StudentContextQueryService,
    // Read-only mastery baseline loader: (userId, before) -> Map<nodeId, mastery>.
    // Optional: signals requiring a baseline degrade gracefully without it.
    @Optional() private readonly baselineLoader?: (userId: string, before: Date) => Promise<Record<string, number> | null>,
  ) {}

  async getLearningSignals(userId: string, now: Date = new Date()): Promise<LearningSignalSignalResult> {
    const context = await this.studentContext.getContext(userId, now);
    const baselineRecord = this.baselineLoader ? await this.loadBaseline(userId, now) : null;
    const baseline: SignalBaseline | undefined = baselineRecord
      ? { capturedAt: now.toISOString(), nodeMastery: baselineRecord }
      : undefined;
    const input = this.toSignalInput(context, now);
    const signals = deriveLearningSignals(baseline ? { ...input, baseline } : input);
    return {
      userId,
      derivedAt: now.toISOString(),
      signals,
      brief: buildSignalBrief(signals),
    };
  }

  private toSignalInput(context: any, now: Date): SignalStudentContextInput {
    return {
      asOf: context?.asOf ?? now.toISOString(),
      mastery: {
        weakNodes: context?.mastery?.weakNodes ?? [],
        improvingNodes: context?.mastery?.improvingPoints ?? [],
        masteredNodes: context?.mastery?.masteredPoints ?? [],
      },
      practice: {
        recentAccuracy: context?.practice?.recentAccuracy ?? { status: 'insufficient_data', value: null },
        totalCount: context?.practice?.totalCount ?? 0,
        latestSubmittedAt: context?.practice?.latestSubmittedAt ?? null,
      },
      review: {
        dueCount: context?.review?.dueCount ?? 0,
        overdueCount: context?.review?.overdueCount ?? 0,
        highRiskQuestions: context?.review?.highRiskQuestions ?? [],
      },
      plan: {
        completionRate: context?.plan?.completion?.rate?.value ?? null,
        openTaskCount: (context?.plan?.todayTasks ?? []).filter((task: any) => !task.completed).length,
      },
      momentum: {
        studyStreak: context?.momentum?.studyStreak ?? 0,
        isActiveToday: (context?.momentum?.recentSessions ?? []).some((session: any) => {
          const last = session.lastActiveAt ? new Date(session.lastActiveAt).getTime() : 0;
          return now.getTime() - last < 24 * 3600_000;
        }),
        activeDaysLast7: (context?.momentum?.activityTrend?.value ?? 0),
      },
    };
  }

  private async loadBaseline(userId: string, now: Date): Promise<Record<string, number> | null> {
    if (!this.baselineLoader) return null;
    return this.baselineLoader(userId, now);
  }
}

export interface LearningSignalSignalResult {
  userId: string;
  derivedAt: string;
  signals: LearningSignal[];
  brief: string;
}