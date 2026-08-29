import { Injectable } from '@nestjs/common';
import type { LegacyTodayPlanDto } from './today-plan.adapter';
import { toLegacyTodayPlan } from './today-plan.adapter';
import { TodayPlanProjectionService } from './today-plan-projection.service';

@Injectable()
export class TodayPlanQueryService {
  constructor(private readonly projection: TodayPlanProjectionService) {}

  async getTodayPlanCompat(userId: string, asOf: Date = new Date()): Promise<LegacyTodayPlanDto> {
    const snapshot = await this.projection.getSnapshot(userId, asOf);
    return toLegacyTodayPlan(snapshot, asOf.toISOString());
  }
}
