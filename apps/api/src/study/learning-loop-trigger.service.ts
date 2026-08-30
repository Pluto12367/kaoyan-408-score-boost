import { Injectable, Logger } from '@nestjs/common';
import { LearningLoopRepository } from './learning-loop.repository';
import { RecommendationService } from './recommendation.service';
import { UserEventRepository } from './user-event.repository';
import { studyDateKey, todayKey } from './study-date';

type TriggerType = 'task.complete' | 'stage_assessment';
type AvailableMinutes = 30 | 60 | 120 | 180;

export interface LearningLoopTriggerInput {
  triggerType: TriggerType;
  sourceId: string;
  scheduledDate?: string;
}

export type LearningLoopTriggerResult =
  | { status: 'generated'; planId: string; scheduledDate: string; triggerKey: string }
  | { status: 'skipped'; reason: 'incomplete_today' | 'duplicate' }
  | { status: 'failed'; error: string };

@Injectable()
export class LearningLoopTriggerService {
  private readonly logger = new Logger(LearningLoopTriggerService.name);
  private readonly inFlight = new Map<string, Promise<LearningLoopTriggerResult>>();

  constructor(
    private readonly learningLoopRepository: LearningLoopRepository,
    private readonly recommendation: RecommendationService,
    private readonly userEvents: UserEventRepository,
  ) {}

  async maybeGenerateLearningLoopPlan(
    userId: string,
    input: LearningLoopTriggerInput,
  ): Promise<LearningLoopTriggerResult> {
    const completionDate = input.scheduledDate ?? todayKey();
    const scheduledDate = nextDate(completionDate);
    const triggerKey = `learning-loop:${userId}:${scheduledDate}`;
    const existing = this.inFlight.get(triggerKey);
    if (existing) return existing;

    const work = this.generateIfNeeded(userId, input, completionDate, scheduledDate, triggerKey)
      .finally(() => {
        if (this.inFlight.get(triggerKey) === work) this.inFlight.delete(triggerKey);
      });
    this.inFlight.set(triggerKey, work);
    return work;
  }

  private async generateIfNeeded(
    userId: string,
    input: LearningLoopTriggerInput,
    completionDate: string,
    scheduledDate: string,
    triggerKey: string,
  ): Promise<LearningLoopTriggerResult> {
    try {
      if (input.triggerType === 'task.complete' && !(await this.isTodayComplete(userId, completionDate))) {
        return { status: 'skipped', reason: 'incomplete_today' };
      }
      if (await this.userEvents.hasTriggerKey(userId, triggerKey)) {
        return { status: 'skipped', reason: 'duplicate' };
      }

      const user = await this.learningLoopRepository.loadUserRecommendationConfig(userId);
      const plan = await this.recommendation.generateDailyPlanFromState(userId, {
        targetExamDate: targetExamDate(user?.examYear, user?.remainingDays),
        availableMinutes: availableMinutes(user?.dailyHours),
        scheduledDate,
      });
      await this.userEvents.record(userId, 'plan.generated', {
        planId: plan.id,
        scheduledDate,
        triggerType: input.triggerType,
        sourceId: input.sourceId,
        triggerKey,
      });
      return { status: 'generated', planId: plan.id, scheduledDate, triggerKey };
    } catch (error) {
      this.logger.warn(
        `Learning loop plan generation failed for ${userId}`,
        error instanceof Error ? error.message : String(error),
      );
      return { status: 'failed', error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async isTodayComplete(userId: string, scheduledDate: string) {
    const tasks = await this.learningLoopRepository.loadTasksForDate(userId, scheduledDate);
    return tasks.length > 0 && tasks.every((task) => task.completed || task.status === 'completed');
  }
}

function nextDate(value: string) {
  const date = new Date(`${studyDateKey(value)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function targetExamDate(examYear?: number | null, remainingDays?: number | null) {
  if (examYear) return new Date(Date.UTC(examYear, 11, 20));
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + Math.max(0, remainingDays ?? 96));
  return date;
}

function availableMinutes(dailyHours?: number | null): AvailableMinutes {
  const minutes = Math.max(30, Math.round((dailyHours ?? 1) * 60));
  return ([30, 60, 120, 180] as const).reduce((closest, option) =>
    Math.abs(option - minutes) < Math.abs(closest - minutes) ? option : closest,
  30 as AvailableMinutes);
}
