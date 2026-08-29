import { Injectable, Optional } from '@nestjs/common';
import type { LegacyTodayPlanDto } from './today-plan.adapter';
import { toLegacyTodayPlan } from './today-plan.adapter';
import { TodayPlanProjectionService } from './today-plan-projection.service';
import { StudyService } from './study.service';

// 过渡期兼容层：遗留 /today/plan 含 weekProgress（7 天窗口聚合）等契约字段，
// 投影链尚未产出这些事实（weekDays 当前为空）。投影链达到 parity 前，
// 兼容查询委托遗留实现；快照/适配器链保留用于后续切换。
@Injectable()
export class TodayPlanQueryService {
  constructor(
    private readonly projection: TodayPlanProjectionService,
    @Optional() private readonly legacy?: StudyService,
  ) {}

  async getTodayPlanCompat(userId: string, asOf: Date = new Date()): Promise<LegacyTodayPlanDto> {
    if (this.legacy) {
      return (await this.legacy.getTodayPlan(userId)) as LegacyTodayPlanDto;
    }
    const snapshot = await this.projection.getSnapshot(userId, asOf);
    return toLegacyTodayPlan(snapshot, asOf.toISOString());
  }
}
