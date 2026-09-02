import { Injectable } from '@nestjs/common';
import { OverviewReportProjectionService, type OverviewReportV1 } from './overview-report-projection.service';

/** Canonical read boundary for the Overview contract. Legacy dashboard/report
 * queries remain untouched until their individual migration tasks are approved. */
@Injectable()
export class OverviewQueryService {
  constructor(private readonly projection: OverviewReportProjectionService) {}

  getCanonicalOverview(userId: string, asOf: Date = new Date()): Promise<OverviewReportV1> {
    return this.projection.buildOverview(userId, asOf);
  }
}
