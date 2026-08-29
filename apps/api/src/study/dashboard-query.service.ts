import { Injectable } from '@nestjs/common';
import type { LegacyDashboardOverviewDto } from './dashboard.adapter';
import { toLegacyDashboardOverview } from './dashboard.adapter';
import { DashboardProjectionService } from './dashboard-projection.service';

@Injectable()
export class DashboardQueryService {
  constructor(private readonly projection: DashboardProjectionService) {}

  async getDashboardOverviewCompat(userId: string, asOf: Date = new Date()): Promise<LegacyDashboardOverviewDto> {
    const snapshot = await this.projection.getSnapshot(userId, asOf);
    return toLegacyDashboardOverview(snapshot, asOf.toISOString());
  }
}
